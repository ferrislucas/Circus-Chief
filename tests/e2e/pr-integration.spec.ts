import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupCreatedResources,
  navigateAndWait,
  waitForSessionToExist,
  updateSessionWithPR,
  getSessionSummary,
  getSession,
  getAPIURL,
  seedSessionSummaryWithPR,
} from './helpers';

const API_URL = getAPIURL();

/**
 * E2E Tests for Pull Request Integration (Section 10)
 *
 * Covers:
 * - PR URL editor (CRUD, validation, persistence)
 * - PR state badges (open, merged, closed, draft)
 * - CI status badges (success, failure, pending + failure details)
 * - Merge conflict detection
 * - PR info in session summaries (API + UI)
 * - PR indicators on session cards
 */

test.describe('PR Integration', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('PR Integration Test', '/tmp/test-pr');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  // ============================================================
  // Prerequisite Tests: Validate seed tooling
  // ============================================================

  test.describe('Prerequisites: seed-summary.mjs PR fields', () => {
    test('seeds PR fields correctly', async () => {
      const session = await seedSession(project.id, {
        prompt: 'Test PR seeding',
        name: 'PR Seed Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      // Seed summary with all PR fields
      seedSessionSummaryWithPR(session.id, {
        shortSummary: 'PR seeding test',
        fullSummary: 'Testing that PR fields are seeded correctly',
        prState: 'open',
        prMerged: false,
        hasMergeConflicts: true,
        ciStatus: 'failure',
        ciFailures: ['lint', 'unit-tests'],
      });

      // Verify via API
      const summary = await getSessionSummary(session.id);
      expect(summary).not.toBeNull();
      expect(summary.prState).toBe('open');
      expect(summary.prMerged).toBe(false);
      expect(summary.hasMergeConflicts).toBe(true);
      expect(summary.ciStatus).toBe('failure');
      expect(summary.ciFailures).toEqual(['lint', 'unit-tests']);
    });

    test('handles missing PR fields gracefully', async () => {
      const session = await seedSession(project.id, {
        prompt: 'Test missing PR fields',
        name: 'Missing PR Fields Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      // Seed summary WITHOUT PR fields
      seedSessionSummaryWithPR(session.id, {
        shortSummary: 'No PR fields',
        fullSummary: 'Summary without any PR data',
      });

      const summary = await getSessionSummary(session.id);
      expect(summary).not.toBeNull();
      expect(summary.shortSummary).toBe('No PR fields');
      expect(summary.prState).toBeNull();
      expect(summary.ciStatus).toBeNull();
    });

    test('updates existing summary with PR fields', async () => {
      const session = await seedSession(project.id, {
        prompt: 'Test update PR fields',
        name: 'Update PR Fields Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      // First seed without PR fields
      seedSessionSummaryWithPR(session.id, {
        shortSummary: 'Before PR',
        fullSummary: 'Initial summary without PR data',
      });

      let summary = await getSessionSummary(session.id);
      expect(summary.prState).toBeNull();

      // Now update with PR fields
      seedSessionSummaryWithPR(session.id, {
        shortSummary: 'After PR',
        fullSummary: 'Updated summary with PR data',
        prState: 'merged',
        prMerged: true,
        ciStatus: 'success',
      });

      summary = await getSessionSummary(session.id);
      expect(summary.shortSummary).toBe('After PR');
      expect(summary.prState).toBe('merged');
      expect(summary.prMerged).toBe(true);
      expect(summary.ciStatus).toBe('success');
    });
  });

  // ============================================================
  // Category 1: PR URL Editor — API Contract
  // ============================================================

  test.describe('Category 1: PR URL Editor — API Contract', () => {
    test('sets PR URL on session via PATCH', async () => {
      const session = await seedSession(project.id, {
        prompt: 'Test PR URL set',
        name: 'PR URL Set Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      await updateSessionWithPR(session.id, {
        prUrl: 'https://github.com/owner/repo/pull/42',
      });

      const updated = await getSession(session.id);
      expect(updated.prUrl).toBe('https://github.com/owner/repo/pull/42');
    });

    test('rejects invalid PR URL format', async () => {
      const session = await seedSession(project.id, {
        prompt: 'Test invalid PR URL',
        name: 'Invalid PR URL Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      // Try issues URL (not a PR)
      let response = await fetch(`${API_URL}/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prUrl: 'https://github.com/owner/repo/issues/42' }),
      });
      expect(response.status).toBe(400);

      // Try non-URL string
      response = await fetch(`${API_URL}/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prUrl: 'not-a-url' }),
      });
      expect(response.status).toBe(400);
    });

    test('rejects non-GitHub PR URLs', async () => {
      const session = await seedSession(project.id, {
        prompt: 'Test non-GitHub URL',
        name: 'Non-GitHub URL Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      const response = await fetch(`${API_URL}/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prUrl: 'https://gitlab.com/owner/repo/pull/42' }),
      });
      expect(response.status).toBe(400);
    });

    test('clears PR URL by setting null', async () => {
      const session = await seedSession(project.id, {
        prompt: 'Test PR URL clear',
        name: 'PR URL Clear Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      // Set PR URL
      await updateSessionWithPR(session.id, {
        prUrl: 'https://github.com/owner/repo/pull/42',
      });
      let updated = await getSession(session.id);
      expect(updated.prUrl).toBe('https://github.com/owner/repo/pull/42');

      // Clear PR URL
      const response = await fetch(`${API_URL}/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prUrl: null }),
      });
      expect(response.ok).toBe(true);

      updated = await getSession(session.id);
      expect(updated.prUrl).toBeNull();
    });

    test('updates PR URL to different PR', async () => {
      const session = await seedSession(project.id, {
        prompt: 'Test PR URL update',
        name: 'PR URL Update Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      await updateSessionWithPR(session.id, {
        prUrl: 'https://github.com/owner/repo/pull/42',
      });
      let updated = await getSession(session.id);
      expect(updated.prUrl).toBe('https://github.com/owner/repo/pull/42');

      await updateSessionWithPR(session.id, {
        prUrl: 'https://github.com/owner/repo/pull/99',
      });
      updated = await getSession(session.id);
      expect(updated.prUrl).toBe('https://github.com/owner/repo/pull/99');
    });

    test('PR URL persists across session status changes', async () => {
      const session = await seedSession(project.id, {
        prompt: 'Test PR URL persistence',
        name: 'PR URL Persistence Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      await updateSessionWithPR(session.id, {
        prUrl: 'https://github.com/owner/repo/pull/42',
      });

      // Change session status to stopped (valid status for PATCH)
      await fetch(`${API_URL}/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'stopped' }),
      });

      const updated = await getSession(session.id);
      expect(updated.status).toBe('stopped');
      expect(updated.prUrl).toBe('https://github.com/owner/repo/pull/42');
    });
  });

  // ============================================================
  // Category 2: PR State Badges — UI Rendering
  // ============================================================

  test.describe('Category 2: PR State Badges — UI Rendering', () => {
    test('displays "Open" badge for open PR', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test open PR badge',
        name: 'Open PR Badge Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      await updateSessionWithPR(session.id, {
        prUrl: 'https://github.com/owner/repo/pull/100',
      });
      seedSessionSummaryWithPR(session.id, {
        prState: 'open',
        shortSummary: 'Test open PR',
        fullSummary: 'Testing open PR badge display',
      });

      await navigateAndWait(page, `/sessions/${session.id}/summary`);

      // Verify PR section is visible
      const prSection = page.locator('[data-testid="pr-section"]');
      await expect(prSection).toBeVisible();

      // Verify "Open" state badge text
      const stateBadge = prSection.locator('.pr-open');
      await expect(stateBadge).toBeVisible();
      await expect(stateBadge).toHaveText('Open');
    });

    test('displays "Merged" badge for merged PR', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test merged PR badge',
        name: 'Merged PR Badge Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      await updateSessionWithPR(session.id, {
        prUrl: 'https://github.com/owner/repo/pull/101',
      });
      seedSessionSummaryWithPR(session.id, {
        prState: 'merged',
        prMerged: true,
        shortSummary: 'Test merged PR',
        fullSummary: 'Testing merged PR badge display',
      });

      await navigateAndWait(page, `/sessions/${session.id}/summary`);

      const prSection = page.locator('[data-testid="pr-section"]');
      await expect(prSection).toBeVisible();

      const stateBadge = prSection.locator('.pr-merged');
      await expect(stateBadge).toBeVisible();
      await expect(stateBadge).toHaveText('Merged');
    });

    test('displays "Closed" badge for closed PR', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test closed PR badge',
        name: 'Closed PR Badge Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      await updateSessionWithPR(session.id, {
        prUrl: 'https://github.com/owner/repo/pull/102',
      });
      seedSessionSummaryWithPR(session.id, {
        prState: 'closed',
        shortSummary: 'Test closed PR',
        fullSummary: 'Testing closed PR badge display',
      });

      await navigateAndWait(page, `/sessions/${session.id}/summary`);

      const prSection = page.locator('[data-testid="pr-section"]');
      await expect(prSection).toBeVisible();

      const stateBadge = prSection.locator('.pr-closed');
      await expect(stateBadge).toBeVisible();
      await expect(stateBadge).toHaveText('Closed');
    });

    test('displays "Draft" badge for draft PR', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test draft PR badge',
        name: 'Draft PR Badge Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      await updateSessionWithPR(session.id, {
        prUrl: 'https://github.com/owner/repo/pull/103',
      });
      seedSessionSummaryWithPR(session.id, {
        prState: 'draft',
        shortSummary: 'Test draft PR',
        fullSummary: 'Testing draft PR badge display',
      });

      await navigateAndWait(page, `/sessions/${session.id}/summary`);

      const prSection = page.locator('[data-testid="pr-section"]');
      await expect(prSection).toBeVisible();

      const stateBadge = prSection.locator('.pr-draft');
      await expect(stateBadge).toBeVisible();
      await expect(stateBadge).toHaveText('Draft');
    });

    test('displays PR number link correctly', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test PR number link',
        name: 'PR Number Link Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      await updateSessionWithPR(session.id, {
        prUrl: 'https://github.com/acme/app/pull/789',
      });
      seedSessionSummaryWithPR(session.id, {
        prState: 'open',
        shortSummary: 'Test PR link',
        fullSummary: 'Testing PR number link display',
      });

      await navigateAndWait(page, `/sessions/${session.id}/summary`);

      const prSection = page.locator('[data-testid="pr-section"]');
      await expect(prSection).toBeVisible();

      // Verify PR link contains the PR number
      const prLink = prSection.locator('a.pr-link');
      await expect(prLink).toBeVisible();
      await expect(prLink).toHaveText(/PR #789/);
      await expect(prLink).toHaveAttribute('href', 'https://github.com/acme/app/pull/789');
    });
  });

  // ============================================================
  // Category 3: CI Status Badges — UI Rendering
  // ============================================================

  test.describe('Category 3: CI Status Badges — UI Rendering', () => {
    test('displays green checkmark for CI passing', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test CI passing',
        name: 'CI Passing Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      await updateSessionWithPR(session.id, {
        prUrl: 'https://github.com/owner/repo/pull/200',
      });
      seedSessionSummaryWithPR(session.id, {
        prState: 'open',
        ciStatus: 'success',
        shortSummary: 'Test CI passing',
        fullSummary: 'Testing CI passing badge display',
      });

      await navigateAndWait(page, `/sessions/${session.id}/summary`);

      // In SummaryTab, CI success shows in the ci-status section (not warnings)
      const ciStatus = page.locator('[data-testid="ci-status"]');
      await expect(ciStatus).toBeVisible();
      await expect(ciStatus).toContainText('CI Passing');
    });

    test('displays red X for CI failing', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test CI failing',
        name: 'CI Failing Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      await updateSessionWithPR(session.id, {
        prUrl: 'https://github.com/owner/repo/pull/201',
      });
      seedSessionSummaryWithPR(session.id, {
        prState: 'open',
        ciStatus: 'failure',
        ciFailures: ['lint', 'unit-tests'],
        shortSummary: 'Test CI failing',
        fullSummary: 'Testing CI failing badge display',
      });

      await navigateAndWait(page, `/sessions/${session.id}/summary`);

      // CI failure shows in the warnings section
      const warnings = page.locator('[data-testid="pr-warnings"]');
      await expect(warnings).toBeVisible();
      await expect(warnings).toContainText('CI checks failing');
    });

    test('displays yellow dot for CI pending', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test CI pending',
        name: 'CI Pending Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      await updateSessionWithPR(session.id, {
        prUrl: 'https://github.com/owner/repo/pull/202',
      });
      seedSessionSummaryWithPR(session.id, {
        prState: 'open',
        ciStatus: 'pending',
        shortSummary: 'Test CI pending',
        fullSummary: 'Testing CI pending badge display',
      });

      await navigateAndWait(page, `/sessions/${session.id}/summary`);

      const ciStatus = page.locator('[data-testid="ci-status"]');
      await expect(ciStatus).toBeVisible();
      await expect(ciStatus).toContainText('CI Pending');
    });

    test('displays CI failure details list', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test CI failure details',
        name: 'CI Failure Details Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      await updateSessionWithPR(session.id, {
        prUrl: 'https://github.com/owner/repo/pull/203',
      });
      seedSessionSummaryWithPR(session.id, {
        prState: 'open',
        ciStatus: 'failure',
        ciFailures: ['eslint', 'jest', 'typecheck'],
        shortSummary: 'Test CI failure details',
        fullSummary: 'Testing CI failure details list display',
      });

      await navigateAndWait(page, `/sessions/${session.id}/summary`);

      // Verify all failure items are listed
      const failureItems = page.locator('[data-testid="pr-ci-failure-item"]');
      await expect(failureItems).toHaveCount(3);
      await expect(failureItems.nth(0)).toContainText('eslint');
      await expect(failureItems.nth(1)).toContainText('jest');
      await expect(failureItems.nth(2)).toContainText('typecheck');
    });
  });

  // ============================================================
  // Category 4: Merge Conflict Detection — UI Rendering
  // ============================================================

  test.describe('Category 4: Merge Conflict Detection — UI Rendering', () => {
    test('displays merge conflict warning when detected', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test merge conflicts',
        name: 'Merge Conflict Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      await updateSessionWithPR(session.id, {
        prUrl: 'https://github.com/owner/repo/pull/300',
      });
      seedSessionSummaryWithPR(session.id, {
        prState: 'open',
        hasMergeConflicts: true,
        shortSummary: 'Test merge conflicts',
        fullSummary: 'Testing merge conflict warning display',
      });

      await navigateAndWait(page, `/sessions/${session.id}/summary`);

      const warnings = page.locator('[data-testid="pr-warnings"]');
      await expect(warnings).toBeVisible();
      await expect(warnings).toContainText('Merge conflicts detected');
    });

    test('no conflict warning when no conflicts', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test no merge conflicts',
        name: 'No Merge Conflict Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      await updateSessionWithPR(session.id, {
        prUrl: 'https://github.com/owner/repo/pull/301',
      });
      seedSessionSummaryWithPR(session.id, {
        prState: 'open',
        hasMergeConflicts: false,
        ciStatus: 'success',
        shortSummary: 'Test no conflicts',
        fullSummary: 'Testing absence of merge conflict warning',
      });

      await navigateAndWait(page, `/sessions/${session.id}/summary`);

      // PR section should be visible but no warnings section
      const prSection = page.locator('[data-testid="pr-section"]');
      await expect(prSection).toBeVisible();

      // No warnings section should appear (hasMergeConflicts=false AND ciStatus != 'failure')
      const warnings = page.locator('[data-testid="pr-warnings"]');
      await expect(warnings).not.toBeVisible();
    });

    test('merge conflict and CI failure shown simultaneously', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test both warnings',
        name: 'Both Warnings Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      await updateSessionWithPR(session.id, {
        prUrl: 'https://github.com/owner/repo/pull/302',
      });
      seedSessionSummaryWithPR(session.id, {
        prState: 'open',
        hasMergeConflicts: true,
        ciStatus: 'failure',
        ciFailures: ['build'],
        shortSummary: 'Test both warnings',
        fullSummary: 'Testing both merge conflict and CI failure warnings',
      });

      await navigateAndWait(page, `/sessions/${session.id}/summary`);

      const warnings = page.locator('[data-testid="pr-warnings"]');
      await expect(warnings).toBeVisible();
      await expect(warnings).toContainText('Merge conflicts detected');
      await expect(warnings).toContainText('CI checks failing');
    });
  });

  // ============================================================
  // Category 5: PR Info in Session Summaries — API & UI
  // ============================================================

  test.describe('Category 5: PR Info in Session Summaries — API & UI', () => {
    test('summary API returns PR fields', async () => {
      const session = await seedSession(project.id, {
        prompt: 'Test summary API PR fields',
        name: 'Summary API PR Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      seedSessionSummaryWithPR(session.id, {
        prState: 'open',
        prMerged: false,
        hasMergeConflicts: true,
        ciStatus: 'failure',
        ciFailures: ['lint', 'build'],
        shortSummary: 'API test summary',
        fullSummary: 'Testing API response includes all PR fields',
      });

      const summary = await getSessionSummary(session.id);
      expect(summary).not.toBeNull();
      expect(summary.prState).toBe('open');
      expect(summary.prMerged).toBe(false);
      expect(summary.hasMergeConflicts).toBe(true);
      expect(summary.ciStatus).toBe('failure');
      expect(summary.ciFailures).toEqual(['lint', 'build']);
    });

    test('summary tab shows PR section when PR linked', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test summary tab PR section',
        name: 'Summary Tab PR Section Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      await updateSessionWithPR(session.id, {
        prUrl: 'https://github.com/owner/repo/pull/500',
      });
      seedSessionSummaryWithPR(session.id, {
        prState: 'open',
        ciStatus: 'success',
        shortSummary: 'Summary tab PR test',
        fullSummary: 'Testing PR section renders in summary tab',
      });

      await navigateAndWait(page, `/sessions/${session.id}/summary`);

      // PR section should be visible
      const prSection = page.locator('[data-testid="pr-section"]');
      await expect(prSection).toBeVisible();

      // Should contain PR state and link
      await expect(prSection).toContainText('Open');
      await expect(prSection.locator('a.pr-link')).toContainText('PR #500');
    });

    test('summary tab hides PR section when no PR', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test summary tab no PR',
        name: 'Summary Tab No PR Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      // Seed summary WITHOUT PR fields and WITHOUT prUrl on session
      seedSessionSummaryWithPR(session.id, {
        shortSummary: 'No PR linked',
        fullSummary: 'This session has no PR linked',
      });

      await navigateAndWait(page, `/sessions/${session.id}/summary`);

      // Wait for summary to load
      await expect(page.locator('.summary-content')).toBeVisible();

      // PR section should NOT be visible
      const prSection = page.locator('[data-testid="pr-section"]');
      await expect(prSection).not.toBeVisible();
    });

    test('PR overview card shows state and CI in session overview', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test PR overview card',
        name: 'PR Overview Card Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      await updateSessionWithPR(session.id, {
        prUrl: 'https://github.com/owner/repo/pull/501',
      });
      seedSessionSummaryWithPR(session.id, {
        prState: 'open',
        ciStatus: 'success',
        shortSummary: 'PR overview test',
        fullSummary: 'Testing PR info in overview card',
      });

      await navigateAndWait(page, `/sessions/${session.id}/summary`);

      // Overview section should show PR badge
      const overviewPr = page.locator('[data-testid="pr-overview-badge"]');
      await expect(overviewPr).toBeVisible();
      await expect(overviewPr).toContainText('PR #501');
      await expect(overviewPr).toContainText('Open');
      await expect(overviewPr).toContainText('CI Passing');
    });

    test('summary handles null PR fields gracefully', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test null PR fields',
        name: 'Null PR Fields Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      // Set prUrl but DON'T set prState in summary
      await updateSessionWithPR(session.id, {
        prUrl: 'https://github.com/owner/repo/pull/502',
      });
      seedSessionSummaryWithPR(session.id, {
        shortSummary: 'Null PR state',
        fullSummary: 'Summary with prUrl but no prState',
        // prState intentionally NOT set
      });

      await navigateAndWait(page, `/sessions/${session.id}/summary`);

      // Wait for summary to load
      await expect(page.locator('.summary-content')).toBeVisible();

      // PR section should NOT be visible because hasPrInfo requires BOTH prUrl AND prState
      const prSection = page.locator('[data-testid="pr-section"]');
      await expect(prSection).not.toBeVisible();
    });
  });

  // ============================================================
  // Category 6: PR Indicators on Session Cards
  // ============================================================

  test.describe('Category 6: PR Indicators on Session Cards', () => {
    test('session card shows PR link when prUrl set', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test session card PR link',
        name: 'Session Card PR Link Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      await updateSessionWithPR(session.id, {
        prUrl: 'https://github.com/owner/repo/pull/600',
      });
      seedSessionSummaryWithPR(session.id, {
        prState: 'open',
        shortSummary: 'Card PR link test',
        fullSummary: 'Testing PR link on session card',
      });

      await navigateAndWait(page, `/projects/${project.id}/sessions`);

      // Wait for session card to render
      const card = page.locator(`.session-card`).first();
      await expect(card).toBeVisible();

      // PR link should be visible on the card
      const prLink = card.locator('[data-testid="pr-link"]');
      await expect(prLink).toBeVisible();
      await expect(prLink).toContainText('PR 600');
    });

    test('session card shows state badge alongside PR link', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test session card PR badge',
        name: 'Session Card PR Badge Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      await updateSessionWithPR(session.id, {
        prUrl: 'https://github.com/owner/repo/pull/601',
      });
      seedSessionSummaryWithPR(session.id, {
        prState: 'merged',
        prMerged: true,
        shortSummary: 'Card PR badge test',
        fullSummary: 'Testing PR state badge on session card',
      });

      await navigateAndWait(page, `/projects/${project.id}/sessions`);

      const card = page.locator(`.session-card`).first();
      await expect(card).toBeVisible();

      // PR link and state badge should both be visible
      const prLink = card.locator('[data-testid="pr-link"]');
      await expect(prLink).toBeVisible();

      const stateBadge = card.locator('[data-testid="pr-state-badge"]');
      await expect(stateBadge).toBeVisible();
      await expect(stateBadge).toHaveText('Merged');
    });

    test('session card without PR shows no PR indicators', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test session card no PR',
        name: 'Session Card No PR Test',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);

      await navigateAndWait(page, `/projects/${project.id}/sessions`);

      const card = page.locator(`.session-card`).first();
      await expect(card).toBeVisible();

      // No PR indicators should be visible
      const prLink = card.locator('[data-testid="pr-link"]');
      await expect(prLink).not.toBeVisible();

      const stateBadge = card.locator('[data-testid="pr-state-badge"]');
      await expect(stateBadge).not.toBeVisible();
    });
  });
});
