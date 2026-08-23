import { test, expect } from '@playwright/test';
import {
  cleanupCreatedResources,
  seedProject,
  seedSession,
  navigateAndWait,
  getProjectSessions,
  getKanbanEntryEvent,
  advanceKanbanEntryEvent,
  getServerInfo,
} from './helpers';
import {
  UNRECORDED_PROMPT,
  getBoard,
  getLaneByName,
  findCardOfSession,
  findLaneOfSession,
  configureAutomatedLane,
  addSessionToLaneViaUI,
} from './kanbanLaneRunHelpers';

/**
 * E2E coverage for the kanban lane-entry delivery outbox
 * (packages/server/src/services/kanbanService.js drainLaneEntryTrigger): the
 * retry/backoff loop, the `ambiguous_dispatch` state, the 1s background
 * retry worker, and terminal exhaustion after MAX_ENTRY_EVENT_ATTEMPTS (8)
 * attempts. None of this had test coverage before this file.
 *
 * Recipe: an onEnterPrompt with NO committed VCR cassette (UNRECORDED_PROMPT).
 * Attempt 1 creates the child, attaches it as the run's root, marks dispatch
 * intent, then the VCR adapter throws deterministically inside the child's
 * own turn. That independently fails the LANE RUN (via closeOwnWork — see
 * kanban-lane-run-structured.spec.ts's "a permanent failure..." test for the
 * same mechanism), while the ENTRY EVENT itself goes back to 'pending' for
 * retry. From attempt 2 onward, resolveDeliveryState() sees an attached root
 * with dispatch_intent but no acknowledgement -> 'ambiguous_dispatch', so it
 * never calls triggerLaneEntryAutomation again — no second child is ever
 * created. After the 8th attempt the event flips to terminal 'failed'.
 *
 * The e2e server is shared across parallel spec files, and terminal events
 * persist (24h delivery-health window), so all server-info health
 * assertions below are baseline-relative snapshots taken inside each test.
 */

/** Poll a kanban_lane_entry_events row (read via scripts/kanban-entry-event.mjs)
 * until `predicate` is true. */
