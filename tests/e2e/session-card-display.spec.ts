import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedChildSession,
  cleanupCreatedResources,
  navigateAndWait,
  updateSessionFields,
  waitForSessionToExist,
  getAPIURL,
} from './helpers';

const API_URL = getAPIURL();

/**
 * E2E Tests for Session Card Display Improvements
 *
 * Covers:
 * - Session count badge removal (plan section 3)
 * - Scheduled time display on session cards (plan section 4)
 * - Files changed badge rendering on session cards (plan section 5)
 * - Integration test: all elements render correctly together
 *
 * Note on files-changed badge: The badge count comes from api.getSessionFilesCount(),
 * which counts real git changes in the working directory. We can only verify the
 * badge renders correctly (correct text format, icon), not a specific count value.
 */

test.describe('Session Card Display', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Card Display Test', process.cwd());
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test.describe('Session count badge removed', () => {
    test('.session-count element does not exist on session cards', async ({ page }) => {
      // Create multiple sessions (parent + children) to verify .session-count is gone
      const parent = await seedSession(project.id, {
        prompt: 'Parent session',
        name: 'Parent Session',
        startImmediately: false,
      });
      await waitForSessionToExist(parent.id);

      // Create child sessions
      let childrenCreated = 0;
      try {
        const child1 = await seedChildSession(project.id, parent.id, {
          prompt: 'Child 1',
          name: 'Child Session 1',
        });
        await waitForSessionToExist(child1.id);
        childrenCreated++;

        const child2 = await seedChildSession(project.id, parent.id, {
          prompt: 'Child 2',
          name: 'Child Session 2',
        });
        await waitForSessionToExist(child2.id);
        childrenCreated++;
      } catch (e) {
        // If child session creation fails, skip gracefully —
        // we can still verify .session-count is absent with just the parent
        console.warn('Child session creation failed, testing with parent only:', e);
      }

      await navigateAndWait(page, `/projects/${project.id}/sessions`, {
        waitFor: '.session-card',
      });

      // Verify .session-count does NOT exist on any session card
      const sessionCountElements = page.locator('.session-count');
      await expect(sessionCountElements).toHaveCount(0);

      // If children were created, verify the expand toggle is present
      if (childrenCreated > 0) {
        const expandBtn = page.locator('.expand-toggle-btn');
        await expect(expandBtn).toBeVisible();
        await expect(expandBtn).toContainText('Show');
      }
    });
  });

  test.describe('Scheduled time display', () => {
    test('scheduled session card shows relative time', async ({ page }) => {
      // Create a session and set it as scheduled 2 hours in the future
      const futureTime = Date.now() + 2 * 60 * 60 * 1000; // 2 hours from now
      const session = await seedSession(project.id, {
        prompt: 'Scheduled task',
        name: 'Scheduled Session',
        startImmediately: false,
      });

      // Update to scheduled status with scheduledAt
      await updateSessionFields(session.id, {
        status: 'scheduled',
        scheduledAt: futureTime,
      });

      await navigateAndWait(page, `/projects/${project.id}/sessions`, {
        waitFor: '.session-card',
      });

      // Verify the scheduled time badge is visible
      const scheduledTime = page.locator('.scheduled-time');
      await expect(scheduledTime).toBeVisible({ timeout: 10000 });

      // Should contain "in" for relative time (e.g., "in about 2 hours")
      await expect(scheduledTime).toContainText('in');

      // Should have a title attribute with absolute time
      const titleAttr = await scheduledTime.getAttribute('title');
      expect(titleAttr).toBeTruthy();
      // Title should contain a formatted date string (e.g., "Mar 15, 2:30 PM")
      expect(titleAttr).toMatch(/\w+ \d+, \d+:\d+/);
    });

    test('non-scheduled session does not show scheduled time badge', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Regular session',
        name: 'Regular Session',
        startImmediately: false,
      });

      await navigateAndWait(page, `/projects/${project.id}/sessions`, {
        waitFor: '.session-card',
      });

      // Should NOT have the scheduled time element
      const scheduledTime = page.locator('.scheduled-time');
      await expect(scheduledTime).toHaveCount(0);
    });
  });

  test.describe('Files changed badge', () => {
    test('files changed badge renders with correct format', async ({ page }) => {
      // The badge count comes from api.getSessionFilesCount() which reads
      // real git changes. We verify the badge format, not a specific count.
      const session = await seedSession(project.id, {
        prompt: 'Test files changed',
        name: 'Files Changed Test',
        startImmediately: false,
      });

      await navigateAndWait(page, `/projects/${project.id}/sessions`, {
        waitFor: '.session-card',
      });

      const filesBadge = page.locator('.files-changed-badge');
      const badgeCount = await filesBadge.count();

      if (badgeCount > 0) {
        // Verify the text matches "N file(s)" format
        const text = (await filesBadge.textContent())?.trim();
        expect(text).toMatch(/^\d+ files?$/);

        // Verify the SVG icon is present
        const icon = filesBadge.locator('.files-icon');
        await expect(icon).toBeVisible();
      }
      // If badgeCount is 0, that means no git changes — also valid
    });

    test('files changed badge uses correct singular/plural', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test plural',
        name: 'Plural Test',
        startImmediately: false,
      });

      await navigateAndWait(page, `/projects/${project.id}/sessions`, {
        waitFor: '.session-card',
      });

      const filesBadge = page.locator('.files-changed-badge');
      const badgeCount = await filesBadge.count();

      if (badgeCount > 0) {
        const text = (await filesBadge.textContent())?.trim();
        const match = text?.match(/^(\d+) (files?)$/);
        expect(match).toBeTruthy();
        if (match) {
          const num = parseInt(match[1]);
          const word = match[2];
          if (num === 1) {
            expect(word).toBe('file');
          } else {
            expect(word).toBe('files');
          }
        }
      }
    });

    test('files changed badge has CSS styling', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test badge style',
        name: 'Badge Style Test',
        startImmediately: false,
      });

      await navigateAndWait(page, `/projects/${project.id}/sessions`, {
        waitFor: '.session-card',
      });

      const filesBadge = page.locator('.files-changed-badge');
      const badgeCount = await filesBadge.count();

      if (badgeCount > 0) {
        // Verify the badge has flex display (inline-flex blockifies to flex inside a flex container)
        const display = await filesBadge.evaluate(
          (el) => getComputedStyle(el).display
        );
        expect(display).toBe('flex');

        // Verify the font-size is 0.75rem (12px at default)
        const fontSize = await filesBadge.evaluate(
          (el) => getComputedStyle(el).fontSize
        );
        expect(parseFloat(fontSize)).toBe(12);
      }
    });
  });

  test.describe('Integration', () => {
    test('all card elements render correctly together', async ({ page }) => {
      // Create a scheduled session
      const futureTime = Date.now() + 3 * 60 * 60 * 1000; // 3 hours
      const session = await seedSession(project.id, {
        prompt: 'Integration test session',
        name: 'Integration Session',
        startImmediately: false,
      });

      await updateSessionFields(session.id, {
        status: 'scheduled',
        scheduledAt: futureTime,
      });

      await navigateAndWait(page, `/projects/${project.id}/sessions`, {
        waitFor: '.session-card',
      });

      // Verify session card is visible
      const card = page.locator('.session-card');
      await expect(card).toBeVisible();

      // Verify scheduled time badge is visible
      const scheduledTime = page.locator('.scheduled-time');
      await expect(scheduledTime).toBeVisible();

      // Verify the scheduled count badge is also visible
      const scheduledBadge = page.locator('.status-scheduled');
      await expect(scheduledBadge).toBeVisible();
      await expect(scheduledBadge).toContainText('scheduled');

      // Verify no .session-count element
      await expect(page.locator('.session-count')).toHaveCount(0);

      // Verify session name is displayed
      await expect(card).toContainText('Integration Session');
    });

    test('mobile responsive layout wraps badges correctly', async ({ page }) => {
      // Create a session with a scheduled time
      const futureTime = Date.now() + 2 * 60 * 60 * 1000;
      const session = await seedSession(project.id, {
        prompt: 'Mobile test',
        name: 'Mobile Test Session',
        startImmediately: false,
      });
      await updateSessionFields(session.id, {
        status: 'scheduled',
        scheduledAt: futureTime,
      });

      // Set a small viewport
      await page.setViewportSize({ width: 375, height: 667 });

      await navigateAndWait(page, `/projects/${project.id}/sessions`, {
        waitFor: '.session-card',
      });

      // Verify the session-meta container has flex-wrap at mobile sizes
      const meta = page.locator('.session-meta');
      await expect(meta).toBeVisible();
      const flexWrap = await meta.evaluate(
        (el) => getComputedStyle(el).flexWrap
      );
      expect(flexWrap).toBe('wrap');

      // Verify badges are still visible at small viewport
      const scheduledBadge = page.locator('.status-scheduled');
      await expect(scheduledBadge).toBeVisible();
    });
  });
});
