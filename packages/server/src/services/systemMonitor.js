import os from 'os';
import { execFile } from 'child_process';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
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
 * Compute memory metrics from OS.
 * @param {number} [totalBytes] - Total memory bytes (defaults to os.totalmem()); injectable for testing
 * @param {number} [freeBytes] - Free memory bytes (defaults to os.freemem()); injectable for testing
 * @returns {{ usedPercent: number, usedGB: number, totalGB: number }}
 */
export function computeMemoryMetrics(totalBytes = os.totalmem(), freeBytes = os.freemem()) {
  const usedBytes = totalBytes - freeBytes;

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
  const usedPercent = Math.round((usedKB / totalKB) * 1000) / 10;

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
    cpu: { usagePercent: cpuUsagePercent },
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
