/**
 * Headless approval policy and reasoning-effort mapping for the Muse
 * adapter. Only `allowAll` (yolo) auto-approves the server-offered first
 * choice; every gated mode denies with an actionable error so the mode
 * selector never promises gating it does not enforce. Fail-closed: an
 * unset mode denies.
 */
export function registerApprovalHandlers(session, approvalMode) {
  session.onApproval(async (request) => approveFirstChoice(request, approvalMode));
  if (typeof session.onApprovalError === 'function') {
    session.onApprovalError((failure) => {
      console.warn(`[MuseAdapter] Approval round trip did not complete: ${failure?.kind} (${failure?.approvalId || 'unknown'})`);
    });
  }
}

function approveFirstChoice(request, approvalMode) {
  if (approvalMode !== 'allowAll') {
    throw new Error(
      'Muse did not auto-approve this tool call: standard/plan sessions require explicit approval, '
      + 'and this server cannot prompt yet. Re-run the session in yolo mode to allow tool execution.',
    );
  }
  const choice = request?.availableChoices?.[0];
  if (!choice) {
    throw new Error('Muse approval request offered no choices');
  }
  return { choiceId: choice.choiceId };
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
