import { describe, expect, it } from 'vitest';
import {
  assertSingleProcessDeployment,
  classifyRuntimeEnvironment,
  DeploymentBoundaryError,
  RUNTIME_PREDICATES,
} from './deploymentBoundary.js';

describe('assertSingleProcessDeployment', () => {
  it('passes for a plain single-process environment', () => {
    expect(() => assertSingleProcessDeployment({ env: {}, isClusterWorker: false })).not.toThrow();
  });

  it('passes for an explicit single worker', () => {
    expect(() =>
      assertSingleProcessDeployment({ env: { CIRCUSCHIEF_WORKERS: '1', WEB_CONCURRENCY: '1' }, isClusterWorker: false })
    ).not.toThrow();
  });

  it.each([['CIRCUSCHIEF_WORKERS'], ['WEB_CONCURRENCY']])(
    'fails fast when %s requests multiple workers',
    (name) => {
      expect(() =>
        assertSingleProcessDeployment({ env: { [name]: '4' }, isClusterWorker: false })
      ).toThrow(DeploymentBoundaryError);
    }
  );

  it('fails fast for auto-resolved worker counts', () => {
    expect(() =>
      assertSingleProcessDeployment({ env: { WEB_CONCURRENCY: 'auto' }, isClusterWorker: false })
    ).toThrow(/single server process/);
  });

  it('fails fast when running as a Node.js cluster worker', () => {
    expect(() =>
      assertSingleProcessDeployment({ env: {}, isClusterWorker: true })
    ).toThrow(DeploymentBoundaryError);
  });

  it('ignores blank and non-numeric values', () => {
    expect(() =>
      assertSingleProcessDeployment({ env: { CIRCUSCHIEF_WORKERS: '', WEB_CONCURRENCY: 'one' }, isClusterWorker: false })
    ).not.toThrow();
  });
});

describe('classifyRuntimeEnvironment', () => {
  const blank = () => classifyRuntimeEnvironment({ env: {}, files: [], cgroup: '' });

  it('classifies a plain host as neither containerized nor orchestrated', () => {
    expect(blank()).toEqual({ containerized: false, orchestrated: false, signals: [] });
  });

  it('does not treat a bare cgroup v2 root as container evidence', () => {
    // Every modern Linux host carries `0::/` — without Docker/K8s markers
    // it proves nothing.
    expect(classifyRuntimeEnvironment({ env: {}, files: [], cgroup: '0::/\n' }))
      .toEqual({ containerized: false, orchestrated: false, signals: [] });
  });

  it('classifies Podman container env as containerized but not orchestrated', () => {
    expect(classifyRuntimeEnvironment({ env: { container: 'oci' }, files: [], cgroup: '' }))
      .toMatchObject({ containerized: true, orchestrated: false });
  });

  it('treats an empty container env value as absent', () => {
    expect(classifyRuntimeEnvironment({ env: { container: '' }, files: [], cgroup: '' }))
      .toEqual({ containerized: false, orchestrated: false, signals: [] });
  });

  it('classifies Docker cgroup markers as containerized', () => {
    const cgroup = '12:devices:/docker/9f8e7d6c5b4a3928173645a1b2c3d4e5f1234567890abcdef\n0::/\n';
    expect(classifyRuntimeEnvironment({ env: {}, files: [], cgroup }))
      .toMatchObject({ containerized: true, orchestrated: false });
  });

  it('classifies kubepods cgroup markers as orchestrated', () => {
    const cgroup = '0::/kubepods/besteffort/pod9f8e7d6c/router\n';
    expect(classifyRuntimeEnvironment({ env: {}, files: [], cgroup }))
      .toMatchObject({ containerized: true, orchestrated: true });
  });

  it('classifies Docker marker files as containerized', () => {
    expect(classifyRuntimeEnvironment({ env: {}, files: ['/.dockerenv'], cgroup: '' }))
      .toMatchObject({ containerized: true, orchestrated: false });
    expect(classifyRuntimeEnvironment({ env: {}, files: ['/run/.containerenv'], cgroup: '' }))
      .toMatchObject({ containerized: true, orchestrated: false });
  });

  it('treats a lone pod-name env value as unconfirmed (gated behind service-host confirmation)', () => {
    expect(classifyRuntimeEnvironment({ env: { KUBERNETES_POD_NAME: 'api-abc' }, files: [], cgroup: '' }))
      .toEqual({ containerized: false, orchestrated: false, signals: [] });
  });

  it('classifies service-host-confirmed Kubernetes env as orchestrated', () => {
    expect(classifyRuntimeEnvironment({
      env: { KUBERNETES_SERVICE_HOST: '10.0.0.1', KUBERNETES_POD_NAME: 'api-abc' },
      files: [],
      cgroup: '0::/\n',
    })).toMatchObject({ containerized: true, orchestrated: true });
  });

  it('exposes one predicate-table row per signal for matrix pinning', () => {
    expect(Array.isArray(RUNTIME_PREDICATES)).toBe(true);
    expect(RUNTIME_PREDICATES.length).toBeGreaterThan(0);
    for (const row of RUNTIME_PREDICATES) {
      expect(typeof row.name).toBe('string');
      expect(typeof row.test).toBe('function');
    }
    expect(RUNTIME_PREDICATES.map((row) => row.name)).toContain('cgroup-k8s');
  });
});

describe('assertSingleProcessDeployment orchestration warning', () => {
  it('warns (but does not fail) inside a confirmed orchestrated container', () => {
    const warnings = [];
    expect(() => assertSingleProcessDeployment({
      env: { KUBERNETES_SERVICE_HOST: '10.0.0.1' },
      files: [],
      cgroup: '0::/\n',
      isClusterWorker: false,
      warn: (message) => warnings.push(message),
    })).not.toThrow();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/single server process|one replica/i);
  });

  it('stays silent on a plain host and in plain (non-orchestrated) containers', () => {
    for (const deps of [
      { env: {}, files: [], cgroup: '0::/\n' },
      { env: { container: 'oci' }, files: [], cgroup: '' },
    ]) {
      const warnings = [];
      expect(() => assertSingleProcessDeployment({
        ...deps, isClusterWorker: false, warn: (message) => warnings.push(message),
      })).not.toThrow();
      expect(warnings).toEqual([]);
    }
  });
});
