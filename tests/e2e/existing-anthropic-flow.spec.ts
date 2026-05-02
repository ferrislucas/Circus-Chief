import { test, expect } from '@playwright/test';
import {
  cleanupCreatedResources,
  getSessionMessages,
  seedProject,
  seedSession,
  waitForStatus,
} from './helpers';

test.describe('Existing Anthropic flow regression', () => {
  test.describe.configure({ timeout: 120000 });

  const CLAUDE_PROMPT = 'Claude E2E regression: reply with exactly "Claude E2E response."';

  test.beforeEach(async () => {
    await cleanupCreatedResources();
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('Claude Code session still runs through VCR replay', async () => {
    const project = await seedProject('Anthropic Regression Project', process.cwd());
    const session = await seedSession(project.id, {
      prompt: CLAUDE_PROMPT,
      model: 'claude-haiku-4-5-20251001',
      startImmediately: true,
    });

    expect(session.agentType).toBe('claude-code');
    await waitForStatus(session.id, 'waiting', 60000);

    const messages = await getSessionMessages(session.id);
    expect(messages.some((m: any) => m.role === 'assistant' && m.content.includes('Claude E2E response.'))).toBe(true);
  });
});
