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
  // CLI exec has no verified interactive approval protocol. Only the Circus
  // yolo posture is eligible; all other modes fail before spawning.
  if (options.approvalMode !== 'allowAll') {
    throw new Error('Muse exec currently supports only yolo/allowAll approval mode; interactive approvals are unavailable.');
  }
  args.push('--yolo');
  if (options.trustWorkspace) args.push('--trust-workspace');
  const text = composeCliPrompt(options.systemPrompt, prompt);
  if (promptFile) args.push('--prompt-file', promptFile);
  else args.push(text);
  return { command: museBin, args, cwd: workingDirectory, prompt: text };
}