async function pollEntryEvent(
  eventId: string,
  predicate: (event: any) => boolean,
  timeout = 20000
): Promise<any> {
  const deadline = Date.now() + timeout;
  let last: any = null;
  while (Date.now() < deadline) {
    last = getKanbanEntryEvent(eventId);
    if (last && predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Lane-entry event ${eventId} never satisfied predicate within ${timeout}ms. Last seen: ${JSON.stringify(last)}`
  );
}

test.describe('Kanban lane-entry delivery outbox', () => {
  test.describe.configure({ timeout: 120000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Lane Entry Delivery Outbox Test', '/tmp/test-kanban-delivery-retry');
    await getBoard(project.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('a delivery failure retries through the outbox to terminal exhaustion without duplicate work', async ({
    page,
  }) => {
    const board = await getBoard(project.id);
    const source = getLaneByName(board, 'To Do');
    const done = getLaneByName(board, 'Done');

    await navigateAndWait(page, `/projects/${project.id}/kanban`, { waitFor: '.kanban-board' });
    await configureAutomatedLane(page, project.id, source.name, {
      prompt: UNRECORDED_PROMPT,
      targetLabel: done.name,
    });

    const workspace = await seedSession(project.id, {
      prompt: 'Workspace root',
      name: 'Delivery Retry Workspace',
      startImmediately: false,
    });

    await addSessionToLaneViaUI(page, source.name, workspace.name);

    // Capture the lane-entry event id created by the add.
    let eventId: string | null = null;
    await expect
      .poll(
        async () => {
          const card = findCardOfSession(await getBoard(project.id), workspace.id);
          eventId = card?.activeLaneRun?.laneEntryEventId ?? null;
          return eventId;
        },
        { timeout: 15000 }
      )
      .toBeTruthy();

    // Baseline snapshot: the shared e2e server runs specs in parallel and
    // terminal events persist, so absolute counts are meaningless — every
    // health assertion below is relative to this snapshot.
    const before = (await getServerInfo()).automationStatus.deliveryHealth.counts;

    // Attempt 1 fails (no cassette). Confirm it lands back at 'pending' with
    // dispatch intent recorded — the precondition for 'ambiguous_dispatch'
    // on every subsequent retry.
    const afterAttempt1 = await pollEntryEvent(
      eventId!,
      (e) => e.status === 'pending' && e.attempt_count >= 1 && e.delivery_phase === 'dispatch_intent',
      20000
    );
    expect(afterAttempt1.dispatch_acknowledged_at).toBeNull();

    // Anti-duplicate: the child created on attempt 1 is never replaced —
    // resolveDeliveryState() short-circuits every later attempt to
    // 'ambiguous_dispatch' before triggerLaneEntryAutomation ever runs again.
    const workspaceChildren = (await getProjectSessions(project.id)).filter(
      (s: any) => s.parentSessionId === workspace.id
    );
    expect(workspaceChildren).toHaveLength(1);
    const child = workspaceChildren[0];

    // 'ambiguous' counts any pending/claimed event whose delivery_phase is
    // 'dispatch_intent' with no acknowledgement — true from attempt 1 onward.
    // Unlike 'exhausted' (terminal, monotonic within the 24h health window),
    // 'ambiguous' is a live/transient count: a concurrently-running spec's
    // event can exit that state between our two snapshots, so assert an
    // absolute floor instead of a baseline-relative delta.
    const duringRetries = (await getServerInfo()).automationStatus.deliveryHealth.counts;
    expect(duringRetries.ambiguous).toBeGreaterThanOrEqual(1);

    // Worker-driven: with no test action, the 1s background retry worker
    // alone advances attempt_count past 1 (its poll tick lines up with the
    // ~1s backoff scheduled after attempt 1).
    await pollEntryEvent(eventId!, (e) => e.attempt_count >= 2, 10000);

    // Fast-forward the remaining backoff (later gaps grow to tens of
    // seconds) by zeroing next_attempt_at between observed attempts —
    // mirrors how scheduler e2e tests manually perform the scheduler's real
    // handoff instead of waiting out wall-clock delays.
    let latest = getKanbanEntryEvent(eventId!);
    let iterations = 0;
    while (latest.status === 'pending' && latest.attempt_count < 8 && iterations < 20) {
      const priorAttemptCount = latest.attempt_count;
      advanceKanbanEntryEvent(eventId!);
      latest = await pollEntryEvent(
        eventId!,
        (e) => e.attempt_count > priorAttemptCount || e.status !== 'pending',
        5000
      );
      iterations += 1;
    }

    const terminal = await pollEntryEvent(eventId!, (e) => e.status === 'failed', 10000);
    expect(terminal.attempt_count).toBe(8);
    expect(terminal.completed_at).toBeTruthy();
    expect(terminal.last_error).toMatch(/ambiguous|child ownership/);

    const afterHealth = (await getServerInfo()).automationStatus.deliveryHealth.counts;
    expect(afterHealth.exhausted).toBeGreaterThanOrEqual((before.exhausted || 0) + 1);

    // The card never advances. The lane run independently failed (via the
    // child's own turn error) well before the entry event exhausted its
    // retries — the run's failure and the outbox's exhaustion are separate
    // mechanisms that both land on the same conclusion.
    const boardAfter = await getBoard(project.id);
    expect(findLaneOfSession(boardAfter, workspace.id)).toBe(source.name);
    const finalCard = findCardOfSession(boardAfter, workspace.id);
    expect(finalCard.activeLaneRun).toBeTruthy();
    expect(finalCard.activeLaneRun.status).toBe('failed');
    expect(finalCard.activeLaneRun.failedSessionId).toBe(child.id);

    // No orphaned/duplicate workers — still exactly the one attempt-1 child.
    const finalChildren = (await getProjectSessions(project.id)).filter(
      (s: any) => s.parentSessionId === workspace.id
    );
    expect(finalChildren).toHaveLength(1);
    expect(finalChildren[0].id).toBe(child.id);
  });

  test('an ambiguous dispatch never spawns a second worker across repeated retries', async ({ page }) => {
    const board = await getBoard(project.id);
    const source = getLaneByName(board, 'To Do');
    const done = getLaneByName(board, 'Done');

    await navigateAndWait(page, `/projects/${project.id}/kanban`, { waitFor: '.kanban-board' });
    await configureAutomatedLane(page, project.id, source.name, {
      prompt: UNRECORDED_PROMPT,
      targetLabel: done.name,
    });

    const workspace = await seedSession(project.id, {
      prompt: 'Workspace root',
      name: 'Ambiguous Dispatch Workspace',
      startImmediately: false,
    });

    await addSessionToLaneViaUI(page, source.name, workspace.name);

    let eventId: string | null = null;
    await expect
      .poll(
        async () => {
          const card = findCardOfSession(await getBoard(project.id), workspace.id);
          eventId = card?.activeLaneRun?.laneEntryEventId ?? null;
          return eventId;
        },
        { timeout: 15000 }
      )
      .toBeTruthy();

    await pollEntryEvent(
      eventId!,
      (e) => e.status === 'pending' && e.attempt_count >= 1 && e.delivery_phase === 'dispatch_intent',
      20000
    );

    const childrenAfterAttempt1 = (await getProjectSessions(project.id)).filter(
      (s: any) => s.parentSessionId === workspace.id
    );
    expect(childrenAfterAttempt1).toHaveLength(1);
    expect(childrenAfterAttempt1[0].status).toBe('error');

    // Force a few more retries (advance-driven, not waiting out real
    // backoff) and re-assert no second worker ever appears.
    for (let i = 0; i < 3; i += 1) {
      const before = getKanbanEntryEvent(eventId!);
      advanceKanbanEntryEvent(eventId!);
      await pollEntryEvent(
        eventId!,
        (e) => e.attempt_count > before.attempt_count || e.status !== 'pending',
        5000
      );
    }

    const childrenAfterRetries = (await getProjectSessions(project.id)).filter(
      (s: any) => s.parentSessionId === workspace.id
    );
    expect(childrenAfterRetries).toHaveLength(1);
    expect(childrenAfterRetries[0].id).toBe(childrenAfterAttempt1[0].id);
  });
});
