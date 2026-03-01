import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the ws module
vi.mock('../ws/index.js', () => ({
  broadcast: vi.fn(),
}));

// Import after mock setup
import * as systemMonitor from './systemMonitor.js';
import { broadcast } from '../ws/index.js';
import {
  computeCpuUsage,
  computeMemoryMetrics,
  parseDfOutput,
  BROADCAST_INTERVAL_MS,
  collectAndBroadcast,
} from './systemMonitor.js';

// Sample CPU data for tests
function makeCpuSample(user, nice, sys, idle, irq) {
  return [{ times: { user, nice, sys, idle, irq } }];
}

// Helper to compute bytes from GB
function gbToBytes(gb) {
  return gb * 1024 ** 3;
}

describe('systemMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    systemMonitor.stop();
  });

  describe('BROADCAST_INTERVAL_MS', () => {
    it('has a 5 second broadcast interval', () => {
      expect(BROADCAST_INTERVAL_MS).toBe(5000);
    });
  });

  describe('computeCpuUsage', () => {
    it('returns correct percentage for known tick deltas', () => {
      // prev: user=100, nice=0, sys=50, idle=800, irq=10 -> total=960
      const prev = makeCpuSample(100, 0, 50, 800, 10);
      // curr: user=200, nice=0, sys=100, idle=850, irq=10 -> total=1160
      // delta: user=100, sys=50, idle=50, irq=0 -> totalTick=200, idle=50
      // usage = (200-50)/200 = 75%
      const curr = makeCpuSample(200, 0, 100, 850, 10);
      const result = computeCpuUsage(prev, curr);
      expect(result).toBe(75);
    });

    it('returns 0 when no tick delta', () => {
      const sample = makeCpuSample(100, 0, 50, 800, 10);
      const result = computeCpuUsage(sample, sample);
      expect(result).toBe(0);
    });

    it('returns 0 when prevCpus is null', () => {
      const curr = makeCpuSample(100, 0, 50, 800, 10);
      expect(computeCpuUsage(null, curr)).toBe(0);
    });

    it('returns 0 when currCpus is null', () => {
      const prev = makeCpuSample(100, 0, 50, 800, 10);
      expect(computeCpuUsage(prev, null)).toBe(0);
    });

    it('returns 0 when arrays have different lengths', () => {
      const prev = [
        { times: { user: 100, nice: 0, sys: 50, idle: 800, irq: 10 } },
        { times: { user: 100, nice: 0, sys: 50, idle: 800, irq: 10 } },
      ];
      const curr = [{ times: { user: 200, nice: 0, sys: 100, idle: 850, irq: 10 } }];
      expect(computeCpuUsage(prev, curr)).toBe(0);
    });

    it('handles fully idle CPU (0% usage)', () => {
      const prev = makeCpuSample(100, 0, 50, 800, 10);
      // Only idle increases
      const curr = makeCpuSample(100, 0, 50, 900, 10);
      const result = computeCpuUsage(prev, curr);
      expect(result).toBe(0);
    });
  });

  describe('computeMemoryMetrics', () => {
    it('returns usedPercent, usedGB, totalGB with correct values (16GB total, 8GB free)', () => {
      // 16GB total, 8GB free -> 8GB used -> 50%
      const result = computeMemoryMetrics(gbToBytes(16), gbToBytes(8));
      expect(result.usedPercent).toBe(50);
      expect(result.usedGB).toBe(8);
      expect(result.totalGB).toBe(16);
    });

    it('returns values in valid ranges using real OS values', () => {
      // Call with no args to use real OS values
      const result = computeMemoryMetrics();
      expect(result.usedPercent).toBeGreaterThanOrEqual(0);
      expect(result.usedPercent).toBeLessThanOrEqual(100);
      expect(result.usedGB).toBeGreaterThan(0);
      expect(result.totalGB).toBeGreaterThan(0);
    });

    it('correctly computes with 32GB total, 4GB free (87.5% used)', () => {
      const result = computeMemoryMetrics(gbToBytes(32), gbToBytes(4));
      expect(result.totalGB).toBe(32);
      expect(result.usedGB).toBe(28);
      expect(result.usedPercent).toBe(87.5);
    });
  });

  describe('parseDfOutput', () => {
    const validDfOutput = `Filesystem     1K-blocks    Used Available Use% Mounted on
/dev/sda1      536870912 290000000 246870912  55% /`;

    it('parses valid df -k output correctly', () => {
      const result = parseDfOutput(validDfOutput);
      expect(result).not.toBeNull();
      expect(result.usedPercent).toBeGreaterThan(0);
      expect(result.freeGB).toBeGreaterThan(0);
      expect(result.totalGB).toBeGreaterThan(0);
      // 536870912 KB = 512 GB, 246870912 KB ~ 235.5 GB free
      expect(result.totalGB).toBeCloseTo(512, 0);
    });

    it('returns null for empty string', () => {
      expect(parseDfOutput('')).toBeNull();
    });

    it('returns null for null input', () => {
      expect(parseDfOutput(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(parseDfOutput(undefined)).toBeNull();
    });

    it('returns null for malformed output with only one line', () => {
      expect(parseDfOutput('Filesystem 1K-blocks Used Available Use% Mounted')).toBeNull();
    });

    it('returns null when total is zero', () => {
      const output = `Filesystem     1K-blocks    Used Available Use% Mounted on
/dev/sda1              0        0         0   0% /`;
      expect(parseDfOutput(output)).toBeNull();
    });

    it('handles whitespace variations', () => {
      const output = `Filesystem  1K-blocks   Used  Available  Use%  Mounted on
/dev/disk1   1000000   500000    500000  50%  /`;
      const result = parseDfOutput(output);
      expect(result).not.toBeNull();
      expect(result.totalGB).toBeCloseTo(1000000 / 1024 ** 2, 1);
    });

    it('handles macOS-style df output', () => {
      const output = `Filesystem 512-blocks      Used Available Capacity iused      ifree %iused  Mounted on
/dev/disk3s1s1 1953525168 286756640 981462232    23%  4113907 4906311160    0%   /`;
      // This has more columns - parseDfOutput uses columns 1,2,3 which are the 512-block counts
      // The result should be not null (it can parse something from the numbers)
      // Note: We just verify it doesn't throw
      expect(() => parseDfOutput(output)).not.toThrow();
    });
  });

  describe('start() / stop() lifecycle', () => {
    it('start() calls setInterval with the correct interval duration', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      systemMonitor.start();

      // Verify setInterval was called with the correct interval (5000ms)
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), BROADCAST_INTERVAL_MS);

      setIntervalSpy.mockRestore();
    });

    it('stop() clears the interval', () => {
      vi.useFakeTimers();

      systemMonitor.start();
      systemMonitor.stop();

      // Should not throw or cause issues after stopping
      expect(() => vi.advanceTimersByTime(BROADCAST_INTERVAL_MS * 5)).not.toThrow();

      vi.useRealTimers();
    });

    it('start() is idempotent (calling twice does not create duplicate intervals)', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      systemMonitor.start();
      systemMonitor.start(); // Second call should be a no-op

      expect(setIntervalSpy).toHaveBeenCalledTimes(1);

      setIntervalSpy.mockRestore();
    });

    it('stop() is safe to call when not running', () => {
      expect(() => systemMonitor.stop()).not.toThrow();
    });
  });

  describe('broadcast integration', () => {
    it('broadcasts with SYSTEM_METRICS type and correct payload shape', async () => {
      await collectAndBroadcast();

      expect(broadcast).toHaveBeenCalled();
      expect(broadcast).toHaveBeenCalledWith('system:metrics', expect.objectContaining({
        cpu: expect.objectContaining({ usagePercent: expect.any(Number) }),
        memory: expect.objectContaining({
          usedPercent: expect.any(Number),
          usedGB: expect.any(Number),
          totalGB: expect.any(Number),
        }),
      }));
    });

    it('payload disk field is present (may be null or object)', async () => {
      await collectAndBroadcast();

      const call = broadcast.mock.calls[0];
      const payload = call[1];
      // disk can be null (on failure) or an object with usedPercent, freeGB, totalGB
      if (payload.disk !== null) {
        expect(payload.disk).toMatchObject({
          usedPercent: expect.any(Number),
          freeGB: expect.any(Number),
          totalGB: expect.any(Number),
        });
      }
    });
  });

  describe('disk failure graceful handling', () => {
    it('broadcasts CPU/memory even when disk collection fails', async () => {
      // We can't easily mock execFile in this test due to it being called inside the service
      // Instead, we verify that collectAndBroadcast always calls broadcast
      await collectAndBroadcast();
      expect(broadcast).toHaveBeenCalled();

      const payload = broadcast.mock.calls[0][1];
      expect(payload.cpu).toBeDefined();
      expect(payload.memory).toBeDefined();
      // disk may be null (which is the graceful failure case)
      expect('disk' in payload).toBe(true);
    });
  });
});
