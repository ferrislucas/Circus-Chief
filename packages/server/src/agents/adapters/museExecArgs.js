import { composeCliPrompt } from './cliUtils.js';

export const MUSE_EXEC_PROMPT_FILE_THRESHOLD = 24 * 1024;

/** Build documented `muse exec --json` arguments without invoking a shell. */
export function buildMuseExecArgs({ prompt, options = {}, workingDirectory, sessionId, museBin = process.env.MUSE_BIN || 'muse', promptFile } = {}) {
  if (!workingDirectory || !String(workingDirectory).startsWith('/')) {
    throw new Error('Muse exec requires an absolute working directory.');
  }
  const args = ['exec', '--json', '--workspace', workingDirectory];
  if (sessionId) args.push('--session-id', sessionId);
  if (options.model) args.push('--model', String(options.model));
  if (options.effortLevel && options.effortLevel !== 'auto') {
    if (!['low', 'medium', 'high', 'max'].includes(options.effortLevel)) throw new Error(`Unsupported Muse reasoning effort: ${options.effortLevel}`);
    args.push('--reasoning-effort', options.effortLevel);
  }
  args.push(...museExecApprovalFlags(options.approvalMode));
  const text = composeCliPrompt(options.systemPrompt, prompt);
  if (promptFile) args.push('--prompt-file', promptFile);
  else args.push(text);
  return { command: museBin, args, cwd: workingDirectory, prompt: text };
}

/**
 * Map the internal approval posture to `muse exec` CLI flags.
 *
 * Exec is headless: there is no interactive approval round-trip, so gated
 * modes enforce policy via CLI flags and denials surface as run failures /
 * denial text in the transcript. Only the yolo posture (`allowAll`)
 * disables enforcement. Unset fails closed to the standard posture.
 * Posture vocabulary comes from `getMuseApprovalModeForSession`
 * (`allowAll | onRequest | promptUnmatched | denyUnmatched`). `denyUnmatched`
 * is stricter than `promptUnmatched`, so it takes the strictest CLI posture
 * (`never` with writes disabled).
 */
function museExecApprovalFlags(approvalMode) {
  if (approvalMode === 'allowAll') return ['--yolo'];
  if (!approvalMode || approvalMode === 'onRequest') return ['--approval-mode', 'on-request'];
  if (approvalMode === 'promptUnmatched') return ['--approval-mode', 'untrusted', '--disable-write'];
  if (approvalMode === 'denyUnmatched') return ['--approval-mode', 'never', '--disable-write'];
  throw new Error(`Unsupported Muse approval mode: ${approvalMode}`);
}
