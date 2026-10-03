import { deadline, remainingMuseTurnMs } from './museTimeouts.js';
import { logMuseLifecycle } from './museLifecycle.js';
import { MUSE_SDK_VERSION } from './museClient.js';
import { isWorkflowTerminal, sessionItems, workflowIdentity } from './museWorkflow.js';

/**
 * Turn-drain machinery for {@link MuseAdapter}.
 *
 * Extracted into its own module so the adapter stays under the file
 * `max-lines` budget and each drain step stays under the complexity /
 * statement budgets. All functions are pure orchestration over the injected
 * `host` / `session` / `turn` / `mapper` / `context` handles plus the
 * adapter's `timeouts` — no module state.
 */

/**
 * Fold one turn's items into mapper events. When the turn admitted a
 * workflow, the parent outcome only means admission: the generator stays
 * open until the workflow reaches a terminal revision.
 */
export async function* drainTurnItems({ host, session, turn, options, mapper, context, timeouts }) {
  const iterator = turn.items()[Symbol.asyncIterator]();
  const folded = yield* replayTurnBacklog({ host, session, turn, iterator, options, mapper, context, timeouts });
  // A cancelled drain already emitted its terminal `result(cancelled)` — the
  // turn must end here, never by awaiting a completion that will not come.
  if (folded.cancelled) return;
  if (folded.workflow) {
    await deadline(folded.outcome || turn.completed, {
      timeoutMs: await remainingMuseTurnMs(timeouts.turnMs, context, host, options.abortController),
      phase: 'parentCompletion',
      context,
      onTimeout: () => host.close(),
    });
    yield* observeWorkflow({ host, session, workflow: folded.workflow, options, mapper, context, timeouts });
    return;
  }
  yield* finishTurnItems({ host, session, turn, options, mapper, context, outcome: folded.outcome, timeouts });
}

async function* replayTurnBacklog({ host, session, turn, iterator, options, mapper, context, timeouts }) {
  const abortSignal = options.abortController?.signal;
  let sawFirstItem = false;
  let outcome = null;
  let workflow = null;
  while (true) {
    if (abortSignal?.aborted) {
      yield* cancelTurnDrain(mapper, context);
      return { outcome, workflow, cancelled: true };
    }
    const next = await readNextTurnEvent({ iterator, turn, abortSignal, host, options, context, timeouts });
    if (next.kind === 'aborted') {
      yield* cancelTurnDrain(mapper, context);
      return { outcome, workflow, cancelled: true };
    }
    if (next.kind === 'completed') {
      outcome = next.completed;
      break;
    }
    const { itemResult } = next;
    if (itemResult.done) break;
    workflow = trackWorkflowItem(itemResult.value, workflow);
    if (!sawFirstItem) {
      sawFirstItem = true;
      markFirstItem({ host, session, context });
    }
    yield* mapper.mapItem(itemResult.value);
  }
  return { outcome, workflow };
}

function trackWorkflowItem(item, workflow) {
  const identity = workflowIdentity(item);
  if (!identity) return workflow;
  if (!workflow || workflow.workflowRunId === identity.workflowRunId) {
    return { ...identity, item };
  }
  throw new Error('Muse admitted more than one workflow for one turn; concurrent workflow runs are not supported.');
}

function markFirstItem({ host, session, context }) {
  context.markTime('firstItemMs');
  logMuseLifecycle({
    correlationId: context.correlationId,
    hostPid: host.pid,
    museSessionId: session.sessionId,
    sdkVersion: MUSE_SDK_VERSION,
    cliVersion: host.cliVersion,
    timings: context.timings,
    phase: 'firstItem',
  });
}

async function* observeWorkflow({ host, session, workflow, options, mapper, context, timeouts }) {
  let cancellationRequested = false;
  host.setAbortHandler(async () => {
    cancellationRequested = true;
    if (typeof session.cancelWorkflow !== 'function') {
      await host.close();
      return;
    }
    await session.cancelWorkflow({ workflowRunId: workflow.workflowRunId });
  });
  const iterator = sessionItems(session)[Symbol.asyncIterator]();
  let revision = workflow.revision;
  try {
    // A replay may already contain the terminal revision that replaced the
    // launch item before the parent turn's completion was observed.
    if (isWorkflowTerminal(workflow.item)) {
      yield* mapper.mapWorkflowTerminal(workflow.item);
      return;
    }
    while (true) {
      const remainingMs = await remainingMuseTurnMs(timeouts.turnMs, context, host, options.abortController);
      const next = await deadline(iterator.next(), {
        timeoutMs: remainingMs, phase: 'workflow', context, onTimeout: () => host.close(),
      });
      if (next.done) throw new Error('Muse session item stream ended before the workflow reached a terminal state.');
      const item = next.value;
      const identity = workflowIdentity(item);
      if (!identity || identity.workflowRunId !== workflow.workflowRunId) continue;
      if (identity.revision <= revision) continue;
      revision = identity.revision;
      if (isWorkflowTerminal(item)) {
        yield* mapper.mapWorkflowTerminal(item);
        return;
      }
      yield* mapper.mapItem(item);
    }
  } finally {
    host.setAbortHandler(null);
    await iterator.return?.();
    if (cancellationRequested) context.markCancelled();
  }
}

function* cancelTurnDrain(mapper, context) {
  context.markCancelled();
  yield* mapper.mapCancellation();
}

async function readNextTurnEvent({ iterator, turn, abortSignal, host, options, context, timeouts }) {
  const remainingTurnMs = await remainingMuseTurnMs(timeouts.turnMs, context, host, options.abortController);
  // Completion is raced with each tail read: a host that has terminally
  // completed must not remain "running" merely because its item iterator
  // failed to wake. There is deliberately no per-item silence deadline:
  // Muse may legitimately be quiet while planning or running a tool.
  return deadline(Promise.race([
    iterator.next().then((itemResult) => ({ kind: 'item', itemResult })),
    completionAfterBacklog(turn.completed),
    waitForAbort(abortSignal),
  ]), {
    timeoutMs: remainingTurnMs,
    phase: 'turn',
    context,
    onTimeout: () => host.close(),
  });
}

async function* finishTurnItems({ host, session, turn, options, mapper, context, outcome, timeouts }) {
  const remainingTurnMs = await remainingMuseTurnMs(timeouts.turnMs, context, host, options.abortController);
  yield* mapper.mapOutcome(outcome || await deadline(turn.completed, {
    timeoutMs: remainingTurnMs,
    phase: 'completion',
    context,
    onTimeout: () => host.close(),
  }));
  context.markTime('completionMs');
  logMuseLifecycle({
    correlationId: context.correlationId,
    hostPid: host.pid,
    museSessionId: session.sessionId,
    sdkVersion: MUSE_SDK_VERSION,
    cliVersion: host.cliVersion,
    timings: context.timings,
    phase: 'completion',
  });
}

function completionAfterBacklog(completed) {
  // `items()` must replay its already-folded backlog before a terminal
  // completion is emitted. Give an immediately available iterator item the
  // current event-loop turn; after that, a settled completion reconciles a
  // stuck live tail without waiting for another item.
  return new Promise((resolve, reject) => {
    setTimeout(() => completed.then(
      (value) => resolve({ kind: 'completed', completed: value }),
      reject,
    ), 0);
  });
}

function waitForAbort(signal) {
  if (!signal) return new Promise(() => {});
  if (signal.aborted) return Promise.resolve({ kind: 'aborted' });
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ kind: 'aborted' }), { once: true }));
}
