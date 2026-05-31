import { test, expect } from '@playwright/test';
import { seedProject, cleanupAll, navigateAndWait, expectHitTestable } from './helpers';

test('Quick Response Dialog - Save Button Visible', async ({ page }) => {
  await cleanupAll();

  try {
    // Create a test project
    const project = await seedProject('[TEST] Save Button Demo', '/tmp/save-button-demo');

    // Navigate to project edit page
    await navigateAndWait(page, `/projects/${project.id}/edit`);

    // Expand Quick Responses section if needed
    const details = page.locator('details').filter({ hasText: 'Quick Responses' });
    if (await details.isVisible({ timeout: 3000 }).catch(() => false)) {
      const summary = details.locator('summary');
      if (await summary.isVisible()) {
        await summary.click();
        await page.waitForTimeout(300);
      }
    }

    // Click "Manage Quick Responses" button
    const manageBtn = page.getByRole('button', { name: 'Manage Quick Responses' });
    await expectHitTestable(manageBtn, { requireEnabled: true });
    await manageBtn.click();
    await page.waitForLoadState('networkidle');

    // Click "+ Add" button to open dialog
    const addButton = page.getByRole('button', { name: /\+ Add/ }).first();
    await expectHitTestable(addButton, { requireEnabled: true });
    await addButton.click();

    // Get the dialog and verify its save affordance is actually usable.
    const dialog = page.locator('[role="dialog"]').filter({ has: page.locator('#qr-label') });
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const labelInput = dialog.locator('#qr-label');
    await expect(labelInput).toBeVisible();
    await labelInput.fill('Test Response');

    const contentTextarea = dialog.locator('#qr-content');
    await expect(contentTextarea).toBeVisible();
    await contentTextarea.fill('This is a test quick response message');

    const saveButton = dialog.locator('.dialog-footer button[type="submit"]');
    await expect(saveButton).toHaveText(/Save/);
    await expectHitTestable(saveButton, { requireEnabled: true });
  } finally {
    await cleanupAll();
  }
});
