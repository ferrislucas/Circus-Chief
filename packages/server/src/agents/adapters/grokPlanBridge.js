import { parkPrompt } from '../../services/promptStore.js';

/**
 * Present a Grok `_x.ai/exit_plan_mode` plan-approval request on the existing
 * agent prompt card and translate the parked decision back into Grok's ACP
 * response. Params carry `{ toolCallId, planContent }` (verified against
 * `grok --no-auto-update agent stdio`, v1.0.70).
 *
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string|null} params.conversationId
 * @param {Object} params.request - ACP ext-method params
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<Object>}
 */
export async function answerGrokPlanApproval({ sessionId, conversationId, request, signal }) {
  // The plan body can legitimately be empty (Grok also intercepts when the
  // plan file is missing or unreadable), so only a missing session — which
  // makes parking impossible — is rejected here.
  if (!sessionId) return { outcome: 'abandoned' };
  const parked = await parkPrompt({
    sessionId,
    conversationId: conversationId || null,
    kind: 'plan_approval',
    toolUseId: request?.toolCallId || null,
    payload: {
      planContent: typeof request?.planContent === 'string' ? request.planContent : '',
    },
    signal,
  });
  return toGrokPlanResult(parked);
}

/**
 * @param {{ behavior?: string, updatedInput?: Object }|null} parked
 * @returns {Object} Grok `ExitPlanModeExtResponse` outcome
 */
export function toGrokPlanResult(parked) {
  if (!parked || parked.behavior !== 'allow') {
    // No user decision exists (stopped turn, expiry, capacity) — reply
    // `abandoned` rather than `cancelled`: Grok keeps the turn alive and
    // merely deactivates plan mode, whereas an error/cancel reply reads as
    // "client disconnected" and kills the turn.
    return { outcome: 'abandoned' };
  }
  const { decision, feedback } = parked.updatedInput || {};
  if (decision === 'approve') return { outcome: 'approved' };
  if (decision === 'request_changes') {
    const notes = typeof feedback === 'string' ? feedback.trim() : '';
    return { outcome: 'request_changes', ...(notes ? { feedback: notes } : {}) };
  }
  return { outcome: 'abandoned' };
}
