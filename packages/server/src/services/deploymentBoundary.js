import cluster from 'node:cluster';
import fs from 'node:fs';

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

// ── Runtime-environment predicate table ───────────────────────────────
// ONE table classifies containerized/orchestrated runtimes; every matrix
// cell is pinned by deploymentBoundary.test.js. Each row names the signal
// it detects so test failures identify the exact predicate at fault.
//
// Precision rules (the review's borderline cases):
// - A bare cgroup v2 root (`0::/`) proves nothing — every modern Linux host
//   carries it. The cgroup predicate fires only on Docker/K8s markers.
// - `container=` with an empty value is absent, not evidence.
// - Env-advertised cluster values (pod name/namespace/ports) count only
//   behind KUBERNETES_SERVICE_HOST confirmation — the kubelet-injected
//   anchor that cannot be a stale leftover. The service host itself (or an
//   unspoofable cgroup kubepods marker) is sufficient confirmation.
const DOCKERENV_MARKER = '/.dockerenv';
const CONTAINERENV_MARKER = '/run/.containerenv';

function hasText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function hasServiceHostConfirmation(env) {
  return hasText(env?.KUBERNETES_SERVICE_HOST);
}

function hasK8sCgroupMarker(cgroup) {
  return typeof cgroup === 'string' && /(^|\/)(kubepods|kube-[a-z0-9-]+|io\.kubernetes)(\/|$)/.test(cgroup);
}

function hasDockerCgroupMarker(cgroup) {
  return typeof cgroup === 'string' && /(^|\/)(docker|docker-[0-9a-f]{64,}|lxc)(\/|$|:)/.test(cgroup);
}

export const RUNTIME_PREDICATES = [
  {
    name: 'dockerenv-file',
    containerized: true,
    test: ({ files = [] }) => files.includes(DOCKERENV_MARKER),
  },
  {
    name: 'containerenv-file',
    containerized: true,
    test: ({ files = [] }) => files.includes(CONTAINERENV_MARKER),
  },
  {
    name: 'container-env',
    containerized: true,
    test: ({ env = {} }) => hasText(env?.container),
  },
  {
    name: 'cgroup-docker',
    containerized: true,
    test: ({ cgroup = '' }) => hasDockerCgroupMarker(cgroup),
  },
  {
    name: 'cgroup-k8s',
    containerized: true,
    orchestrated: true,
    test: ({ cgroup = '' }) => hasK8sCgroupMarker(cgroup),
  },
  {
    name: 'kubernetes-confirmed',
    containerized: true,
    orchestrated: true,
    test: ({ env = {} }) => hasServiceHostConfirmation(env),
  },
];

/**
 * Classify the runtime environment from injected evidence (env, present
 * marker files, cgroup content). Pure and hermetic: production callers pass
 * live values, tests pin each matrix cell with fixtures.
 *
 * @param {{ env?: Object, files?: Array<string>, cgroup?: string }} [evidence]
 * @returns {{ containerized: boolean, orchestrated: boolean, signals: Array<string> }}
 */
export function classifyRuntimeEnvironment({ env = {}, files = [], cgroup = '' } = {}) {
  const evidence = { env: env || {}, files: files || [], cgroup: cgroup || '' };
  const signals = RUNTIME_PREDICATES.filter((row) => {
    try {
      return row.test(evidence) === true;
    } catch {
      return false;
    }
  }).map((row) => row.name);
  const matched = new Set(signals);
  return {
    containerized: RUNTIME_PREDICATES.some((row) => row.containerized && matched.has(row.name)),
    orchestrated: RUNTIME_PREDICATES.some((row) => row.orchestrated && matched.has(row.name)),
    signals,
  };
}

function readLiveCgroup() {
  for (const path of ['/proc/self/cgroup', '/proc/1/cgroup']) {
    try {
      return fs.readFileSync(path, 'utf8');
    } catch {
      // Not a Linux host, or unreadable — treat as no cgroup evidence.
    }
  }
  return '';
}

function listLiveMarkerFiles() {
  return [DOCKERENV_MARKER, CONTAINERENV_MARKER].filter((path) => {
    try {
      return fs.existsSync(path);
    } catch {
      return false;
    }
  });
}

/**
 * Fail fast when the runtime requests an unsupported multi-process topology.
 *
 * @param {{ env?: NodeJS.ProcessEnv, isClusterWorker?: boolean, files?: Array<string>, cgroup?: string, warn?: (message: string) => void }} [deps]
 * @throws {DeploymentBoundaryError}
 */
export function assertSingleProcessDeployment({
  env = process.env,
  isClusterWorker = cluster.isWorker,
  files = listLiveMarkerFiles(),
  cgroup = readLiveCgroup(),
  warn = (message) => console.warn(message),
} = {}) {
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
  // Orchestrated containers (replica counts the process cannot see) get a
  // warning, not a failure: a single-replica deployment is fully supported,
  // but the operator must guarantee the replica count is exactly one.
  // Plain containers and bare hosts are silent — one container is one process.
  const classification = classifyRuntimeEnvironment({ env, files, cgroup });
  if (classification.orchestrated) {
    warn(
      'Circus Chief tiers require a single server process per database, but this process runs inside an ' +
      `orchestrated container (${classification.signals.join(', ')}), where the replica count cannot be verified. ` +
      'Ensure exactly one replica serves each database, or tier cooldown, stale-echo, and catalog-revision ' +
      'state will diverge across replicas and silently defeat failover protection.'
    );
  }
  return classification;
}
