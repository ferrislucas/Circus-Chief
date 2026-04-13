import os from 'os';
import fs from 'fs';
import { execFile, execFileSync } from 'child_process';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { broadcast } from '../ws/index.js';

// Broadcast interval in milliseconds (5 seconds)
const BROADCAST_INTERVAL_MS = 5000;

// Interval handle
let intervalId = null;

// Previous CPU sample for delta computation
let prevCpus = null;

/**
 * Compute CPU usage percentage from two cpu samples.
 * @param {os.CpuInfo[]} prevCpus
 * @param {os.CpuInfo[]} currCpus
 * @returns {number} CPU usage percent (0-100)
 */
export function computeCpuUsage(prevCpuSamples, currCpuSamples) {
  if (!prevCpuSamples || !currCpuSamples || prevCpuSamples.length !== currCpuSamples.length) {
    return 0;
  }

  let totalIdle = 0;
  let totalTick = 0;

  for (let i = 0; i < currCpuSamples.length; i++) {
    const prev = prevCpuSamples[i].times;
    const curr = currCpuSamples[i].times;

    const idleDelta = curr.idle - prev.idle;
    const userDelta = curr.user - prev.user;
    const niceDelta = curr.nice - prev.nice;
    const sysDelta = curr.sys - prev.sys;
    const irqDelta = curr.irq - prev.irq;

    const tickDelta = idleDelta + userDelta + niceDelta + sysDelta + irqDelta;

    totalIdle += idleDelta;
    totalTick += tickDelta;
  }

  if (totalTick === 0) return 0;

  const usagePercent = ((totalTick - totalIdle) / totalTick) * 100;
  return Math.round(usagePercent * 10) / 10;
}

/**
 * Get available memory bytes using platform-specific methods.
 *
 * os.freemem() only reports truly "free" memory, ignoring reclaimable
 * caches and buffers. On macOS especially, this makes memory appear nearly
 * exhausted even when the system is not under pressure.
 *
 * - macOS: uses vm_stat to sum free + purgeable + speculative pages
 * - Linux: reads MemAvailable from /proc/meminfo
 * - Fallback: os.freemem()
 *
 * @returns {number} Available memory in bytes
 */
export function getAvailableMemoryBytes() {
  const platform = os.platform();

  if (platform === 'darwin') {
    try {
      const stdout = execFileSync('vm_stat', { encoding: 'utf8', timeout: 3000 });
      return parseVmStatOutput(stdout);
    } catch {
      return os.freemem();
    }
  }

  if (platform === 'linux') {
    try {
      const content = fs.readFileSync('/proc/meminfo', 'utf8');
      return parseMemInfoOutput(content);
    } catch {
      return os.freemem();
    }
  }

  return os.freemem();
}

/**
 * Parse macOS vm_stat output to compute available memory bytes.
 *
 * macOS categorises physical pages as:
 *   - free:        truly unused
 *   - inactive:    not recently accessed, reclaimable immediately
 *   - speculative: speculatively allocated, reclaimable
 *   - purgeable:   marked purgeable by apps, reclaimable
 *   - active:      recently accessed by running processes
 *   - wired:       locked by the kernel, cannot be paged out
 *   - compressed:  compressed in the compressor
 *
 * "Available" = free + inactive + purgeable + speculative
 * This matches what macOS considers available (not under pressure).
 *
 * @param {string} stdout - Output from vm_stat command
 * @returns {number} Available memory in bytes
 */
export function parseVmStatOutput(stdout) {
  if (!stdout || typeof stdout !== 'string') return os.freemem();

  // First line contains page size, e.g. "Mach Virtual Memory Statistics: (page size of 16384 bytes)"
  const pageSizeMatch = stdout.match(/page size of (\d+) bytes/);
  const pageSize = pageSizeMatch ? parseInt(pageSizeMatch[1], 10) : 16384;

  // Parse page counts - vm_stat format: "Pages free:    123456."
  const getValue = (label) => {
    const match = stdout.match(new RegExp(`${label}:\\s+(\\d+)`));
    return match ? parseInt(match[1], 10) : 0;
  };

  const free = getValue('Pages free');
  const inactive = getValue('Pages inactive');
  const purgeable = getValue('Pages purgeable');
  const speculative = getValue('Pages speculative');

  const availableBytes = (free + inactive + purgeable + speculative) * pageSize;

  // Sanity check: if result is 0 or unreasonably small, fall back
  if (availableBytes <= 0) return os.freemem();

  return availableBytes;
}

/**
 * Parse Linux /proc/meminfo to get MemAvailable.
 *
 * @param {string} content - Contents of /proc/meminfo
 * @returns {number} Available memory in bytes
 */
