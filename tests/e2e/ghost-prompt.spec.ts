import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupAll,
  navigateAndWait,
  openSessionOverlay,
  updateSessionStatus,
  updatePendingPrompt,
  seedUserMessage,
  seedAssistantMessage,
  waitForSessionToExist,
  getSession,
  API_URL,
} from './helpers';

/**
 * E2E regression spec for the "Ghost Prompt" bug.
 *
 * Symptom: after sending a prompt, the textarea intermittently re-displays
 * the just-sent prompt text (it "comes back from the dead") once the agent
 * responds or the component remounts.
 *
 * Root causes (see `fix-ghost-prompt-textarea.md`):
 *   1. Stale-closure debounce in `useDraftSaving` re-writing the captured
 *      prompt to `pendingPrompt` AFTER `handleSend` cleared it.
 *   2. `ConversationTab.onMounted` unconditionally restoring
 *      `session.pendingPrompt` back into the textarea on remount.
 *
 * The fixes are:
 *   - Stale-closure guard + `cancel()` in the debounce composable.
 *   - `handleSend` clears `pendingPrompt` on the server BEFORE sendMessage,
 *     with failure rollback.
 *   - Per-session `hasRecentSend` marker (5 s TTL) suppresses the restore
 *     path when the tab remounts shortly after a Send.
 *   - `v-model` single source of truth (no imperative `textareaRef.value =`
 *     writes from parents).
 */
