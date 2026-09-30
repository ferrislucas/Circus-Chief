/**
 * Mutable per-turn state shared across the Muse host/turn helpers. State
 * changes go through methods (not member assignment on a parameter) so the
 * helpers pass the repo's no-param-reassign gate.
 */
export function createMuseTurnContext(correlationId) {
  return {
    correlationId,
    timings: { startedAt: Date.now() },
    stderrTail: [],
    hostState: 'connecting',
    hostExit: null,
    hostEnv: null,
    cliVersion: null,
    sessionId: null,
    parityWarnings: [],
    cancelled: false,
    shutdown: null,
    setHostEnv(env) { this.hostEnv = env; },
    setSessionId(id) { this.sessionId = id; },
    setCliVersion(version) { this.cliVersion = version; },
    setHostState(state, exit = null) {
      this.hostState = state;
      this.hostExit = exit;
    },
    setParityWarnings(warnings) { this.parityWarnings = warnings; },
    markTime(key) { this.timings[key] = Date.now() - this.timings.startedAt; },
    markCancelled() { this.cancelled = true; },
    markShutdown(outcome) { this.shutdown = outcome; },
    pushStderr(text) {
      this.stderrTail.push(text);
      while (this.stderrTail.length > 8) this.stderrTail.shift();
      while (this.stderrTail.join('\n').length > 2_000) this.stderrTail.shift();
    },
  };
}
