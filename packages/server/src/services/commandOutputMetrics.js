/**
 * Lightweight, in-memory diagnostics for command-output transport. Values are
 * deliberately numeric only: command output must never become telemetry.
 */
export const COMMAND_OUTPUT_METRICS = Object.freeze({
  PRODUCED_BYTES: 'producedBytes',
  PERSISTED_BYTES: 'persistedBytes',
  FLUSH_COUNT: 'flushCount',
  FLUSH_FAILURES: 'flushFailures',
  FLUSH_DURATION_MS: 'flushDurationMs',
  OUTPUT_BYTES_SENT: 'outputBytesSent',
  OUTPUT_RESYNCS: 'outputResyncs',
  BACKPRESSURE_EVENTS: 'backpressureEvents',
  OUTPUT_EVENTS: 'outputEvents',
  LIFECYCLE_EVENTS: 'lifecycleEvents',
  OUTPUT_SUBSCRIBERS: 'outputSubscribers',
});

class CommandOutputMetrics {
  #counters = new Map();
  #gauges = new Map();

  increment(name, amount = 1) {
    this.#counters.set(name, (this.#counters.get(name) || 0) + amount);
  }

  setGauge(name, value) {
    this.#gauges.set(name, value);
  }

  snapshot() {
    return { counters: Object.fromEntries(this.#counters), gauges: Object.fromEntries(this.#gauges) };
  }

  reset() {
    this.#counters.clear();
    this.#gauges.clear();
  }
}

export const commandOutputMetrics = new CommandOutputMetrics();
