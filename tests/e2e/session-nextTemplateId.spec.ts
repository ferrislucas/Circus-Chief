import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedProjectTemplate,
  getSession,
  cleanupCreatedResources,
  getAPIURL,
} from './helpers';

const API_URL = getAPIURL();

test.describe('Session Creation - nextTemplateId', () => {
  let project: any;
  let templateA: any;
  let templateB: any;

  test.beforeEach(async () => {
    project = await seedProject('NextTemplate Test', '/tmp/test');
    templateA = await seedProjectTemplate(project.id, {
      name: 'Template A',
      prompt: 'Prompt A',
      thinkingEnabled: true,
      gitBranch: 'feature/a',
    });
    templateB = await seedProjectTemplate(project.id, {
      name: 'Template B',
      prompt: 'Prompt B',
    });
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('sets nextTemplateId when provided without templateId', async () => {
    const response = await fetch(`${API_URL}/api/projects/${project.id}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Test with nextTemplateId only',
        nextTemplateId: templateA.id,
        startImmediately: false,
      }),
    });

    expect(response.ok).toBe(true);
    const session = await response.json();

    // Verify nextTemplateId is set
    const fetchedSession = await getSession(session.id);
    expect(fetchedSession.nextTemplateId).toBe(templateA.id);
    // Template settings should NOT be applied (no templateId)
    expect(fetchedSession.thinkingEnabled).toBe(false);
  });

  test('explicit nextTemplateId overrides templateId-derived value', async () => {
    const response = await fetch(`${API_URL}/api/projects/${project.id}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Test with both templateId and nextTemplateId',
        templateId: templateA.id,
        nextTemplateId: templateB.id,
        startImmediately: false,
      }),
    });

    expect(response.ok).toBe(true);
    const session = await response.json();

    // Verify template A's settings were applied
    const fetchedSession = await getSession(session.id);
    expect(fetchedSession.thinkingEnabled).toBe(true);
    // But nextTemplateId should point to B, not A
    expect(fetchedSession.nextTemplateId).toBe(templateB.id);
  });

  test('returns 400 for non-existent nextTemplateId', async () => {
    const response = await fetch(`${API_URL}/api/projects/${project.id}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Test with bad nextTemplateId',
        nextTemplateId: '00000000-0000-4000-8000-000000000000',
        startImmediately: false,
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('nextTemplateId references a non-existent template');
  });

  test('explicit null nextTemplateId clears templateId-derived value', async () => {
    const response = await fetch(`${API_URL}/api/projects/${project.id}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Test clearing nextTemplateId',
        templateId: templateA.id,
        nextTemplateId: null,
        startImmediately: false,
      }),
    });

    expect(response.ok).toBe(true);
    const session = await response.json();

    // Template A's settings should be applied
    const fetchedSession = await getSession(session.id);
    expect(fetchedSession.thinkingEnabled).toBe(true);
    // But nextTemplateId should be null
    expect(fetchedSession.nextTemplateId).toBeNull();
  });
});
