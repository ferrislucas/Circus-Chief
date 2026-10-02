/**
 * Single source of truth for the Muse (`muse serve`) headless approval
 * posture, shared by the server adapter and the web mode selector.
 *
 * Decision (review finding #2): in headless operation there is no user to
 * prompt, so every gated mode DENIES tool execution — including read-class
 * requests. The SDK approval request does carry tool-class signals
 * (`toolName`, `subject.kind`/`access`, `protectedWrite`), but a
 * `shell`-kind approval is code execution no matter how read-only its
 * command looks, so auto-approving "reads" would be dishonest gating.
 * Only `allowAll` (yolo) auto-approves the server-offered first choice.
 * The mode selector copy below says exactly that for Muse sessions, so
 * the UI never promises gating it does not enforce. Fail-closed: unknown
 * modes map to the deny posture.
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
 * Honest mode-selector copy for Muse sessions: gated modes deny tool
 * execution (the server cannot prompt), so tools require yolo.
 */
export const MUSE_SESSION_MODE_COPY = Object.freeze({
  plan: Object.freeze({
    label: 'Plan',
    description: 'Plans first; Muse runs no tools in this mode — switch to YOLO to allow tool execution',
  }),
  standard: Object.freeze({
    label: 'Standard',
    description: 'Muse runs no tools in this mode — switch to YOLO to allow tool execution',
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