export function parseMemInfoOutput(content) {
  if (!content || typeof content !== 'string') return os.freemem();

  const match = content.match(/MemAvailable:\s+(\d+)\s+kB/);
  if (!match) return os.freemem();

  return parseInt(match[1], 10) * 1024;
}

/**
 * Compute memory metrics from OS.
 * @param {number} [totalBytes] - Total memory bytes (defaults to os.totalmem()); injectable for testing
 * @param {number} [availableBytes] - Available memory bytes (defaults to platform-aware available memory); injectable for testing
 * @returns {{ usedPercent: number, usedGB: number, totalGB: number }}
 */
export function computeMemoryMetrics(totalBytes = os.totalmem(), availableBytes = getAvailableMemoryBytes()) {
  const usedBytes = totalBytes - availableBytes;

  const totalGB = Math.round((totalBytes / (1024 ** 3)) * 10) / 10;
  const usedGB = Math.round((usedBytes / (1024 ** 3)) * 10) / 10;
  const usedPercent = Math.round((usedBytes / totalBytes) * 1000) / 10;

  return { usedPercent, usedGB, totalGB };
}

/**
 * Parse `df -k /` output to extract disk metrics.
 * @param {string} stdout
 * @returns {{ usedPercent: number, freeGB: number, totalGB: number } | null}
 */
export function parseDfOutput(stdout) {
  if (!stdout || typeof stdout !== 'string') return null;

  const lines = stdout.trim().split('\n');
  // df output: header line + data line(s)
  // We want the second line (index 1)
  if (lines.length < 2) return null;

  const dataLine = lines[1].trim();
  if (!dataLine) return null;

  // df -k columns: Filesystem 1K-blocks Used Available Use% Mounted-on
  const parts = dataLine.split(/\s+/);
  if (parts.length < 5) return null;

  const totalKB = parseInt(parts[1], 10);
  const usedKB = parseInt(parts[2], 10);
  const availKB = parseInt(parts[3], 10);

  if (isNaN(totalKB) || isNaN(usedKB) || isNaN(availKB) || totalKB === 0) return null;

  const totalGB = Math.round((totalKB / (1024 ** 2)) * 10) / 10;
  const freeGB = Math.round((availKB / (1024 ** 2)) * 10) / 10;
  // Use (total - available) instead of "used" column for usedPercent.
  // On macOS APFS, the Used column only reports one volume snapshot, not total usage.
  // On Linux, Used + Available ≠ Total due to reserved blocks.
  const effectiveUsedKB = totalKB - availKB;
  const usedPercent = Math.round((effectiveUsedKB / totalKB) * 1000) / 10;

  return { usedPercent, freeGB, totalGB };
}

/**
 * Collect disk metrics using df command.
 * Returns null if df is unavailable or fails.
 * @returns {Promise<{ usedPercent: number, freeGB: number, totalGB: number } | null>}
 */
async function collectDiskMetrics() {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    execFile('df', ['-k', '/'], { signal: controller.signal }, (error, stdout) => {
      clearTimeout(timeout);
      if (error) {
        resolve(null);
        return;
      }
      resolve(parseDfOutput(stdout));
    });
  });
}

/**
 * Collect and broadcast system metrics.
 */
async function collectAndBroadcast() {
  // CPU: sample current, compute delta from previous
  const currCpus = os.cpus();
  const cpuUsagePercent = computeCpuUsage(prevCpus, currCpus);
  prevCpus = currCpus;

  // Memory
  const memory = computeMemoryMetrics();

  // Disk (may be null on failure or Windows)
  const disk = await collectDiskMetrics();

  const payload = {
    cpu: {
      usagePercent: cpuUsagePercent,
      coreCount: currCpus.length,
      model: currCpus[0]?.model || 'Unknown',
    },
    memory,
    disk,
  };

  broadcast(WS_MESSAGE_TYPES.SYSTEM_METRICS, payload);
}

/**
 * Start the system monitor service.
 * Broadcasts system metrics every 5 seconds.
 */
export function start() {
  if (intervalId) {
    console.log('[SystemMonitor] Already running');
    return;
  }

  console.log('[SystemMonitor] Starting system metrics broadcast');

  // Take initial CPU sample before first interval fires
  prevCpus = os.cpus();

  intervalId = setInterval(collectAndBroadcast, BROADCAST_INTERVAL_MS);
}

/**
 * Stop the system monitor service.
 */
export function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    prevCpus = null;
    console.log('[SystemMonitor] Stopped system metrics broadcast');
  }
}

// Export for testing
export { BROADCAST_INTERVAL_MS, collectAndBroadcast };
