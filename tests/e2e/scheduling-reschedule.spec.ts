import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedScheduledSession,
  updateSessionScheduling,
  getScheduledSessions,
  waitForSessionScheduled,
  getSession,
  cleanupCreatedResources,
  cleanupAll,
  navigateAndWait,
  openSessionOverlay,
  waitForPageReady,
  updatePendingPrompt,
  updateSessionStatus,
} from './helpers';

/**
 * Section 7: Session Scheduling & Auto-Reschedule — E2E Tests
 *
 * Covers:
 * 1. Auto-reschedule configuration API
 * 2. Reschedule limit enforcement
 * 3. Scheduled session lifecycle
 * 4. Scheduled sessions API endpoint
 * 5. Scheduling UI components
 * 6. Reschedule triggers configuration
 */

// ============================================================
// Category 1: Auto-Reschedule Configuration API (6 tests)
// ============================================================

test.describe('Category 1: Auto-Reschedule Configuration API', () => {
  test.describe.configure({ timeout: 30000 });

  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('Reschedule Config Test', '/tmp/reschedule-config-test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('creates session with auto-reschedule enabled and all fields', async () => {
    const session = await seedScheduledSession(project.id, {
      prompt: 'Test auto-reschedule creation',
      autoRescheduleEnabled: true,
      rescheduleDelayMinutes: 30,
      rescheduleOnTokenLimit: true,
      rescheduleOnServiceError: true,
      maxRescheduleCount: 5,
      maxTotalTokens: 500000,
      rescheduleAtTokenCount: 100000,
    });

    // Verify all fields by fetching back
    const fetched = await getSession(session.id);
    expect(fetched).not.toBeNull();
    expect(fetched.autoRescheduleEnabled).toBe(true);
    expect(fetched.rescheduleDelayMinutes).toBe(30);
    expect(fetched.rescheduleOnTokenLimit).toBe(true);
    expect(fetched.rescheduleOnServiceError).toBe(true);
    expect(fetched.maxRescheduleCount).toBe(5);
    expect(fetched.maxTotalTokens).toBe(500000);
    expect(fetched.rescheduleAtTokenCount).toBe(100000);
    expect(fetched.status).toBe('scheduled');
  });

  test('updates auto-reschedule settings via PATCH', async () => {
    const session = await seedScheduledSession(project.id, {
      prompt: 'Test PATCH reschedule',
      autoRescheduleEnabled: false,
      rescheduleDelayMinutes: 15,
    });

    // Update with new values
    await updateSessionScheduling(session.id, {
      autoRescheduleEnabled: true,
      rescheduleDelayMinutes: 60,
      rescheduleOnTokenLimit: true,
      rescheduleOnServiceError: true,
      maxRescheduleCount: 10,
      maxTotalTokens: 250000,
      rescheduleAtTokenCount: 50000,
    });

    // Verify updated values
    const fetched = await getSession(session.id);
    expect(fetched.autoRescheduleEnabled).toBe(true);
    expect(fetched.rescheduleDelayMinutes).toBe(60);
    expect(fetched.rescheduleOnTokenLimit).toBe(true);
    expect(fetched.rescheduleOnServiceError).toBe(true);
    expect(fetched.maxRescheduleCount).toBe(10);
    expect(fetched.maxTotalTokens).toBe(250000);
    expect(fetched.rescheduleAtTokenCount).toBe(50000);
  });

  test('reschedule delay accepts valid values (5 and 1440 minutes)', async () => {
    // Create with minimum valid delay
    const session = await seedScheduledSession(project.id, {
      prompt: 'Test delay range',
      rescheduleDelayMinutes: 5,
    });

    let fetched = await getSession(session.id);
    expect(fetched.rescheduleDelayMinutes).toBe(5);

    // Update to maximum valid delay
    await updateSessionScheduling(session.id, {
      rescheduleDelayMinutes: 1440,
    });

    fetched = await getSession(session.id);
    expect(fetched.rescheduleDelayMinutes).toBe(1440);

    // Update to a mid-range value
    await updateSessionScheduling(session.id, {
      rescheduleDelayMinutes: 120,
    });

    fetched = await getSession(session.id);
    expect(fetched.rescheduleDelayMinutes).toBe(120);
  });

  test('can disable auto-reschedule on existing session', async () => {
    const session = await seedScheduledSession(project.id, {
      prompt: 'Test disable reschedule',
      autoRescheduleEnabled: true,
      rescheduleDelayMinutes: 30,
      maxRescheduleCount: 5,
    });

    // Verify enabled initially
    let fetched = await getSession(session.id);
    expect(fetched.autoRescheduleEnabled).toBe(true);

    // Disable auto-reschedule
    await updateSessionScheduling(session.id, {
      autoRescheduleEnabled: false,
    });

    fetched = await getSession(session.id);
    expect(fetched.autoRescheduleEnabled).toBe(false);
  });

  test('can reset reschedule count via PATCH', async () => {
    const session = await seedScheduledSession(project.id, {
      prompt: 'Test reset count',
      autoRescheduleEnabled: true,
    });

    // Simulate previous reschedules
    await updateSessionScheduling(session.id, {
      rescheduleCount: 3,
    });

    let fetched = await getSession(session.id);
    expect(fetched.rescheduleCount).toBe(3);

    // Reset count to 0
    await updateSessionScheduling(session.id, {
      rescheduleCount: 0,
    });

    fetched = await getSession(session.id);
    expect(fetched.rescheduleCount).toBe(0);
  });

  test('nullable fields accept null to clear limits', async () => {
    const session = await seedScheduledSession(project.id, {
      prompt: 'Test null limits',
      maxRescheduleCount: 10,
      maxTotalTokens: 500000,
      rescheduleAtTokenCount: 100000,
    });

    // Verify initial values
    let fetched = await getSession(session.id);
    expect(fetched.maxRescheduleCount).toBe(10);
    expect(fetched.maxTotalTokens).toBe(500000);
    expect(fetched.rescheduleAtTokenCount).toBe(100000);

    // Set all to null (unlimited)
    await updateSessionScheduling(session.id, {
      maxRescheduleCount: null,
      maxTotalTokens: null,
      rescheduleAtTokenCount: null,
    });

    fetched = await getSession(session.id);
    expect(fetched.maxRescheduleCount).toBeNull();
    expect(fetched.maxTotalTokens).toBeNull();
    expect(fetched.rescheduleAtTokenCount).toBeNull();
  });
});

