/**
 * Workflow-specific protocol rules.  A workflow is deliberately not a turn:
 * the turn that admitted it can complete while the workflow remains live.
 */
export function workflowIdentity(item) {
  if (item?.kind !== 'workflow') return null;
  const workflowRunId = typeof item.workflowRunId === 'string' ? item.workflowRunId : null;
  if (!workflowRunId) throw new Error('Muse sent a workflow item without workflowRunId.');
  return { workflowRunId, itemId: item.itemId ?? item.id ?? null, revision: Number(item.revision ?? 0) };
}

export function isWorkflowTerminal(item) {
  return item?.kind === 'workflow' && item.status !== 'inProgress' && item.status !== 'running';
}

export function workflowTerminalKind(item) {
  const status = String(item?.status || '').toLowerCase();
  if (status === 'completed' || status === 'succeeded' || status === 'success') return 'completed';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  return 'failed';
}

export function workflowMessage(item) {
  return typeof item?.message === 'string' ? item.message.trim() : '';
}

/**
 * The SDK observer is intentionally feature-detected.  `turn.items()` ends
 * at the parent turn and cannot be substituted here: doing so is precisely
 * what used to lose background workflows.
 */
export function sessionItems(session) {
  if (typeof session?.items !== 'function') {
    throw new Error('Muse SDK workflow support requires Session.items(). Upgrade @muse-code/sdk to a release with the session-level item stream.');
  }
  return session.items({ replay: true });
}
