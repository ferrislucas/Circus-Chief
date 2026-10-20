import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupCreatedResources,
  navigateAndWait,
  openSessionOverlay,
  waitForSessionToExist,
  updateSessionStatus,
  getProjectSessions,
  getSessionMessages,
  waitForStatus,
  getSession,
} from './helpers';

test.describe('Child Session Start from Overlay', () => {
  // Real agent turns via VCR cassettes need generous timeouts
  test.describe.configure({ timeout: 120000 });

  // Deterministic prompt for VCR cassette matching.
  // The cassette key will be: runSession-{SHA256(this prompt)[0:16]}
  const CHILD_PROMPT = 'Reply with exactly: "Draft started successfully." Nothing else.';

  let project: any;
  let parentSession: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    // Use process.cwd() as working directory — required for VCR agent execution
    project = await seedProject('Child Start', process.cwd());

    // Parent session needs a model so the child inherits one for VCR
    parentSession = await seedSession(project.id, {
      prompt: 'Parent session prompt',
      name: 'Parent Session',
      model: 'claude-haiku-4-5-20251001',
      startImmediately: false,
    });
    await waitForSessionToExist(parentSession.id);
    await updateSessionStatus(parentSession.id, 'waiting');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('child session created from overlay starts when user presses Send', async ({ page }) => {
    // 1. Navigate to parent session detail page
    await navigateAndWait(page, `/sessions/${parentSession.id}`);

    // 2. Open the session chat overlay (helper waits for ready + animation)
    const overlay = await openSessionOverlay(page);

    // 3. Create child session from overlay via "+" button
    const addBtn = overlay.locator('[data-testid="overlay-add-session-btn"]');
    await addBtn.click();

    // 4. Wait for overlay to switch to the new draft child session
    const dropdownName = overlay.locator('.dropdown-name');
    await expect(dropdownName).toContainText('New Session', { timeout: 10000 });

    // 5. Find the child session via API (need its ID for status checks)
    const allSessions = await getProjectSessions(project.id);
    const childSession = allSessions.find((s: any) => s.name === 'New Session');
    expect(childSession).toBeDefined();

    // 6. Type prompt in the draft textarea
    const textarea = overlay.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.fill(CHILD_PROMPT);

    // 7. Wait for draft auto-save to complete, then click Send.
    //    The Send button is disabled while saveStatus === 'saving', so waiting
    //    for it to be enabled ensures auto-save has finished.
    const sendBtn = overlay.locator('.btn-send-full');
    await expect(sendBtn).toBeVisible();
    await expect(sendBtn).toBeEnabled({ timeout: 5000 });
    await sendBtn.click();

    // 8. Wait for the agent turn to actually execute.
    //    The child session starts in 'waiting' status, so waitForStatus('waiting')
    //    would return immediately. Instead, poll until the status leaves
    //    'waiting' — a fail-fast assertion here (rather than a silent deadline
    //    loop) pinpoints a Send/Start that never took effect instead of
    //    surfacing later as missing messages.
    await expect.poll(async () => (await getSession(childSession.id))?.status, {
      timeout: 30000,
    }).not.toBe('waiting');
    // Agent turn should now be running or starting — wait for it to finish
    await waitForStatus(childSession.id, 'waiting', 60000);

    // 9. Verify the session ran: user message was created and agent responded.
    //    Poll (rather than a one-shot read) so a status flip that lands just
    //    before the message commit can't flake the assertions under load.
    await expect.poll(async () =>
      (await getSessionMessages(childSession.id)).filter((m: any) => m.role === 'user').length,
    { timeout: 30000 }).toBeGreaterThanOrEqual(1);
    await expect.poll(async () =>
      (await getSessionMessages(childSession.id)).filter((m: any) => m.role === 'assistant').length,
    { timeout: 30000 }).toBeGreaterThanOrEqual(1);
  });
});