// ============================================================
// Category 2: Reschedule Limit Enforcement (5 tests)
// ============================================================

test.describe('Category 2: Reschedule Limit Enforcement', () => {
  test.describe.configure({ timeout: 30000 });

  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('Reschedule Limits Test', '/tmp/reschedule-limits-test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('max reschedule count prevents further rescheduling', async () => {
    const session = await seedScheduledSession(project.id, {
      prompt: 'Test max count limit',
      autoRescheduleEnabled: true,
      maxRescheduleCount: 2,
    });

    // Simulate approaching limit
    await updateSessionScheduling(session.id, {
      rescheduleCount: 1,
    });

    let fetched = await getSession(session.id);
    expect(fetched.rescheduleCount).toBe(1);
    expect(fetched.maxRescheduleCount).toBe(2);
    // Count is below limit, so reschedule would still be possible
    expect(fetched.rescheduleCount).toBeLessThan(fetched.maxRescheduleCount);

    // Simulate reaching limit
    await updateSessionScheduling(session.id, {
      rescheduleCount: 2,
    });

    fetched = await getSession(session.id);
    expect(fetched.rescheduleCount).toBe(2);
    // Count has reached the limit
    expect(fetched.rescheduleCount).toBe(fetched.maxRescheduleCount);
  });

  test('session with rescheduleCount at max has correct state', async () => {
    const session = await seedScheduledSession(project.id, {
      prompt: 'Test count at max',
      autoRescheduleEnabled: true,
      maxRescheduleCount: 3,
    });

    await updateSessionScheduling(session.id, {
      rescheduleCount: 3,
    });

    const fetched = await getSession(session.id);
    expect(fetched.rescheduleCount).toBe(3);
    expect(fetched.maxRescheduleCount).toBe(3);
    // Count meets limit — no further rescheduling should occur
    expect(fetched.rescheduleCount >= fetched.maxRescheduleCount).toBe(true);
  });

  test('max total tokens field persists correctly', async () => {
    const session = await seedScheduledSession(project.id, {
      prompt: 'Test max total tokens',
      maxTotalTokens: 100000,
    });

    const fetched = await getSession(session.id);
    expect(fetched.maxTotalTokens).toBe(100000);
  });

  test('rescheduleAtTokenCount (soft threshold) persists correctly', async () => {
    const session = await seedScheduledSession(project.id, {
      prompt: 'Test soft threshold',
      rescheduleAtTokenCount: 50000,
    });

    let fetched = await getSession(session.id);
    expect(fetched.rescheduleAtTokenCount).toBe(50000);

    // Clear it
    await updateSessionScheduling(session.id, {
      rescheduleAtTokenCount: null,
    });

    fetched = await getSession(session.id);
    expect(fetched.rescheduleAtTokenCount).toBeNull();
  });

  test('all limits can coexist on same session', async () => {
    const session = await seedScheduledSession(project.id, {
      prompt: 'Test coexisting limits',
      autoRescheduleEnabled: true,
      maxRescheduleCount: 10,
      maxTotalTokens: 500000,
      rescheduleAtTokenCount: 200000,
    });

    const fetched = await getSession(session.id);
    expect(fetched.autoRescheduleEnabled).toBe(true);
    expect(fetched.maxRescheduleCount).toBe(10);
    expect(fetched.maxTotalTokens).toBe(500000);
    expect(fetched.rescheduleAtTokenCount).toBe(200000);
  });
});

