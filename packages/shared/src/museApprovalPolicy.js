/**
 * Single source of truth for the Muse (`muse serve`) approval posture,
 * shared by the server adapter and the web mode selector.
 *
 * Decision (review finding #3): gated modes run a real interactive approval
 * round-trip — MSP `onApproval` requests park as prompts through the shared
 * permission-prompt pipeline (promptStore + WS prompt events, the same
 * channel the Claude path uses), and the user's decision resolves the
 * callback. Auto-approval stays exclusive to `allowAll` (yolo); denial
 * remains the fail-closed default when no prompt channel exists, the prompt
 * times out, or the mode is unknown. The mode-selector copy below matches
 * this posture so the UI never promises gating the adapter does not enforce.
 *
 * MSP approval modes are closed (select-never-create):
 * `allowAll | promptUnmatched | onRequest | denyUnmatched`.
 */

/** Session mode → MSP approval mode (mirrors getMuseApprovalModeForSession). */
export const MUSE_APPROVAL_MODE_FOR_SESSION_MODE = Object.freeze({
  yolo: 'allowAll',
  plan: 'promptUnmatched',
  standard: 'onRequest',
});

/**
 * @param {string} mode - Session mode ('plan', 'standard', 'yolo').
 * @returns {string} MSP approval mode; unknown modes fail closed to 'onRequest'.
 */
export function museApprovalModeForSessionMode(mode) {
  return MUSE_APPROVAL_MODE_FOR_SESSION_MODE[mode] ?? 'onRequest';
}

/**
 * Whether the adapter auto-approves the server-offered first choice under
 * the given MSP approval mode. Only `allowAll` (yolo) does.
 * @param {string} approvalMode - MSP approval mode (may be unset).
 * @returns {boolean}
 */
export function museApprovalModeAutoApproves(approvalMode) {
  return approvalMode === 'allowAll';
}

/**
 * Honest mode-selector copy for Muse sessions (finding #3): gated modes
 * request approval for each tool through the interactive prompt pipeline;
 * yolo auto-approves.
 */
export const MUSE_SESSION_MODE_COPY = Object.freeze({
  plan: Object.freeze({
    label: 'Plan',
    description: 'Plans first; Muse requests approval for each tool',
  }),
  standard: Object.freeze({
    label: 'Standard',
    description: 'Muse requests approval for each tool',
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
