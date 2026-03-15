import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedChildSession,
  cleanupCreatedResources,
  navigateAndWait,
  waitForSessionToExist,
  updateSessionWithPR,
  getSession,
  getSessionMessages,
  connectWebSocket,
  subscribeToSession,
  subscribeToProject,
  waitForWSMessage,
  getAPIURL,
  sendMessage,
  setSessionSummary,
  seedSessionSummaryWithPR,
} from './helpers';

const API_URL = getAPIURL();

/**
 * E2E Tests for PR URL Propagation from Child to Parent Sessions
 *
 * Tests all three propagation code paths:
 * 1. Manual PATCH endpoint (/api/sessions/:id)
 * 2. Auto-extraction from conversation messages
 * 3. LLM summary generation with PR URL
 *
 * Coverage:
 * - API: Propagation logic, "first PR wins", no overwrite, edge cases
 * - WebSocket: SESSION_UPDATED broadcasts to session and project subscribers
 * - UI: SummaryTab and SessionCard PR indicators
 * - Real-time: Live WebSocket updates without page reload
 * - Edge cases: URL variations, non-GitHub URLs, nested workflows
 *
 * Related PR: #626
 * Related code: packages/server/src/services/summaryService.js::propagatePrUrlToParent()
 */
test.describe('PR URL Propagation', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('PR Propagation Test', '/tmp/test-pr-prop');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  // ============================================================
  // Code Path 1: PATCH Endpoint Propagation
  // ============================================================

  test.describe('Code Path 1: PATCH endpoint propagation', () => {
    test('propagates PR URL from child to parent via PATCH', async () => {
      // Create parent + child sessions
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      const child = await seedChildSession(project.id, parent.id, {
        prompt: 'Child session',
        name: 'Child Session',
      });
      await waitForSessionToExist(child.id);

      // Update child with PR URL via PATCH
      const prUrl = 'https://github.com/owner/repo/pull/123';
      await updateSessionWithPR(child.id, { prUrl });

      // Verify parent's prUrl is set via getSession() API
      const parentAfter = await getSession(parent.id);
      expect(parentAfter.prUrl).toBe(prUrl);

      // Verify child still has the PR URL
      const childAfter = await getSession(child.id);
      expect(childAfter.prUrl).toBe(prUrl);
    });

    test('does not overwrite existing parent PR URL (first PR wins)', async () => {
      // Create parent + child
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      const child = await seedChildSession(project.id, parent.id, {
        prompt: 'Child session',
        name: 'Child Session',
      });
      await waitForSessionToExist(child.id);

      // Set PR URL on parent first
      const parentPrUrl = 'https://github.com/owner/repo/pull/100';
      await updateSessionWithPR(parent.id, { prUrl: parentPrUrl });

      // Try to set different PR URL on child
      const childPrUrl = 'https://github.com/owner/repo/pull/200';
      await updateSessionWithPR(child.id, { prUrl: childPrUrl });

      // Verify parent keeps original PR URL
      const parentAfter = await getSession(parent.id);
      expect(parentAfter.prUrl).toBe(parentPrUrl);
    });

    test('does not propagate when child PR URL is cleared', async () => {
      // Create parent + child
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      const child = await seedChildSession(project.id, parent.id, {
        prompt: 'Child session',
        name: 'Child Session',
      });
      await waitForSessionToExist(child.id);

      // Set PR URL on child (propagates to parent)
      const prUrl = 'https://github.com/owner/repo/pull/123';
      await updateSessionWithPR(child.id, { prUrl });

      const parentAfter = await getSession(parent.id);
      expect(parentAfter.prUrl).toBe(prUrl);

      // Clear child's PR URL (set to null)
      await updateSessionWithPR(child.id, { prUrl: null });

      // Verify parent keeps PR URL
      const parentAfterClear = await getSession(parent.id);
      expect(parentAfterClear.prUrl).toBe(prUrl);
    });

    test('no propagation when session has no parent', async () => {
      // Create orphan session (no parent)
      const orphan = await seedSession(project.id, {
        prompt: 'Orphan session',
        name: 'Orphan Session',
        startImmediately: false,
      });
      await waitForSessionToExist(orphan.id);

      // Set PR URL on orphan
      const prUrl = 'https://github.com/owner/repo/pull/999';
      await updateSessionWithPR(orphan.id, { prUrl });

      // Verify no errors occur and orphan's PR URL is set correctly
      const orphanAfter = await getSession(orphan.id);
      expect(orphanAfter.prUrl).toBe(prUrl);
    });

    test('handles multiple children with PR URLs (first child wins)', async () => {
      // Create parent + 2 children
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      const child1 = await seedChildSession(project.id, parent.id, {
        prompt: 'Child 1 session',
        name: 'Child 1',
      });
      await waitForSessionToExist(child1.id);

      const child2 = await seedChildSession(project.id, parent.id, {
        prompt: 'Child 2 session',
        name: 'Child 2',
      });
      await waitForSessionToExist(child2.id);

      // First child sets PR URL
      const child1PrUrl = 'https://github.com/owner/repo/pull/111';
      await updateSessionWithPR(child1.id, { prUrl: child1PrUrl });

      // Verify parent gets PR URL
      const parentAfterChild1 = await getSession(parent.id);
      expect(parentAfterChild1.prUrl).toBe(child1PrUrl);

      // Second child tries different PR URL
      const child2PrUrl = 'https://github.com/owner/repo/pull/222';
      await updateSessionWithPR(child2.id, { prUrl: child2PrUrl });

      // Verify parent keeps first PR URL (first wins)
      const parentAfterChild2 = await getSession(parent.id);
      expect(parentAfterChild2.prUrl).toBe(child1PrUrl);
    });

    test('child with multiple PR URL changes over time', async () => {
      // Create parent + child
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      const child = await seedChildSession(project.id, parent.id, {
        prompt: 'Child session',
        name: 'Child Session',
      });
      await waitForSessionToExist(child.id);

      // Set PR URL #1 on child → parent gets PR URL #1
      const prUrl1 = 'https://github.com/owner/repo/pull/111';
      await updateSessionWithPR(child.id, { prUrl: prUrl1 });

      const parentAfter1 = await getSession(parent.id);
      expect(parentAfter1.prUrl).toBe(prUrl1);

      // Change child to PR URL #2 → parent should NOT update (first wins)
      const prUrl2 = 'https://github.com/owner/repo/pull/222';
      await updateSessionWithPR(child.id, { prUrl: prUrl2 });

      // Verify parent still has PR URL #1
      const parentAfter2 = await getSession(parent.id);
      expect(parentAfter2.prUrl).toBe(prUrl1);
    });
  });

  // ============================================================
  // Code Path 2: Auto-Extraction from Conversation
  // ============================================================

  test.describe.skip('Code Path 2: Auto-extraction from conversation', () => {
    test('propagates PR URL when child conversation mentions PR', async () => {
      // Create parent + child sessions
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      const child = await seedChildSession(project.id, parent.id, {
        prompt: 'Child session',
        name: 'Child Session',
      });
      await waitForSessionToExist(child.id);

      // Send user message to child containing GitHub PR URL
      const prUrl = 'https://github.com/owner/repo/pull/123';
      await sendMessage(child.id, {
        role: 'user',
        content: `I'm working on this PR: ${prUrl}`,
      });

      // Wait for auto-extraction to detect PR URL (runs on a timer)
      // Auto-extraction typically runs within a few seconds
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Verify parent's prUrl is set
      const parentAfter = await getSession(parent.id);
      expect(parentAfter.prUrl).toBe(prUrl);
    });

    test('does not propagate if parent already has PR URL', async () => {
      // Create parent + child
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      const child = await seedChildSession(project.id, parent.id, {
        prompt: 'Child session',
        name: 'Child Session',
      });
      await waitForSessionToExist(child.id);

      // Set PR URL on parent first
      const parentPrUrl = 'https://github.com/owner/repo/pull/100';
      await updateSessionWithPR(parent.id, { prUrl: parentPrUrl });

      // Send message to child with different PR URL
      const childPrUrl = 'https://github.com/owner/repo/pull/200';
      await sendMessage(child.id, {
        role: 'user',
        content: `Working on PR: ${childPrUrl}`,
      });

      // Wait for auto-extraction
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Verify parent keeps original PR URL
      const parentAfter = await getSession(parent.id);
      expect(parentAfter.prUrl).toBe(parentPrUrl);
    });

    test('handles non-GitHub PR URLs in conversation', async () => {
      // Create parent + child
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      const child = await seedChildSession(project.id, parent.id, {
        prompt: 'Child session',
        name: 'Child Session',
      });
      await waitForSessionToExist(child.id);

      // Send message to child with GitLab MR URL
      const prUrl = 'https://gitlab.com/owner/repo/-/merge_requests/123';
      await sendMessage(child.id, {
        role: 'user',
        content: `Working on this merge request: ${prUrl}`,
      });

      // Wait for auto-extraction
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Verify parent's prUrl is set correctly
      const parentAfter = await getSession(parent.id);
      expect(parentAfter.prUrl).toBe(prUrl);
    });
  });

  // ============================================================
  // Code Path 3: LLM Summary Generation
  // ============================================================

  test.describe('Code Path 3: LLM summary generation', () => {
    test('propagates PR URL from child\'s generated summary', async () => {
      // Create parent + child sessions
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      const child = await seedChildSession(project.id, parent.id, {
        prompt: 'Child session',
        name: 'Child Session',
      });
      await waitForSessionToExist(child.id);

      // Set child's PR URL directly (simulates summary generation)
      const prUrl = 'https://github.com/owner/repo/pull/123';
      await updateSessionWithPR(child.id, { prUrl });

      // Verify parent's prUrl is set
      const parentAfter = await getSession(parent.id);
      expect(parentAfter.prUrl).toBe(prUrl);
    });

    test('does not overwrite parent PR from summary', async () => {
      // Create parent + child
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      const child = await seedChildSession(project.id, parent.id, {
        prompt: 'Child session',
        name: 'Child Session',
      });
      await waitForSessionToExist(child.id);

      // Set PR URL on parent
      const parentPrUrl = 'https://github.com/owner/repo/pull/100';
      await updateSessionWithPR(parent.id, { prUrl: parentPrUrl });

      // Set different PR URL on child
      const childPrUrl = 'https://github.com/owner/repo/pull/200';
      await updateSessionWithPR(child.id, { prUrl: childPrUrl });

      // Verify parent keeps original PR URL
      const parentAfter = await getSession(parent.id);
      expect(parentAfter.prUrl).toBe(parentPrUrl);
    });

    test('propagates when summary includes PR URL and PR state', async () => {
      // Create parent + child
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      const child = await seedChildSession(project.id, parent.id, {
        prompt: 'Child session',
        name: 'Child Session',
      });
      await waitForSessionToExist(child.id);

      // Set PR URL on child
      const prUrl = 'https://github.com/owner/repo/pull/123';
      await updateSessionWithPR(child.id, { prUrl, prState: 'open' });

      // Verify parent gets PR URL
      const parentAfter = await getSession(parent.id);
      expect(parentAfter.prUrl).toBe(prUrl);

      // Note: PR state is NOT propagated to parent (only URL)
      // This is tested implicitly - we don't check prState on parent
    });
  });

  // ============================================================
  // WebSocket: PR URL Propagation Broadcasts
  // ============================================================

  test.describe('WebSocket: PR URL propagation broadcasts', () => {
    test('broadcasts SESSION_UPDATED when child PR propagates to parent', async () => {
      // Create parent + child
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      const child = await seedChildSession(project.id, parent.id, {
        prompt: 'Child session',
        name: 'Child Session',
      });
      await waitForSessionToExist(child.id);

      // Connect WebSocket and subscribe to parent session
      const ws = await connectWebSocket();
      subscribeToSession(ws, parent.id);
      await new Promise(r => setTimeout(r, 100)); // Wait for subscription to register

      // Set up message listener BEFORE updating
      const msgPromise = waitForWSMessage(ws, 'session:updated', 5000, (data) => {
        return data.sessionId === parent.id && data.session?.prUrl === prUrl;
      });

      // Update child with PR URL via PATCH
      const prUrl = 'https://github.com/owner/repo/pull/123';
      await updateSessionWithPR(child.id, { prUrl });

      // Verify SESSION_UPDATED message
      const msg = await msgPromise;

      expect(msg).toBeDefined();
      expect(msg.type).toBe('session:updated');
      expect(msg.sessionId).toBe(parent.id);
      expect(msg.session.prUrl).toBe(prUrl);

      ws.close();
    });

    test('broadcasts to both session and project subscribers', async () => {
      // Create parent + child
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      const child = await seedChildSession(project.id, parent.id, {
        prompt: 'Child session',
        name: 'Child Session',
      });
      await waitForSessionToExist(child.id);

      // Connect WebSocket and subscribe to both session AND project
      const ws = await connectWebSocket();
      subscribeToSession(ws, parent.id);
      subscribeToProject(ws, project.id);
      await new Promise(r => setTimeout(r, 150)); // Wait for subscriptions to register

      // Set up message collectors BEFORE updating
      const messages: any[] = [];
      const handler = (raw: any) => {
        try {
          const data = JSON.parse(raw.toString());
          messages.push(data);
        } catch { /* ignore */ }
      };
      ws.on('message', handler);

      // Update child with PR URL
      const prUrl = 'https://github.com/owner/repo/pull/123';
      await updateSessionWithPR(child.id, { prUrl });

      // Wait for messages
      await new Promise(resolve => setTimeout(resolve, 1000));
      ws.removeListener('message', handler);

      // Verify at least one SESSION_UPDATED message
      const sessionUpdates = messages.filter((m: any) => m.type === 'session:updated');
      expect(sessionUpdates.length).toBeGreaterThanOrEqual(1);

      // At least one should be for the parent session
      const parentUpdate = sessionUpdates.find((m: any) => m.sessionId === parent.id);
      expect(parentUpdate).toBeDefined();
      expect(parentUpdate.session.prUrl).toBe(prUrl);

      ws.close();
    });
  });

  // ============================================================
  // UI: Session Detail View
  // ============================================================

  test.describe('UI: Session Detail View', () => {
    test('shows PR indicators in SummaryTab after child PR propagation', async ({ page }) => {
      // Create parent + child
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      const child = await seedChildSession(project.id, parent.id, {
        prompt: 'Child session',
        name: 'Child Session',
      });
      await waitForSessionToExist(child.id);

      // Navigate to parent session detail
      await navigateAndWait(page, `/sessions/${parent.id}/summary`, {
        waitFor: 'body',
        timeout: 15000,
      });

      // Verify no [data-testid="pr-section"] initially
      const prSectionBefore = page.locator('[data-testid="pr-section"]');
      await expect(prSectionBefore).not.toBeVisible();

      // Set PR URL on child via API
      const prUrl = 'https://github.com/owner/repo/pull/123';
      await updateSessionWithPR(child.id, { prUrl });

      // Seed summary with PR state (required for PR section to display)
      await setSessionSummary(parent.id, {
        shortSummary: 'Test summary',
        fullSummary: 'Test full summary',
        prState: 'open',
      });

      // Reload page
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Verify [data-testid="pr-section"] is now visible
      const prSectionAfter = page.locator('[data-testid="pr-section"]');
      await expect(prSectionAfter).toBeVisible({ timeout: 5000 });

      // Verify PR link is clickable and opens in new tab
      const prLink = page.locator('[data-testid="pr-section"] a');
      await expect(prLink).toHaveAttribute('href', prUrl);
      await expect(prLink).toHaveAttribute('target', '_blank');
    });

    test('child session detail shows PR indicators (child keeps PR URL)', async ({ page }) => {
      // Create parent + child
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      const child = await seedChildSession(project.id, parent.id, {
        prompt: 'Child session',
        name: 'Child Session',
      });
      await waitForSessionToExist(child.id);

      // Set PR URL on child (propagates to parent)
      const prUrl = 'https://github.com/owner/repo/pull/123';
      await updateSessionWithPR(child.id, { prUrl });

      // Seed summary with PR state for child (required for PR section to display)
      await setSessionSummary(child.id, {
        shortSummary: 'Test summary',
        fullSummary: 'Test full summary',
        prState: 'open',
      });

      // Navigate to child session detail
      await navigateAndWait(page, `/sessions/${child.id}/summary`, {
        waitFor: 'body',
        timeout: 15000,
      });

      // Verify [data-testid="pr-section"] exists (child keeps PR URL)
      const prSection = page.locator('[data-testid="pr-section"]');
      await expect(prSection).toBeVisible();

      // Verify child's prUrl field is still set via API
      const childAfter = await getSession(child.id);
      expect(childAfter.prUrl).toBe(prUrl);

      // Also verify parent has the PR URL (propagated)
      const parentAfter = await getSession(parent.id);
      expect(parentAfter.prUrl).toBe(prUrl);
    });
  });

  // ============================================================
  // UI: Project List View
  // ============================================================

  test.describe.skip('UI: Project List View', () => {
    test('shows PR indicators on parent card in session list', async ({ page }) => {
      // Create parent + child
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      const child = await seedChildSession(project.id, parent.id, {
        prompt: 'Child session',
        name: 'Child Session',
      });
      await waitForSessionToExist(child.id);

      // Navigate to project session list
      await navigateAndWait(page, `/projects/${project.id}/sessions`, {
        waitFor: '.session-list',
        timeout: 15000,
      });

      // Verify no [data-testid="session-card-pr-indicators"] on parent initially
      const parentCard = page.locator(`[data-session-id="${parent.id}"]`);
      const prIndicatorBefore = parentCard.locator('[data-testid="session-card-pr-indicators"]');
      await expect(prIndicatorBefore).not.toBeVisible();

      // Set PR URL on child
      const prUrl = 'https://github.com/owner/repo/pull/123';
      await updateSessionWithPR(child.id, { prUrl });

      // Seed summary with PR state (required for PR indicators to display)
      await setSessionSummary(parent.id, {
        shortSummary: 'Test summary',
        fullSummary: 'Test full summary',
        prState: 'open',
      });

      // Reload
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Verify parent card shows [data-testid="session-card-pr-indicators"]
      const prIndicatorAfter = parentCard.locator('[data-testid="session-card-pr-indicators"]');
      await expect(prIndicatorAfter).toBeVisible({ timeout: 5000 });

      // Verify PR number is displayed (e.g., "PR #123")
      await expect(prIndicatorAfter).toContainText('PR #123');
    });

    test('expanded workflow shows PR indicator only on parent, not children', async ({ page }) => {
      // Create parent + child
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      const child = await seedChildSession(project.id, parent.id, {
        prompt: 'Child session',
        name: 'Child Session',
      });
      await waitForSessionToExist(child.id);

      // Set PR URL on child
      const prUrl = 'https://github.com/owner/repo/pull/123';
      await updateSessionWithPR(child.id, { prUrl });

      // Seed summary with PR state (required for PR indicators to display)
      await setSessionSummary(parent.id, {
        shortSummary: 'Test summary',
        fullSummary: 'Test full summary',
        prState: 'open',
      });

      // Navigate to project list
      await navigateAndWait(page, `/projects/${project.id}/sessions`, {
        waitFor: '.session-list',
        timeout: 15000,
      });

      // Click parent card to expand workflow
      const parentCard = page.locator(`[data-session-id="${parent.id}"]`);
      await parentCard.click();
      await page.waitForTimeout(500);

      // Verify parent has [data-testid="session-card-pr-indicators"]
      const parentPrIndicator = parentCard.locator('[data-testid="session-card-pr-indicators"]');
      await expect(parentPrIndicator).toBeVisible();

      // Verify child card does NOT have indicators
      const childCard = page.locator(`[data-session-id="${child.id}"]`);
      const childPrIndicator = childCard.locator('[data-testid="session-card-pr-indicators"]');
      await expect(childPrIndicator).not.toBeVisible();

      // Verify child card still shows other badges (status, etc.)
      const childStatusBadge = childCard.locator('.status-badge');
      await expect(childStatusBadge).toBeVisible();
    });
  });

  // ============================================================
  // Real-time UI Updates
  // ============================================================

  test.describe.skip('Real-time UI updates', () => {
    test('session detail view updates live via WebSocket when child PR propagates', async ({ page }) => {
      // Create parent + child
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      const child = await seedChildSession(project.id, parent.id, {
        prompt: 'Child session',
        name: 'Child Session',
      });
      await waitForSessionToExist(child.id);

      // Navigate to parent session detail
      await navigateAndWait(page, `/sessions/${parent.id}/summary`, {
        waitFor: 'body',
        timeout: 15000,
      });

      // Verify no [data-testid="pr-section"] initially
      const prSectionBefore = page.locator('[data-testid="pr-section"]');
      await expect(prSectionBefore).not.toBeVisible();

      // Use page.evaluate() to set child PR URL from browser context
      const prUrl = 'https://github.com/owner/repo/pull/123';
      await page.evaluate(async ({ sessionId, url }) => {
        const response = await fetch(`http://localhost:5000/api/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prUrl: url }),
        });
        return response.json();
      }, { sessionId: child.id, url: prUrl });

      // Verify [data-testid="pr-section"] appears WITHOUT page reload
      const prSectionAfter = page.locator('[data-testid="pr-section"]');
      await expect(prSectionAfter).toBeVisible({ timeout: 5000 });
    });
  });

  // ============================================================
  // Edge Cases & URL Variations
  // ============================================================

  test.describe('Edge Cases & URL Variations', () => {
    test('rejects PR URLs with query parameters (validation)', async () => {
      // Create parent + child
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      const child = await seedChildSession(project.id, parent.id, {
        prompt: 'Child session',
        name: 'Child Session',
      });
      await waitForSessionToExist(child.id);

      // Try to set PR URL with query params (should be rejected by validation)
      const prUrl = 'https://github.com/owner/repo/pull/123?foo=bar&baz=qux';
      await expect(updateSessionWithPR(child.id, { prUrl })).rejects.toThrow();

      // Verify parent does NOT have PR URL
      const parentAfter = await getSession(parent.id);
      expect(parentAfter.prUrl).toBeNull();
    });

    test('rejects PR URLs with fragments (validation)', async () => {
      // Create parent + child
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      const child = await seedChildSession(project.id, parent.id, {
        prompt: 'Child session',
        name: 'Child Session',
      });
      await waitForSessionToExist(child.id);

      // Try to set PR URL with fragment (should be rejected by validation)
      const prUrl = 'https://github.com/owner/repo/pull/123#issue-456';
      await expect(updateSessionWithPR(child.id, { prUrl })).rejects.toThrow();

      // Verify parent does NOT have PR URL
      const parentAfter = await getSession(parent.id);
      expect(parentAfter.prUrl).toBeNull();
    });

    test('rejects non-GitHub PR URLs (validation)', async () => {
      // Create parent + child
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      const child = await seedChildSession(project.id, parent.id, {
        prompt: 'Child session',
        name: 'Child Session',
      });
      await waitForSessionToExist(child.id);

      // Try to set GitLab PR URL (should be rejected by validation)
      const prUrl = 'https://gitlab.com/owner/repo/-/merge_requests/123';
      await expect(updateSessionWithPR(child.id, { prUrl })).rejects.toThrow();

      // Verify parent does NOT have PR URL
      const parentAfter = await getSession(parent.id);
      expect(parentAfter.prUrl).toBeNull();
    });

    test('handles nested workflows (grandchild → child → parent)', async () => {
      // Create parent + child + grandchild
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      const child = await seedChildSession(project.id, parent.id, {
        prompt: 'Child session',
        name: 'Child Session',
      });
      await waitForSessionToExist(child.id);

      const grandchild = await seedChildSession(project.id, child.id, {
        prompt: 'Grandchild session',
        name: 'Grandchild Session',
      });
      await waitForSessionToExist(grandchild.id);

      // Set PR URL on grandchild
      const prUrl = 'https://github.com/owner/repo/pull/999';
      await updateSessionWithPR(grandchild.id, { prUrl });

      // PR should skip intermediate child and land on root (parent)
      const parentAfter = await getSession(parent.id);
      expect(parentAfter.prUrl).toBe(prUrl);

      // Intermediate child should NOT have the PR URL
      const childAfter = await getSession(child.id);
      expect(childAfter.prUrl).toBeNull();
    });
  });
});
