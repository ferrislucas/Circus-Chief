import { museApprovalModeAutoApproves } from '@circuschief/shared';

/** Fail-closed denial used when a gated turn has no interactive prompt channel. */
const DENY_WITHOUT_CHANNEL_MESSAGE = 'Muse did not auto-approve this tool call: only yolo sessions auto-approve tools — '
  + 'plan and standard sessions request approval for each tool, and no prompt channel is '
  + 'available for this turn. Re-run the session in yolo mode to allow tool execution without prompting.';

/**
 * Interactive approval posture and reasoning-effort mapping for the Muse
 * adapter (finding #3). Only `allowAll` (yolo) auto-approves the
 * server-offered first choice. Every gated mode runs a real approval
 * round-trip through the shared permission-prompt pipeline (promptStore +
 * WS prompt events, via the `canUseTool` callback — the same channel the
 * Claude path uses): the request parks as an interactive prompt carrying the
 * tool name and a subject summary, the user's decision resolves the MSP
 * `onApproval` callback, and an unanswered prompt denies fail-closed on the
 * `approvalPromptMs` budget. Deny also remains the fail-closed default when
 * no prompt channel exists at all. The allow/deny rule itself lives in
 * `@circuschief/shared` (`museApprovalPolicy.js`) so the adapter and the UI
 * copy cannot drift.
 */
export function registerApprovalHandlers(session, approvalMode, { promptChannel = null, promptTimeoutMs = 300_000, signal = null, onPromptTimeout = null } = {}) {
  session.onApproval(async (request) => resolveApprovalRequest(request, approvalMode, { promptChannel, promptTimeoutMs, signal, onPromptTimeout }));
  if (typeof session.onApprovalError === 'function') {
    session.onApprovalError((failure) => {
      console.warn(`[MuseAdapter] Approval round trip did not complete: ${failure?.kind} (${failure?.approvalId || 'unknown'})`);
    });
  }
}

function resolveApprovalRequest(request, approvalMode, { promptChannel, promptTimeoutMs, signal, onPromptTimeout }) {
  if (museApprovalModeAutoApproves(approvalMode)) return approveFirstChoice(request);
  if (typeof promptChannel !== 'function') {
    throw new Error(DENY_WITHOUT_CHANNEL_MESSAGE);
  }
  return requestApprovalViaPrompt(request, promptChannel, { promptTimeoutMs, signal, onPromptTimeout });
}

function approveFirstChoice(request) {
  const choice = request?.availableChoices?.[0];
  if (!choice) {
    throw new Error('Muse approval request offered no choices');
  }
  return { choiceId: choice.choiceId };
}

/**
 * Park the MSP approval request as an interactive prompt and map the user's
 * decision back onto the MSP contract: approval resolves the server-offered
 * first choice; denial (explicit, timeout, or cancelled turn) throws an
 * actionable denial error.
 */
async function requestApprovalViaPrompt(request, promptChannel, { promptTimeoutMs, signal, onPromptTimeout }) {
  const firstChoice = request?.availableChoices?.[0];
  if (!firstChoice) throw new Error('Muse approval request offered no choices');

  // Per-request signal: the timeout aborts it (which cancels a parked
  // prompt in the shared pipeline), and a cancelled turn cancels the prompt.
  const local = new AbortController();
  const onOuterAbort = () => local.abort(signal?.reason);
  if (signal?.aborted) local.abort(signal?.reason);
  else signal?.addEventListener('abort', onOuterAbort, { once: true });

  let timedOut = false;
  let timeoutResolve = null;
  const timeoutDenial = new Promise((resolve) => { timeoutResolve = resolve; });
  const timer = setTimeout(() => {
    timedOut = true;
    local.abort(new Error(`Muse approval prompt timed out after ${promptTimeoutMs}ms`));
    timeoutResolve({
      behavior: 'deny',
      message: `Muse approval prompt timed out after ${promptTimeoutMs}ms; the tool call was denied.`,
    });
  }, promptTimeoutMs);
  timer.unref?.();

  try {
    const response = await Promise.race([
      promptChannel(
        request?.toolName || 'unknown tool',
        summarizeApprovalSubject(request),
        {
          toolUseID: request?.approvalId ?? null,
          displayName: `${request?.toolName || 'tool'} (${request?.subject?.kind || 'approval'})`,
          title: `Muse requests approval for ${request?.toolName || 'a tool'}`,
          signal: local.signal,
        },
      ),
      timeoutDenial,
    ]);
    if (timedOut) {
      onPromptTimeout?.(request, promptTimeoutMs);
      throw new Error(response?.message || `Muse approval prompt timed out after ${promptTimeoutMs}ms; the tool call was denied.`);
    }
    if (response?.behavior === 'allow') return { choiceId: firstChoice.choiceId };
    throw new Error(`Muse tool call denied${response?.message ? `: ${response.message}` : ' by user.'}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * Prompt-card payload for an MSP approval request: the subject and
 * protected-write flag as the input summary. The durable work-log path
 * redacts this to structural keys (promptDurableSummary), never raw values.
 */
function summarizeApprovalSubject(request) {
  return {
    subject: request?.subject ?? null,
    protectedWrite: Boolean(request?.protectedWrite),
  };
}

/**
 * Map a Circus Chief effort level onto an MSP reasoning-effort tier.
 * `auto`/null/unknown → omitted (server default) — never invent a tier.
 * MSP tiers: none|minimal|low|medium|high|xhigh|max|ultra.
 */
export function resolveMuseReasoningEffort(effortLevel) {
  switch (effortLevel) {
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'max':
      return 'max';
    default:
      return null;
  }
}

export function museReasoningEffortParam(effortLevel) {
  const tier = resolveMuseReasoningEffort(effortLevel);
  return tier ? { reasoningEffort: tier } : {};
}
