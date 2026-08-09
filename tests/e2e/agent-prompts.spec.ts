import { test, expect, Page } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupCreatedResources,
  navigateAndWait,
  openSessionOverlay,
  getSession,
  getSessionMessages,
  getSessionWorkLogs,
  waitForStatus,
  stopSession,
} from './helpers';

// These specs consume the two hand-authored cassettes added alongside the
// interactive agent prompts feature — tests/e2e/cassettes/runSession-
// bc8fc5cc196e4a64.json (question) and runSession-f464dd3f5d0ffcfc.json
// (permission) — which previously had nothing exercising them. The prompt
// text below is exactly what each cassette was recorded against; VCR_MODE
// replay matches cassettes by `{callType}-{SHA256(prompt)[0:16]}` (see
// CassetteStore.buildKey), and these were recorded with callType
// `runSession` — a session's *first* turn, triggered at creation time
// (`startImmediately: true`), not `continueSession` (a later message on an
// already-running session). The prompt must be sent verbatim.
const QUESTION_PROMPT = 'E2E demo: ask the user which deployment target to use before proceeding.';
const PERMISSION_PROMPT = 'E2E demo: propose a gated config edit that requires permission approval.';
// This cassette records the SDK result expected after selecting project scope.
// It is intentionally distinct from PERMISSION_PROMPT, whose cassette is used
// by the allow-once and denial tests.
const PROJECT_ALWAYS_ALLOW_PROMPT = 'E2E demo: grant a project-scoped always-allow rule for the gated config edit.';

/**
 * Poll the session until the server reports a parked prompt
 * (`pendingAgentInput`), i.e. the agent turn is blocked awaiting a
 * `canUseTool` response. Session status stays 'running' the whole time —
 * a parked prompt does not change status (see FRD §7) — so this is the
 * only reliable signal to wait on.
 */
