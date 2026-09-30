import {
  buildParityCredentialError,
  checkParitySignals,
  findExecutableOnPath,
  redactSecretsFromText,
} from '../../services/parityDiagnostics.js';

/**
 * Pre-turn parity gate (FR-8). Hard-fails only on the signal that always
 * breaks the turn (missing muse binary); soft credential failures
 * (ssh-agent, gh-auth, git-identity) are recorded on `context` and logged
 * so the turn error path can attach actionable remediation instead of
 * failing startup. Never throws for soft failures.
 *
 * @param {Object} hostEnv - Built host env.
 * @param {Object} [opts] - `{ museBin, skipBinaries, context }`.
 */
export function assertMuseHostParity(hostEnv, { museBin = 'muse', skipBinaries = false, context = null } = {}) {
  const signals = checkParitySignals(hostEnv || {}, skipBinaries ? { skipBinaries: true } : {});
  const softKinds = new Set(['ssh-agent', 'gh-auth', 'git-identity']);
  const warnings = [];
  for (const signal of signals) {
    if (signal.ok || !softKinds.has(signal.signal)) continue;
    const kind = signal.signal;
    const failure = buildParityCredentialError(kind);
    warnings.push({ signal: kind, code: failure.code, remediation: failure.message });
  }
  if (!skipBinaries && !findExecutableOnPath(hostEnv || {}, museBin)) {
    throw buildParityCredentialError('muse-bin');
  }
  if (warnings.length > 0) {
    if (context) context.setParityWarnings(warnings);
    const summary = redactSecretsFromText(
      warnings.map((w) => `${w.signal}: ${w.remediation}`).join(' '),
      hostEnv || {},
    );
    console.warn(`[MuseAdapter] parity warnings: ${summary}`);
  }
  return warnings;
}

/**
 * Scrub secret values out of the failure and attach host diagnostics
 * (FR-11): the message, stderr tail, and parity remediation never carry
 * secret values — only presence/absence and remediation text.
 */
export function scrubAndAttachDiagnostics(err, host) {
  if (err?.code === 'MUSE_VERSION_MISMATCH' || err?.museHostDiagnostics) return err;
  const context = host.context;
  const hostEnv = context?.hostEnv || {};
  const scrub = (text) => redactSecretsFromText(text, hostEnv);
  const stderr = (context?.stderrTail || []).map((chunk) => scrub(String(chunk)));
  const state = context?.hostState || 'unknown';
  const exit = context?.hostExit?.kind ? `, exit=${context.hostExit.kind}` : '';
  const parityWarnings = (context?.parityWarnings || []).map((w) => ({
    signal: w.signal,
    code: w.code,
    remediation: scrub(w.remediation),
  }));
  const remediationSuffix = parityWarnings.length > 0
    ? ` Parity: ${parityWarnings.map((w) => scrub(w.remediation)).join(' ')}`
    : '';
  const suffix = ` Muse host state=${state}, pid=${host.pid}${exit}.${stderr.length > 0 ? ` Recent host stderr: ${stderr.join('\n')}` : ''}${remediationSuffix}`;
  // Preserve the error class and compatibility fields (notably the timeout
  // class used by callers) while adding diagnostics for the operator.
  // Object.assign (not member assignment) decorates the thrown error in
  // place, keeping its class and identity for callers that match on them.
  Object.assign(err, {
    message: scrub(`${err?.message || err}${suffix}`),
    museHostDiagnostics: { state, pid: host.pid, exit: context?.hostExit || null, stderrTail: stderr, parityWarnings },
  });
  return err;
}
