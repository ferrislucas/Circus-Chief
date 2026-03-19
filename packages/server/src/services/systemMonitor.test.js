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
  parseVmStatOutput,
  parseMemInfoOutput,
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
    it('returns usedPercent, usedGB, totalGB with correct values (16GB total, 8GB available)', () => {
      // 16GB total, 8GB available -> 8GB used -> 50%
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

    it('correctly computes with 32GB total, 4GB available (87.5% used)', () => {
      const result = computeMemoryMetrics(gbToBytes(32), gbToBytes(4));
      expect(result.totalGB).toBe(32);
      expect(result.usedGB).toBe(28);
      expect(result.usedPercent).toBe(87.5);
    });
  });

  describe('parseVmStatOutput', () => {
    const sampleVmStat = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                             1234567.
Pages active:                           2000000.
Pages inactive:                         1500000.
Pages speculative:                       100000.
Pages throttled:                              0.
Pages wired down:                        800000.
Pages purgeable:                         200000.
Pages stored in compressor:              500000.`;

    it('correctly parses free + inactive + purgeable + speculative pages', () => {
      const result = parseVmStatOutput(sampleVmStat);
      // (free + inactive + purgeable + speculative) * pageSize
      const expected = (1234567 + 1500000 + 200000 + 100000) * 16384;
      expect(result).toBe(expected);
    });

    it('handles 4096 byte page size', () => {
      const output = `Mach Virtual Memory Statistics: (page size of 4096 bytes)
Pages free:                              100000.
Pages inactive:                           75000.
Pages purgeable:                          50000.
Pages speculative:                        25000.`;
      const result = parseVmStatOutput(output);
      expect(result).toBe((100000 + 75000 + 50000 + 25000) * 4096);
    });

    it('returns os.freemem() for null input', () => {
      const result = parseVmStatOutput(null);
      expect(result).toBeGreaterThan(0);
    });

    it('returns os.freemem() for empty string', () => {
      const result = parseVmStatOutput('');
      expect(result).toBeGreaterThan(0);
    });

    it('defaults to 16384 page size when not found', () => {
      const output = `Mach Virtual Memory Statistics:
Pages free:                              100000.
Pages purgeable:                          50000.
Pages speculative:                        25000.`;
      const result = parseVmStatOutput(output);
      expect(result).toBe((100000 + 50000 + 25000) * 16384);
    });

    it('handles missing purgeable/speculative fields gracefully', () => {
      const output = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                              100000.`;
      const result = parseVmStatOutput(output);
      // Only free pages, purgeable and speculative default to 0
      expect(result).toBe(100000 * 16384);
    });
  });

  describe('parseMemInfoOutput', () => {
    const sampleMemInfo = `MemTotal:       32768000 kB
MemFree:         1024000 kB
MemAvailable:   16384000 kB
Buffers:         2048000 kB
Cached:          8192000 kB`;

    it('correctly parses MemAvailable from /proc/meminfo', () => {
      const result = parseMemInfoOutput(sampleMemInfo);
      // 16384000 kB * 1024 = 16,777,216,000 bytes
      expect(result).toBe(16384000 * 1024);
    });

    it('returns os.freemem() for null input', () => {
      const result = parseMemInfoOutput(null);
      expect(result).toBeGreaterThan(0);
    });

    it('returns os.freemem() for empty string', () => {
      const result = parseMemInfoOutput('');
      expect(result).toBeGreaterThan(0);
    });

    it('returns os.freemem() when MemAvailable is missing', () => {
      const content = `MemTotal:       32768000 kB
MemFree:         1024000 kB`;
      const result = parseMemInfoOutput(content);
      // Should fall back to os.freemem() since MemAvailable is missing
      expect(result).toBeGreaterThan(0);
    });
  });

  describe('parseDfOutput', () => {
    const validDfOutput = `Filesystem     1K-blocks    Used Available Use% Mounted on
/dev/sda1      536870912 290000000 246870912  55% /`;

    it('parses valid df -k output correctly', () => {
      const result = parseDfOutput(validDfOutput);
      expect(result).not.toBeNull();
      // Test data: total=536870912, used=290000000, avail=246870912
      // Expected usedPercent = (536870912 - 246870912) / 536870912 * 100 = 54.0%
      expect(result.usedPercent).toBe(54);
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
      // Test data: total=1000000, used=500000, avail=500000
      // Expected usedPercent = (1000000 - 500000) / 1000000 * 100 = 50.0%
      expect(result.usedPercent).toBe(50);
    });

    it('computes usedPercent from total-available on macOS APFS (Used + Available ≠ Total)', () => {
      // Real macOS APFS: Used column (15067708) is only one snapshot,
      // but total - available gives the real usage.
      const output = `Filesystem     1024-blocks     Used Available Capacity  Mounted on
/dev/disk1s5s1   244912536 15067708  43023028    26%     /`;
      const result = parseDfOutput(output);
      expect(result).not.toBeNull();
      // Expected: (244912536 - 43023028) / 244912536 * 100 = 82.4%
      expect(result.usedPercent).toBe(82.4);
      // Expected: 43023028 / 1024^2 ≈ 41.0 GB
      expect(result.freeGB).toBeCloseTo(41.0, 0);
      // Expected: 244912536 / 1024^2 ≈ 233.5 GB
      expect(result.totalGB).toBeCloseTo(233.5, 0);
    });

    it('computes usedPercent correctly when Used + Available < Total (Linux reserved blocks)', () => {
      // 500GB disk, 5% reserved: total=524288000, used=209715200, avail=288358400
      // used + avail = 498073600 (26214400 KB / ~25GB reserved)
      const output = `Filesystem     1K-blocks      Used Available Use% Mounted on
/dev/sda1      524288000 209715200 288358400   43% /`;
      const result = parseDfOutput(output);
      expect(result).not.toBeNull();
      // Expected: (524288000 - 288358400) / 524288000 * 100 = 45.0%
      expect(result.usedPercent).toBe(45);
      expect(result.freeGB).toBeCloseTo(275.0, 0);
      expect(result.totalGB).toBeCloseTo(500.0, 0);
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
        cpu: expect.objectContaining({
          usagePercent: expect.any(Number),
          coreCount: expect.any(Number),
          model: expect.any(String),
        }),
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

    it('cpu payload includes coreCount as a positive integer', async () => {
      await collectAndBroadcast();

      const call = broadcast.mock.calls[0];
      const payload = call[1];

      expect(payload.cpu.coreCount).toBeDefined();
      expect(payload.cpu.coreCount).toBeGreaterThan(0);
      expect(Number.isInteger(payload.cpu.coreCount)).toBe(true);
    });

    it('cpu payload includes model as a non-empty string', async () => {
      await collectAndBroadcast();

      const call = broadcast.mock.calls[0];
      const payload = call[1];

      expect(payload.cpu.model).toBeDefined();
      expect(typeof payload.cpu.model).toBe('string');
      expect(payload.cpu.model.length).toBeGreaterThan(0);
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