test.describe('Ghost Prompt regression', () => {
  test.describe.configure({ timeout: 30000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Ghost Prompt', '/tmp/ghost-prompt-test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  // ==========================================================================
  // Case A — fast send: type and Send within the 500 ms debounce window,
  // let the agent turn "complete" (simulated), verify the textarea is empty.
  // ==========================================================================
  test('Case A: fast send — textarea is empty after the agent turn completes', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'initial prompt',
      name: 'Ghost Prompt Case A',
      startImmediately: false,
    });
    await waitForSessionToExist(session.id);
    // Mark as having responses so ConversationTab treats this as a
    // follow-up-message session rather than a draft.
    await seedUserMessage(session.id, 'initial prompt');
    await seedAssistantMessage(session.id, 'initial response');
    // Clear the server pendingPrompt so the textarea starts empty.
    await updatePendingPrompt(session.id, null);

    await navigateAndWait(page, `/sessions/${session.id}`);
    await openSessionOverlay(page);

    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue('');

    // Type a prompt, then Send within 200 ms — this is shorter than the
    // 500 ms debounce window, so the ghost-prompt race with the stale
    // closure is most likely to fire if the fix is missing.
    const PROMPT_TEXT = 'Quick send prompt';
    await textarea.fill(PROMPT_TEXT);

    // Intercept the outgoing message to avoid actually spawning an agent
    // turn — we only want to verify the frontend's ghost-prompt behavior,
    // not agent behavior. Return a success-shaped response.
    await page.route('**/api/sessions/*/message', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    // Press the Send button within the debounce window.
    const sendButton = page.locator('button:has-text("Send")').first();
    await sendButton.click();

    // Simulate the agent flipping the session through running → waiting,
    // which is what would trigger the onMounted/status-watcher re-hydrate
    // path that previously restored the ghost prompt.
    await updateSessionStatus(session.id, 'running');
    await page.waitForTimeout(300);
    await updateSessionStatus(session.id, 'waiting');
    await page.waitForTimeout(500);

    // THE KEY ASSERTION: the textarea must be empty — no ghost prompt.
    await expect(textarea).toHaveValue('');

    // And the server's pendingPrompt must also be cleared (handleSend sets it
    // to null BEFORE sendMessage; the stale debounce must not have re-written
    // the captured value back).
    const updatedSession = await getSession(session.id);
    expect(updatedSession.pendingPrompt).toBeFalsy();
  });

  // ==========================================================================
  // Case B — remount after send: Send, navigate away and back, confirm the
  // onMounted restore does not re-populate the textarea with the sent prompt
  // (handled by the `hasRecentSend` marker).
  // ==========================================================================
  test('Case B: remount after send — textarea stays empty after navigating away and back', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'original prompt',
      name: 'Ghost Prompt Case B',
      startImmediately: false,
    });
    await waitForSessionToExist(session.id);
    await seedUserMessage(session.id, 'original prompt');
    await seedAssistantMessage(session.id, 'original response');
    await updatePendingPrompt(session.id, null);

    await navigateAndWait(page, `/sessions/${session.id}`);
    await openSessionOverlay(page);

    const textarea = page.locator('textarea').first();
    await expect(textarea).toHaveValue('');

    await page.route('**/api/sessions/*/message', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    const PROMPT = 'Sent and then remount';
    await textarea.fill(PROMPT);
    await page.locator('button:has-text("Send")').first().click();

    // Immediately navigate away — this forces a remount of ConversationTab.
    // Before the fix, onMounted would read the server's pendingPrompt (which
    // may not yet have been cleared due to the debounce race) and restore
    // the ghost prompt into the textarea.
    await navigateAndWait(page, '/');
    await page.waitForTimeout(200);

    // Navigate back to the session — this triggers another remount.
    await navigateAndWait(page, `/sessions/${session.id}`);
    await openSessionOverlay(page);

    const textareaAfter = page.locator('textarea').first();
    await expect(textareaAfter).toBeVisible();

    // THE KEY ASSERTION: within the 5 s `hasRecentSend` TTL window, the
    // onMounted restore path must NOT re-populate the textarea with the
    // just-sent prompt. The textarea should be empty.
    await expect(textareaAfter).toHaveValue('');
  });

  // ==========================================================================
  // Case C — real draft preserved: type, do NOT send, reload the page,
  // verify the debounced persist-to-server path wrote the draft and the
  // onMounted restore path reads it back.
  // ==========================================================================
  test('Case C: real draft is preserved across page reload', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'initial prompt',
      name: 'Ghost Prompt Case C',
      startImmediately: false,
    });
    await waitForSessionToExist(session.id);
    await seedUserMessage(session.id, 'initial prompt');
    await seedAssistantMessage(session.id, 'initial response');
    await updatePendingPrompt(session.id, null);

    await navigateAndWait(page, `/sessions/${session.id}`);
    await openSessionOverlay(page);

    const textarea = page.locator('textarea').first();
    await expect(textarea).toHaveValue('');

    const DRAFT = 'This draft should survive a reload';
    await textarea.fill(DRAFT);

    // Wait past the 500 ms debounce window so the draft is persisted to
    // the server (via `updateSessionPendingPrompt`).
    await page.waitForTimeout(1_200);

    // Verify the draft made it to the server.
    const serverBefore = await getSession(session.id);
    expect(serverBefore.pendingPrompt).toBe(DRAFT);

    // Reload the page — this remounts ConversationTab with a fresh state.
    await page.reload();
    await openSessionOverlay(page);

    // THE KEY ASSERTION: the textarea must be re-hydrated with the
    // persisted draft. The `hasRecentSend` marker must NOT fire here
    // because we never called Send.
    const reloaded = page.locator('textarea').first();
    await expect(reloaded).toBeVisible();
    await expect(reloaded).toHaveValue(DRAFT);
  });

  // ==========================================================================
  // Case D — failed send: the draft is restored on failure so the user's
  // text isn't silently lost. The UI surfaces the error via toast.
  // ==========================================================================
  test('Case D: failed send — draft is not lost when sendMessage returns 500', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'initial prompt',
      name: 'Ghost Prompt Case D',
      startImmediately: false,
    });
    await waitForSessionToExist(session.id);
    await seedUserMessage(session.id, 'initial prompt');
    await seedAssistantMessage(session.id, 'initial response');
    await updatePendingPrompt(session.id, null);

    await navigateAndWait(page, `/sessions/${session.id}`);
    await openSessionOverlay(page);

    const textarea = page.locator('textarea').first();
    await expect(textarea).toHaveValue('');

    // Force the message API to return 500 so handleSend throws after it
    // has already cleared the server's pendingPrompt.
    await page.route('**/api/sessions/*/message', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Simulated backend failure' }),
      });
    });

    const FAILED_PROMPT = 'This send will fail';
    await textarea.fill(FAILED_PROMPT);
    await page.locator('button:has-text("Send")').first().click();

    // The failure should leave the typed text still in the textarea —
    // the user hasn't lost anything.
    await expect(textarea).toHaveValue(FAILED_PROMPT, { timeout: 5000 });

    // The server's pendingPrompt should be restored to the failed text
    // (best-effort rollback in `handleSend`) so that a subsequent reload
    // also preserves the draft.
    await page.waitForTimeout(1_000);
    const restored = await getSession(session.id);
    expect(restored.pendingPrompt).toBe(FAILED_PROMPT);
  });
});
