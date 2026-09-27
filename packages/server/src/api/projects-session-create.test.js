import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./projects-session-helpers.js', () => ({
  generateInitialName: vi.fn(),
  prepareSessionConfig: vi.fn(),
  applyTemplateOverrides: vi.fn(),
  resolveNextTemplateId: vi.fn(),
  buildSchedulingUpdate: vi.fn(),
  setupAndStartSession: vi.fn(),
}));

vi.mock('../websocket.js', () => ({
  broadcastToProject: vi.fn(),
}));

import { startSessionOrFail } from './projects-session-create.js';
import { setupAndStartSession } from './projects-session-helpers.js';

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

describe('startSessionOrFail', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('includes code and tierName when a tier is exhausted at startup', async () => {
    const exhausted = Object.assign(
      new Error('Model tier "Gold" could not start the session. Attempts: p/m — boom.'),
      { code: 'MODEL_TIER_EXHAUSTED', tierName: 'Gold' }
    );
    setupAndStartSession.mockRejectedValueOnce(exhausted);

    const res = makeRes();
    await startSessionOrFail({ params: { id: 'proj-1' } }, res, {
      session: { id: 'missing-session' },
      config: {},
      project: {},
      projectId: 'proj-1',
    });

    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe('MODEL_TIER_EXHAUSTED');
    expect(res.body.tierName).toBe('Gold');
    expect(res.body.error).toContain('Gold');
  });

  it('omits code and tierName for unstructured startup errors', async () => {
    setupAndStartSession.mockRejectedValueOnce(new Error('disk exploded'));

    const res = makeRes();
    await startSessionOrFail({ params: { id: 'proj-1' } }, res, {
      session: { id: 'missing-session' },
      config: {},
      project: {},
      projectId: 'proj-1',
    });

    expect(res.statusCode).toBe(500);
    expect(res.body).not.toHaveProperty('code');
    expect(res.body).not.toHaveProperty('tierName');
  });
});