async function waitForPendingPrompt(sessionId: string, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const session = await getSession(sessionId);
    if (session?.pendingAgentInput) return session;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Session ${sessionId} never surfaced a pending prompt within ${timeout}ms`);
}

async function seedAndStartSession(projectId: string, name: string, prompt: string) {
  // startImmediately (the default) is what triggers the `runSession` call
  // type these cassettes were recorded against.
  const session = await seedSession(projectId, {
    prompt,
    name,
    model: 'claude-haiku-4-5-20251001',
    mode: 'standard',
  });
  return session;
}

function flattenWorkLogs(groupedLogs: Record<string, any[]>) {
  return Object.values(groupedLogs).flat();
}

async function openChatAndSurfacePrompt(page: Page, sessionId: string) {
  await waitForPendingPrompt(sessionId);
  await navigateAndWait(page, `/sessions/${sessionId}`, { waitFor: '[data-testid="session-detail"][data-ready="true"]' });
  const chat = await openSessionOverlay(page);
  const card = chat.locator('.agent-prompt-card');
  await expect(card).toBeVisible({ timeout: 15000 });
  return card;
}

test.describe('Interactive Agent Prompts', () => {
  // Real agent turns via VCR cassettes need generous timeouts.
  test.describe.configure({ timeout: 120000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Interactive Agent Prompts', process.cwd());
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('question prompt: card appears, Send answers is disabled until answered, submitting resolves the turn', async ({ page }) => {
    const session = await seedAndStartSession(project.id, 'Question Prompt', QUESTION_PROMPT);
    const card = await openChatAndSurfacePrompt(page, session.id);

    const sendButton = card.locator('button.prompt-primary-action');
    await expect(sendButton).toBeDisabled();

    // Selecting an option enables submission.
    await card.locator('.option-card').first().click();
    await expect(sendButton).toBeEnabled();

    await sendButton.click();

    // Submitting clears the card...
    await expect(card).not.toBeVisible({ timeout: 10000 });
    // ...and the session completes the turn.
    await waitForStatus(session.id, 'waiting', 60000);
    const messages = await getSessionMessages(session.id);
    expect(messages.some((m: any) => m.role === 'assistant')).toBe(true);
  });

  test('permission prompt: shows the diff for the proposed Edit, Allow once clears the card and completes the turn', async ({ page }) => {
    const session = await seedAndStartSession(project.id, 'Permission Prompt', PERMISSION_PROMPT);
    const card = await openChatAndSurfacePrompt(page, session.id);

    // `title` is rendered as the headline (FR-121), and Edit/Write tool
    // input renders through DiffViewer rather than raw JSON (FR-707).
    await expect(card.locator('.permission-intro h3')).toContainText('index.js');
    await expect(card).toContainText('Proposed change');
    await expect(card.locator('.permission-evidence')).not.toContainText('old_string');

    await card.locator('button.prompt-primary-action').click(); // Allow once

    await expect(card).not.toBeVisible({ timeout: 10000 });
    await waitForStatus(session.id, 'waiting', 60000);
  });

  test('permission prompt: always allow sends the project-scoped SDK permission update and completes the operation', async ({ page }) => {
    const session = await seedAndStartSession(project.id, 'Always Allow Prompt', PROJECT_ALWAYS_ALLOW_PROMPT);
    const card = await openChatAndSurfacePrompt(page, session.id);

    await card.locator('.permission-scope select').selectOption('projectSettings');
    await card.getByRole('button', { name: 'Always allow' }).click();

    await expect(card).not.toBeVisible({ timeout: 10000 });
    // The VCR fixture contains the precise PermissionResult that Claude Code
    // expects for this response. Replay rejects a plain allow or an update
    // with the wrong destination before it yields the result event.
    await waitForStatus(session.id, 'waiting', 60000);
    const messages = await getSessionMessages(session.id);
    expect(messages.some((message: any) => message.role === 'assistant' && message.content.includes('Applied the edit'))).toBe(true);
  });

  test('permission prompt: reload hydrates the parked prompt and preserves its identity', async ({ page }) => {
    const session = await seedAndStartSession(project.id, 'Hydrated Prompt', PERMISSION_PROMPT);
    const initialCard = await openChatAndSurfacePrompt(page, session.id);
    const initialTitle = await initialCard.locator('.permission-intro h3').textContent();

    await page.reload();
    await expect(page.locator('[data-testid="session-detail"][data-ready="true"]')).toBeVisible();
    const hydratedCard = await openSessionOverlay(page).then((chat) => chat.locator('.agent-prompt-card'));
    await expect(hydratedCard).toBeVisible({ timeout: 15000 });
    await expect(hydratedCard.locator('.permission-intro h3')).toHaveText(initialTitle || '');

    await hydratedCard.locator('button.prompt-primary-action').click();
    await expect(hydratedCard).not.toBeVisible({ timeout: 10000 });
    await waitForStatus(session.id, 'waiting', 60000);
  });

  test('permission prompt: Escape reveals denial without resolving the SDK callback', async ({ page }) => {
    const session = await seedAndStartSession(project.id, 'Escape Denial Prompt', PERMISSION_PROMPT);
    const card = await openChatAndSurfacePrompt(page, session.id);

    await card.locator('button.prompt-primary-action').focus();
    await page.keyboard.press('Escape');
    await expect(card.locator('.deny-reason')).toBeVisible();
    await expect(card).toBeVisible();
    expect((await getSession(session.id)).pendingAgentInput).toBe(true);

    await card.locator('.deny-reason input').fill('Do not modify server configuration.');
    await card.getByRole('button', { name: 'Confirm deny' }).click();
    await expect(card).not.toBeVisible({ timeout: 10000 });
    await waitForStatus(session.id, 'waiting', 60000);
    const logs = flattenWorkLogs(await getSessionWorkLogs(session.id));
    expect(logs.some((log: any) => log.content.includes('Outcome: deny') && log.content.includes('Reason: Do not modify server configuration.'))).toBe(true);
  });

  test('stop clears a parked prompt and the session does not hang', async ({ page }) => {
    const session = await seedAndStartSession(project.id, 'Stop Clears Prompt', PERMISSION_PROMPT);
    const card = await openChatAndSurfacePrompt(page, session.id);

    await stopSession(session.id);

    await expect(card).not.toBeVisible({ timeout: 15000 });
    const stopped = await getSession(session.id);
    expect(stopped.pendingAgentInput).toBe(false);
  });
});