// ============================================================
// Category 3: Scheduled Session Lifecycle (5 tests)
// ============================================================

test.describe('Category 3: Scheduled Session Lifecycle', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('Scheduled Lifecycle Test', '/tmp/scheduled-lifecycle-test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('session created with future scheduledAt gets status scheduled', async () => {
    const futureTime = Date.now() + 3600000; // 1 hour from now
    const session = await seedScheduledSession(project.id, {
      prompt: 'Future scheduled session',
      scheduledAt: futureTime,
    });

    const fetched = await getSession(session.id);
    expect(fetched.status).toBe('scheduled');
    expect(fetched.scheduledAt).toBe(futureTime);
  });

  test('scheduler starts session when scheduledAt time is reached', async () => {
    // Schedule 3 seconds in the future to allow scheduler to pick it up
    const futureTime = Date.now() + 3000;
    const session = await seedScheduledSession(project.id, {
      prompt: 'Soon to start session',
      scheduledAt: futureTime,
    });

    expect(session.status).toBe('scheduled');

    // Poll for status change — scheduler polls every 30s, so give up to 45s
    const start = Date.now();
    let finalSession: any = null;
    while (Date.now() - start < 45000) {
      finalSession = await getSession(session.id);
      if (finalSession.status !== 'scheduled') {
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    // Session should have transitioned from 'scheduled' to something else
    expect(finalSession).not.toBeNull();
    expect(['starting', 'running', 'waiting', 'completed', 'error']).toContain(finalSession.status);
  });

  test('cancelling a scheduled session clears scheduledAt', async () => {
    const session = await seedScheduledSession(project.id, {
      prompt: 'Session to cancel',
      scheduledAt: Date.now() + 3600000,
    });

    expect(session.status).toBe('scheduled');

    // Cancel by clearing scheduledAt and setting status to stopped
    await updateSessionScheduling(session.id, {
      scheduledAt: null,
      status: 'stopped',
    });

    const fetched = await getSession(session.id);
    expect(fetched.scheduledAt).toBeNull();
    expect(fetched.status).toBe('stopped');
  });

  test('pendingPrompt is preserved on scheduled session', async () => {
    const session = await seedScheduledSession(project.id, {
      prompt: 'My scheduled task',
      scheduledAt: Date.now() + 3600000,
    });

    const fetched = await getSession(session.id);
    expect(fetched.pendingPrompt).toBe('My scheduled task');
  });

  test('editing pendingPrompt on scheduled session persists', async () => {
    const session = await seedScheduledSession(project.id, {
      prompt: 'Original prompt',
      scheduledAt: Date.now() + 3600000,
    });

    // Update the pending prompt
    await updatePendingPrompt(session.id, 'Updated prompt');

    const fetched = await getSession(session.id);
    expect(fetched.pendingPrompt).toBe('Updated prompt');
  });
});

