import { beforeEach, describe, expect, it } from 'vitest';
import { commandOutputMetrics, COMMAND_OUTPUT_METRICS } from './commandOutputMetrics.js';

describe('command output metrics', () => {
  beforeEach(() => commandOutputMetrics.reset());

  it('exposes numeric counters and gauges without retaining output content', () => {
    commandOutputMetrics.increment(COMMAND_OUTPUT_METRICS.PRODUCED_BYTES, 12);
    commandOutputMetrics.setGauge(`${COMMAND_OUTPUT_METRICS.OUTPUT_SUBSCRIBERS}:run-1`, 2);

    expect(commandOutputMetrics.snapshot()).toEqual({
      counters: { producedBytes: 12 },
      gauges: { 'outputSubscribers:run-1': 2 },
    });
    expect(JSON.stringify(commandOutputMetrics.snapshot())).not.toContain('secret command output');
  });
});
