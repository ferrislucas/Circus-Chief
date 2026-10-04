import { describe, expect, it } from 'vitest';
import { assertSingleProcessDeployment, DeploymentBoundaryError } from './deploymentBoundary.js';

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