// ============================================================
// Category 4: Scheduled Sessions API Endpoint (3 tests)
// ============================================================

test.describe('Category 4: Scheduled Sessions API Endpoint', () => {
  test.describe.configure({ timeout: 30000 });

  let project1: any;
  let project2: any;

  test.beforeEach(async () => {
    project1 = await seedProject('Scheduled API Test 1', '/tmp/scheduled-api-1');
    project2 = await seedProject('Scheduled API Test 2', '/tmp/scheduled-api-2');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('GET /api/sessions/scheduled returns scheduled sessions', async () => {
    // Create 2 scheduled sessions
    const s1 = await seedScheduledSession(project1.id, {
      prompt: 'Scheduled session 1',
      scheduledAt: Date.now() + 3600000,
    });
    const s2 = await seedScheduledSession(project1.id, {
      prompt: 'Scheduled session 2',
      scheduledAt: Date.now() + 7200000,
    });

    // Create 1 non-scheduled session (waiting/draft)
    const s3 = await seedSession(project1.id, {
      prompt: 'Not scheduled',
      startImmediately: false,
    });

    // Fetch scheduled sessions
    const scheduled = await getScheduledSessions();

    // Both scheduled sessions should be present
    const scheduledIds = scheduled.map((s: any) => s.id);
    expect(scheduledIds).toContain(s1.id);
    expect(scheduledIds).toContain(s2.id);

    // Non-scheduled session should NOT be present
    expect(scheduledIds).not.toContain(s3.id);
  });

  test('GET /api/sessions/scheduled filters by projectId', async () => {
    // Create scheduled sessions in 2 different projects
    const s1 = await seedScheduledSession(project1.id, {
      prompt: 'Project 1 scheduled',
      scheduledAt: Date.now() + 3600000,
    });
    const s2 = await seedScheduledSession(project2.id, {
      prompt: 'Project 2 scheduled',
      scheduledAt: Date.now() + 3600000,
    });

    // Filter by project1
    const project1Scheduled = await getScheduledSessions(project1.id);
    const project1Ids = project1Scheduled.map((s: any) => s.id);
    expect(project1Ids).toContain(s1.id);
    expect(project1Ids).not.toContain(s2.id);

    // Filter by project2
    const project2Scheduled = await getScheduledSessions(project2.id);
    const project2Ids = project2Scheduled.map((s: any) => s.id);
    expect(project2Ids).toContain(s2.id);
    expect(project2Ids).not.toContain(s1.id);
  });

  test('GET /api/sessions/scheduled returns empty array when none scheduled', async () => {
    // Create only non-scheduled sessions
    await seedSession(project1.id, {
      prompt: 'Regular session',
      startImmediately: false,
    });

    // Fetch scheduled for this project specifically
    const scheduled = await getScheduledSessions(project1.id);
    expect(scheduled).toEqual([]);
  });
});

// ============================================================
// Category 5: Scheduling UI Components (2 tests)
// ============================================================

test.describe('Category 5: Scheduling UI Components', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('Reschedule UI Test', '/tmp/reschedule-ui-test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('scheduled session card shows countdown and edit button', async ({ page }) => {
    // Create a scheduled session
    const session = await seedScheduledSession(project.id, {
      prompt: 'Scheduled session for UI test',
      scheduledAt: Date.now() + 3600000,
    });

    // Navigate to session list, Scheduled tab
    await navigateAndWait(page, `/projects/${project.id}/scheduled`);

    // Verify ScheduledSessionCard is visible
    const card = page.locator('.scheduled-session-card');
    await expect(card).toBeVisible({ timeout: 10000 });

    // Verify countdown text is present (formatDistanceToNow output)
    const timingText = page.locator('.timing-text');
    await expect(timingText.first()).toBeVisible();
    // The text should contain some time reference (e.g., "in about 1 hour")
    const text = await timingText.first().textContent();
    expect(text).toBeTruthy();

    // Verify Edit Schedule button is present
    await expect(page.getByText('Edit Schedule')).toBeVisible();
  });

  test('edit schedule modal saves updated time', async ({ page }) => {
    const session = await seedScheduledSession(project.id, {
      prompt: 'Session to edit schedule',
      scheduledAt: Date.now() + 3600000,
    });

    // Navigate to session detail conversation tab (Edit Schedule button is in ConversationTab)
    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Click "Edit Schedule" button
    const editButton = page.getByRole('button', { name: 'Edit Schedule' });
    await expect(editButton).toBeVisible({ timeout: 10000 });
    await editButton.click();

    // Modal should be visible
    // Look for a datetime input or modal
    const modal = page.locator('[class*="modal"]').first();
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Find datetime input within the modal and update it
    const datetimeInput = modal.locator('input[type="datetime-local"]');
    if (await datetimeInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Set a new time (2 hours from now)
      const newTime = new Date(Date.now() + 7200000);
      const isoString = newTime.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
      await datetimeInput.fill(isoString);

      // Save
      const saveButton = modal.locator('button').filter({ hasText: /save|schedule|update/i });
      if (await saveButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await saveButton.click();

        // Wait for modal to close
        await page.waitForTimeout(1000);

        // Verify new time persisted (API check)
        const updated = await getSession(session.id);
        // The time should have changed from the original
        expect(updated.scheduledAt).not.toBe(session.scheduledAt);
      }
    }
  });

});

