import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupCreatedResources,
  waitForSessionStatus,
  updateSessionStatus,
  scopedSessionCard,
  scopedSessionName,
  navigateAndWait,
  getSession,
} from './helpers';
import { API_READY } from './timeouts';

test.describe('Helpers — behavior contract', () => {
  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('Helpers Contract', '/tmp/helpers-contract');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test.describe('waitForSessionStatus', () => {
    test('resolves only after API confirms the status', async () => {
      // Seeded with startImmediately:false, the session starts in status
      // 'waiting'. We pick a different target status ('stopped') so the
      // helper must actually poll for it — not return on stale state.
      const session = await seedSession(project.id, {
        prompt: `waitForStatus-${Date.now()}`,
        startImmediately: false,
      });

      // Sanity: the session exists and is NOT already in the target status.
      const before = await getSession(session.id);
      expect(before).toBeTruthy();
      expect(before.status).not.toBe('stopped');

      // Kick off a delayed status change from a different async flow.
      // We start the wait, then flip the status shortly after, and assert
      // that the wait resolves (i.e. polls to see the new value).
      const delay = 400;
      setTimeout(() => {
        updateSessionStatus(session.id, 'stopped').catch(() => {
          /* ignored — the test asserts via timeout behavior below */
        });
      }, delay);

      const t0 = Date.now();
      await waitForSessionStatus(session.id, 'stopped', API_READY);
      const elapsed = Date.now() - t0;

      // Must have waited at least as long as the delayed mutation,
      // proving the helper actually polled to detection, not that it
      // returned immediately based on stale state.
      expect(elapsed).toBeGreaterThanOrEqual(delay - 50);

      // And the API now reports the expected status.
      const after = await getSession(session.id);
      expect(after.status).toBe('stopped');
    });

    test('throws when the desired status is never reached within the timeout', async () => {
      const session = await seedSession(project.id, {
        prompt: `waitForStatus-timeout-${Date.now()}`,
        startImmediately: false,
      });

      // Pick a status that will never be applied and use a short timeout.
      let threw = false;
      try {
        await waitForSessionStatus(session.id, 'running', 500);
      } catch (err: any) {
        threw = true;
        expect(String(err.message)).toContain('did not reach status');
      }
      expect(threw).toBe(true);
    });
  });

  test.describe('scopedSessionCard / scopedSessionName', () => {
    test('two seeds sharing a common prefix do not cross-match', async ({ page }) => {
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const nameA = `XMatch-${unique}-A`;
      const nameB = `XMatch-${unique}-B`;

      const sessionA = await seedSession(project.id, {
        prompt: nameA,
        name: nameA,
        startImmediately: false,
      });
      const sessionB = await seedSession(project.id, {
        prompt: nameB,
        name: nameB,
        startImmediately: false,
      });

      await updateSessionStatus(sessionA.id, 'waiting');
      await updateSessionStatus(sessionB.id, 'waiting');
      await waitForSessionStatus(sessionA.id, 'waiting', API_READY);
      await waitForSessionStatus(sessionB.id, 'waiting', API_READY);

      await navigateAndWait(page, `/projects/${project.id}/sessions`, {
        loadState: 'domcontentloaded',
      });

      // Each scoped locator must match exactly one card — not two, despite
      // the shared "XMatch-<unique>-" prefix.
      await expect(scopedSessionCard(page, nameA)).toHaveCount(1);
      await expect(scopedSessionCard(page, nameB)).toHaveCount(1);
      await expect(scopedSessionName(page, nameA)).toHaveCount(1);
      await expect(scopedSessionName(page, nameB)).toHaveCount(1);
    });
  });
});
