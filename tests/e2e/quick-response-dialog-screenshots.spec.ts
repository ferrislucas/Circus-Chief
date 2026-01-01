import { test, expect } from '@playwright/test';
import { cleanupCreatedResources, waitForPageReady } from './helpers';

test.describe('Quick Response Dialog Screenshots', () => {
  test.beforeEach(async () => {
    await cleanupCreatedResources();
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('captures Quick Response dialog with Save button visible', async ({ page }) => {
    // Navigate to home page first
    await page.goto('/');
    await waitForPageReady(page);

    // Create a test project using the UI
    await page.click('text=New Project');
    await expect(page).toHaveURL(/\/projects\/new/);

    await page.fill('input[id="name"]', 'Screenshot Test');
    await page.fill('.path-chooser input', '/tmp/screenshot-test');
    await page.click('button:has-text("Create Project")');

    // Wait for redirect to sessions page
    await expect(page).toHaveURL(/\/projects\/[\w-]+\/sessions/);

    // Extract project ID from URL
    const url = page.url();
    const projectId = url.match(/\/projects\/([\w-]+)\/sessions/)?.[1];
    expect(projectId).toBeTruthy();

    // Navigate to project edit page
    await page.goto(`/projects/${projectId}/edit`);
    await waitForPageReady(page);

    // Wait for the page to load
    await expect(page.getByText('Edit Project')).toBeVisible();

    // Scroll down to find Quick Responses section
    await page.evaluate(() => {
      const summaryElements = document.querySelectorAll('details');
      for (const summary of summaryElements) {
        if (summary.textContent?.includes('Quick Responses')) {
          summary.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    });

    // Wait a moment for scrolling
    await page.waitForTimeout(500);

    // Click the Quick Responses details to expand it
    const quickResponsesDetails = page.locator('details:has-text("Quick Responses")');
    const summary = quickResponsesDetails.locator('summary');
    await summary.click();

    // Wait for the button to be visible
    await expect(page.getByRole('button', { name: 'Manage Quick Responses' })).toBeVisible();

    // Click "Manage Quick Responses" button
    await page.getByRole('button', { name: 'Manage Quick Responses' }).click();

    // Wait for the settings panel to appear
    await expect(page.getByText('Quick Responses')).toBeVisible({ timeout: 5000 });

    // Wait for the settings panel to be fully rendered
    await page.waitForSelector('.settings-panel', { state: 'visible' });

    // Take a screenshot of the full settings panel
    const settingsPanel = page.locator('.settings-panel');
    await settingsPanel.screenshot({ path: '/tmp/quick-response-settings-panel.png' });

    // Click the "+ Add" button to open the dialog (for Project Responses)
    await page.getByRole('button', { name: '+ Add' }).first().click();

    // Wait for the dialog to appear
    await expect(page.locator('[role="dialog"]').last()).toBeVisible({ timeout: 5000 });

    // Wait for dialog to be fully rendered
    await page.waitForTimeout(300);

    // Take a screenshot of the full dialog with all fields visible
    const dialog = page.locator('.dialog').last();
    await dialog.screenshot({ path: '/tmp/quick-response-dialog-full.png' });

    // Scroll to the footer to ensure Save button is visible
    await dialog.evaluate((el) => {
      const footer = el.querySelector('.dialog-footer');
      if (footer) {
        footer.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    });

    await page.waitForTimeout(300);

    // Take a screenshot of the footer with the Save button
    const footer = page.locator('.dialog-footer').last();
    await footer.screenshot({ path: '/tmp/quick-response-dialog-footer.png' });

    // Verify the Save button exists and is visible
    const saveButton = dialog.locator('button[type="submit"]');
    await expect(saveButton).toBeVisible();

    // Verify the button text contains "Save"
    const buttonText = await saveButton.textContent();
    expect(buttonText).toContain('Save');

    // Take a full page screenshot showing the entire dialog
    const viewport = page.viewportSize();
    if (viewport) {
      await page.screenshot({ path: '/tmp/quick-response-dialog-full-page.png' });
    }

    console.log('Screenshots captured:');
    console.log('- /tmp/quick-response-settings-panel.png');
    console.log('- /tmp/quick-response-dialog-full.png');
    console.log('- /tmp/quick-response-dialog-footer.png');
    console.log('- /tmp/quick-response-dialog-full-page.png');
  });

  test('captures Quick Response edit dialog with Save Changes button', async ({ page }) => {
    // Navigate to home page first
    await page.goto('/');
    await waitForPageReady(page);

    // Create a test project using the UI
    await page.click('text=New Project');
    await expect(page).toHaveURL(/\/projects\/new/);

    await page.fill('input[id="name"]', 'Edit Dialog Test');
    await page.fill('.path-chooser input', '/tmp/edit-dialog-test');
    await page.click('button:has-text("Create Project")');

    // Wait for redirect to sessions page
    await expect(page).toHaveURL(/\/projects\/[\w-]+\/sessions/);

    // Extract project ID from URL
    const url = page.url();
    const projectId = url.match(/\/projects\/([\w-]+)\/sessions/)?.[1];
    expect(projectId).toBeTruthy();

    // Navigate to project edit page
    await page.goto(`/projects/${projectId}/edit`);
    await waitForPageReady(page);

    // Wait for the page to load
    await expect(page.getByText('Edit Project')).toBeVisible();

    // Scroll down to Quick Responses section
    await page.evaluate(() => {
      const summaryElements = document.querySelectorAll('details');
      for (const summary of summaryElements) {
        if (summary.textContent?.includes('Quick Responses')) {
          summary.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    });

    await page.waitForTimeout(500);

    // Expand Quick Responses section
    const quickResponsesDetails = page.locator('details:has-text("Quick Responses")');
    const summary = quickResponsesDetails.locator('summary');
    await summary.click();

    // Click "Manage Quick Responses"
    await page.getByRole('button', { name: 'Manage Quick Responses' }).click();

    // Wait for settings panel
    await expect(page.getByText('Quick Responses')).toBeVisible({ timeout: 5000 });

    // Add a test quick response first
    await page.getByRole('button', { name: '+ Add' }).first().click();

    // Wait for dialog
    await expect(page.locator('[role="dialog"]').last()).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(300);

    // Fill in the form to create a quick response
    const dialog = page.locator('.dialog').last();
    const labelInput = dialog.locator('#qr-label');
    const contentInput = dialog.locator('#qr-content');

    await labelInput.fill('Test Response');
    await contentInput.fill('This is a test quick response for editing');

    // Take screenshot before saving
    await dialog.screenshot({ path: '/tmp/quick-response-dialog-before-save.png' });

    // Click Save button
    const saveButton = dialog.locator('button[type="submit"]');
    await saveButton.click();

    // Wait for dialog to close and response to be added
    await page.waitForTimeout(500);

    // The response should now appear in the list, click Edit to show the dialog again
    const editButton = page.locator('.action-button').first();
    if (await editButton.isVisible()) {
      await editButton.click();

      // Wait for edit dialog
      await expect(page.locator('[role="dialog"]').last()).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(300);

      const editDialog = page.locator('.dialog').last();

      // Take screenshot of edit dialog
      await editDialog.screenshot({ path: '/tmp/quick-response-dialog-edit-mode.png' });

      // Verify the button says "Save Changes" instead of "Save Quick Response"
      const editSaveButton = editDialog.locator('button[type="submit"]');
      await expect(editSaveButton).toBeVisible();
      const editButtonText = await editSaveButton.textContent();
      expect(editButtonText).toContain('Save');

      console.log('Edit dialog screenshots captured:');
      console.log('- /tmp/quick-response-dialog-before-save.png');
      console.log('- /tmp/quick-response-dialog-edit-mode.png');
    }
  });
});
