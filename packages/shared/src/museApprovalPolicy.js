/**
 * Single source of truth for the Muse (`muse exec`) approval posture,
 * shared by the server adapter and the web mode selector.
 *
 * Exec is headless: there is no interactive approval round-trip. Gated
 * modes enforce policy via CLI flags (`--approval-mode`, `--disable-write`
 * — see `museExecArgs.js`) and denied tools fail the run instead of asking
 * the user. Auto-approval stays exclusive to `allowAll` (yolo); anything
 * else (including unknown modes) fails closed to a gated posture. The
 * mode-selector copy below matches this posture so the UI never promises
 * prompting the adapter cannot do.
 *
 * Approval postures are closed (select-never-create):
 * `allowAll | promptUnmatched | onRequest | denyUnmatched`.
 */

/** Session mode → Muse approval posture (mirrors getMuseApprovalModeForSession). */
export const MUSE_APPROVAL_MODE_FOR_SESSION_MODE = Object.freeze({
  yolo: 'allowAll',
  plan: 'promptUnmatched',
  standard: 'onRequest',
});

/**
 * @param {string} mode - Session mode ('plan', 'standard', 'yolo').
 * @returns {string} Muse approval posture; unknown modes fail closed to 'onRequest'.
 */
export function museApprovalModeForSessionMode(mode) {
  return MUSE_APPROVAL_MODE_FOR_SESSION_MODE[mode] ?? 'onRequest';
}

/**
 * Whether the adapter auto-approves tool use under the given approval
 * posture. Only `allowAll` (yolo) does.
 * @param {string} approvalMode - Muse approval posture (may be unset).
 * @returns {boolean}
 */
export function museApprovalModeAutoApproves(approvalMode) {
  return approvalMode === 'allowAll';
}

/**
 * Honest mode-selector copy for Muse sessions: exec is headless, so gated
 * modes enforce approvals via CLI flags and denied tools fail the run —
 * nothing ever prompts the user; yolo auto-approves.
 */
export const MUSE_SESSION_MODE_COPY = Object.freeze({
  plan: Object.freeze({
    label: 'Plan',
    description: 'Plans first; restricted tools are denied without prompting',
  }),
  standard: Object.freeze({
    label: 'Standard',
    description: 'Restricted tools are denied without prompting',
  }),
  yolo: Object.freeze({
    label: 'YOLO',
    description: 'Automatically approves tool use',
  }),
});

/**
 * @param {string} mode - Session mode ('plan', 'standard', 'yolo').
 * @returns {{ label: string, description: string }} Muse copy; unknown modes fail closed to standard.
 */
export function museSessionModeCopy(mode) {
  return MUSE_SESSION_MODE_COPY[mode] ?? MUSE_SESSION_MODE_COPY.standard;
}
