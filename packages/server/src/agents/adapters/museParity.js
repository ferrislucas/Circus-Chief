import {
  buildParityCredentialError,
  checkParitySignals,
  findExecutableOnPath,
  redactSecretsFromText,
} from '../../services/parityDiagnostics.js';

/**
 * Whether a turn failure plausibly implicates the host parity signals, and
 * therefore deserves the credential-remediation suffix (finding #7).
 * Timeouts, aborts, and cancellations are scheduling/liveness failures, not
 * credential failures — decorating them with ssh-agent/gh-auth remediation
 * is noise. Everything else (auth errors, spawn failures, turn errors)
 * keeps the remediation. Deliberately code/name-based, never message
 * substring-based: a credential error whose message happens to mention a
 * timeout must keep its remediation.
 *
 * @param {Error} err - The turn failure.
 * @returns {boolean} True when parity remediation is relevant to the failure.
 */
export function isParityRemediationRelevant(err) {
  if (err?.code === 'MUSE_TURN_TIMEOUT') return false;
  if (typeof err?.code === 'string' && /ABORT|CANCEL/i.test(err.code)) return false;
  if (/aborterror/i.test(err?.name || '')) return false;
  return true;
}

/**
 * Pre-turn parity gate (FR-8). Hard-fails only on the signal that always
 * breaks the turn (missing muse binary); soft credential failures
 * (ssh-agent, gh-auth, git-identity, home, identity) are recorded on
 * `context` and logged so the turn error path can attach actionable
 * remediation instead of failing startup. Never throws for soft failures.
 *
 * @param {Object} hostEnv - Built host env.
 * @param {Object} [opts] - `{ museBin, skipBinaries, context }`.
 */
export function assertMuseHostParity(hostEnv, { museBin = 'muse', skipBinaries = false, context = null } = {}) {
  const signals = checkParitySignals(hostEnv || {}, skipBinaries ? { skipBinaries: true } : {});
  const softKinds = new Set(['ssh-agent', 'gh-auth', 'git-identity', 'home', 'identity']);
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
 * Host-exit label for the diagnostics suffix (`, exit=<kind>` or empty).
 */
function museHostExitLabel(hostExit) {
  return hostExit?.kind ? `, exit=${hostExit.kind}` : '';
}

/**
 * Credential-remediation suffix for the diagnostics message.
 * Finding #7: only failures that plausibly implicate the parity signals
 * carry it — timeouts/aborts would just be noise. The structured
 * parityWarnings stay in museHostDiagnostics for the UI regardless.
 */
function parityRemediationSuffix(parityWarnings, scrub, err) {
  if (parityWarnings.length === 0 || !isParityRemediationRelevant(err)) return '';
  return ` Parity: ${parityWarnings.map((w) => scrub(w.remediation)).join(' ')}`;
}

/**
 * Recent-stderr clause for the diagnostics suffix (empty when no tail).
 */
function museStderrClause(stderr) {
  return stderr.length > 0 ? ` Recent host stderr: ${stderr.join('\n')}` : '';
}

/**
 * Scrub secret values out of the failure and attach host diagnostics
 * (FR-11): the message, stderr tail, and parity remediation never carry
 * secret values — only presence/absence and remediation text.
 */
export function scrubAndAttachDiagnostics(err, host) {
  if (err?.code === 'MUSE_VERSION_MISMATCH' || err?.museHostDiagnostics) return err;
  // Finding #5: failures that never reached a host (preflight throws, SDK
  // import errors) arrive with no host — return the error untouched instead
  // of throwing a TypeError off `host.context`.
  if (!host || typeof host !== 'object' || !host.context) return err;
  const context = host.context;
  const hostEnv = context?.hostEnv || {};
  const scrub = (text) => redactSecretsFromText(text, hostEnv);
  const stderr = (context?.stderrTail || []).map((chunk) => scrub(String(chunk)));
  const state = context?.hostState || 'unknown';
  const exit = museHostExitLabel(context?.hostExit);
  const parityWarnings = (context?.parityWarnings || []).map((w) => ({
    signal: w.signal,
    code: w.code,
    remediation: scrub(w.remediation),
  }));
  const suffix = ` Muse host state=${state}, pid=${host.pid}${exit}.${museStderrClause(stderr)}${parityRemediationSuffix(parityWarnings, scrub, err)}`;
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

/**
 * Map a missing-binary failure onto the actionable MUSE_CLI_NOT_FOUND error
 * (FR-1/FR-8). Applies to both the spawn and the CLI-version preflight
 * (finding #1): a raw `spawn muse ENOENT` from either tells the user
 * nothing. Known Muse error codes and anything that does not look like a
 * lookup failure pass through untouched.
 * @param {Error} err
 * @returns {Error}
 */
export function toMuseNotFoundError(err) {
  if (err?.code === 'MUSE_SDK_NOT_INSTALLED') return err;
  const message = `${err?.message || ''} ${err?.cause?.message || ''}`;
  if (err?.code === 'ENOENT' || err?.cause?.code === 'ENOENT' || /ENOENT|not found/i.test(message)) {
    const notFound = new Error(
      'Muse CLI not found. Install Muse Code and ensure `muse` is on PATH (or set MUSE_BIN).'
    );
    notFound.code = 'MUSE_CLI_NOT_FOUND';
    notFound.cause = err;
    return notFound;
  }
  return err;
}