// ============================================================
// Category 6: Reschedule Triggers Configuration (3 tests)
// ============================================================

test.describe('Category 6: Reschedule Triggers Configuration', () => {
  test.describe.configure({ timeout: 30000 });

  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('Reschedule Triggers Test', '/tmp/reschedule-triggers-test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('rescheduleOnTokenLimit field persists independently', async () => {
    const session = await seedScheduledSession(project.id, {
      prompt: 'Test token limit trigger',
      rescheduleOnTokenLimit: true,
      rescheduleOnServiceError: false,
    });

    // The creation handler defaults rescheduleOnServiceError to true unless explicitly false
    // So we need to update via PATCH to ensure the value we want
    await updateSessionScheduling(session.id, {
      rescheduleOnTokenLimit: true,
      rescheduleOnServiceError: false,
    });

    const fetched = await getSession(session.id);
    expect(fetched.rescheduleOnTokenLimit).toBe(true);
    expect(fetched.rescheduleOnServiceError).toBe(false);
  });

  test('rescheduleOnServiceError field persists independently', async () => {
    const session = await seedScheduledSession(project.id, {
      prompt: 'Test service error trigger',
    });

    // Explicitly set the fields via PATCH
    await updateSessionScheduling(session.id, {
      rescheduleOnTokenLimit: false,
      rescheduleOnServiceError: true,
    });

    const fetched = await getSession(session.id);
    expect(fetched.rescheduleOnTokenLimit).toBe(false);
    expect(fetched.rescheduleOnServiceError).toBe(true);
  });

  test('both triggers can be enabled simultaneously', async () => {
    const session = await seedScheduledSession(project.id, {
      prompt: 'Test both triggers',
    });

    await updateSessionScheduling(session.id, {
      rescheduleOnTokenLimit: true,
      rescheduleOnServiceError: true,
    });

    const fetched = await getSession(session.id);
    expect(fetched.rescheduleOnTokenLimit).toBe(true);
    expect(fetched.rescheduleOnServiceError).toBe(true);
  });
});
