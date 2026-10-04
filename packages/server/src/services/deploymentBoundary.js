import cluster from 'node:cluster';

/**
 * deploymentBoundary.js — the SINGLE OWNER of the tier feature's deployment
 * consistency boundary.
 *
 * Tier failover coordinates through process-local state: the member cooldown
 * map (`tierResolutionService`), the stale-tier echo registry
 * (`tierDegradationNotifier`), and the catalog-invalidation revision counter
 * (`catalogInvalidation`). A second server process (or worker) would hold a
 * divergent copy of all three: it would retry members the first process just
 * cooled down, accept stale echoes the first process already consumed, and
 * emit duplicate catalog revisions — silently defeating every protection the
 * remediation plan put in place.
 *
 * Supported topology: exactly ONE server process owns the catalog and the
 * tier state. This module enforces that at boot: an explicit multi-worker
 * configuration (process-manager worker counts, or running as a Node.js
 * cluster worker) fails fast with an actionable message instead of starting
 * into split-brain operation. Documentation of the boundary lives in
 * `docs/development.md` (§ Model Tiers); this runtime check is what makes it
 * more than documentation.
 */

export class DeploymentBoundaryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DeploymentBoundaryError';
  }
}

// Explicit worker-count knobs honored by common process managers. Any value
// above 1 (including 'auto', which resolves to the CPU count) starts
// concurrent server processes sharing one database — unsupported.
const WORKER_COUNT_ENV_VARS = ['CIRCUSCHIEF_WORKERS', 'WEB_CONCURRENCY'];

function parseWorkerCount(raw) {
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'auto') return Number.POSITIVE_INFINITY;
  const count = Number(normalized);
  return Number.isFinite(count) ? count : 0;
}

/**
 * Fail fast when the runtime requests an unsupported multi-process topology.
 *
 * @param {{ env?: NodeJS.ProcessEnv, isClusterWorker?: boolean }} [deps]
 * @throws {DeploymentBoundaryError}
 */
export function assertSingleProcessDeployment({ env = process.env, isClusterWorker = cluster.isWorker } = {}) {
  if (isClusterWorker) {
    throw new DeploymentBoundaryError(
      'Circus Chief tiers require a single server process, but this process is a Node.js cluster worker. ' +
      'Run one server process per database (no cluster fork, no multi-worker process manager).'
    );
  }
  for (const name of WORKER_COUNT_ENV_VARS) {
    const raw = env?.[name];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    if (parseWorkerCount(raw) > 1) {
      throw new DeploymentBoundaryError(
        `Circus Chief tiers require a single server process, but ${name}=${raw} requests multiple workers. ` +
        'Run exactly one server process per database: tier cooldown, stale-echo, and catalog-revision state is process-local ' +
        'and diverges across workers, silently defeating failover protection.'
      );
    }
  }
}
