import { test, expect } from '@playwright/test';
import {
  seedProject,
  cleanupCreatedResources,
} from './helpers';

/**
 * Test suite for validating Quick Response Dialog Save button remains visible in fixed footer
 */

test.describe('Quick Response Dialog - Fixed Footer with Save Button', () => {
  test.beforeEach(async () => {
    await cleanupCreatedResources();
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  /**
   * Edit quick response dialog and verify Save button is visible
   */
  test('should display Save button in fixed footer when editing existing quick response', async ({ page }) => {
    // Create a test project
    const project = await seedProject('[TEST] Quick Response Edit', '/tmp/qr-test-4');

    // Navigate to project edit page
    await page.goto(`/projects/${project.id}/edit`);
    await page.waitForLoadState('networkidle');

    // Open manage quick responses
    const details = page.locator('details').filter({ hasText: 'Quick Responses' });
    if (await details.isVisible({ timeout: 3000 }).catch(() => false)) {
      const summary = details.locator('summary');
      if (await summary.isVisible()) {
        await summary.click();
        await page.waitForTimeout(300);
      }
    }

    const manageBtn = page.getByRole('button', { name: 'Manage Quick Responses' });
    if (await manageBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await manageBtn.click();
      await page.waitForLoadState('networkidle');
    }

    // First, create a quick response
    const addButtons = page.getByRole('button', { name: /\+ Add/ });
    if (await addButtons.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await addButtons.first().click();
      await page.waitForTimeout(300);
    }

    // Find the Add dialog by looking for a dialog that contains the QR form fields
    let addDialog = page.locator('[role="dialog"]').filter({ has: page.locator('#qr-label') });
    await expect(addDialog).toBeVisible({ timeout: 5000 });

    // Fill and save
    const labelInput = addDialog.locator('#qr-label');
    await labelInput.fill('Test Response');

    const contentTextarea = addDialog.locator('#qr-content');
    await contentTextarea.fill('This is a test response content');

    const saveButton = addDialog.locator('button[type="submit"]');
    await saveButton.click();

    // Wait for the Add dialog's form to disappear (the dialog with #qr-label should close)
    await expect(addDialog).not.toBeVisible({ timeout: 5000 });

    // Wait for the created quick response to appear in the list
    // Use .response-label selector to avoid matching both label and content spans
    await expect(page.locator('.response-label', { hasText: 'Test Response' })).toBeVisible({ timeout: 5000 });

    // Now find and click the edit button for the created response
    const editButtons = page.getByRole('button', { name: /edit/i });
    await expect(editButtons.first()).toBeVisible({ timeout: 5000 });
    await editButtons.first().click();

    // The edit dialog should now be open - find it by the QR form fields
    const dialog = page.locator('[role="dialog"]').filter({ has: page.locator('#qr-label') });
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Verify it's an edit dialog
    const title = dialog.locator('.dialog-title');
    await expect(title).toContainText(/Edit Quick Response/);

    // Verify Save button is visible in footer
    const footer = dialog.locator('.dialog-footer');
    await expect(footer).toBeVisible();

    const editSaveButton = footer.locator('button[type="submit"]');
    await expect(editSaveButton).toBeVisible();

    // Verify button says "Save Changes" or similar
    const buttonText = await editSaveButton.textContent();
    expect(buttonText?.trim()).toMatch(/Save Changes|Save/);
  });
});
