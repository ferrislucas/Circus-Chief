import { test, expect, Page } from '@playwright/test';
import { seedProject, cleanupAll, navigateAndWait } from './helpers';

test.describe('Quick Response Dialog Screenshots', () => {
  test.beforeEach(async () => {
    await cleanupAll();
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test.skip('demonstrates Quick Response dialog with Save button - TODO: fix missing heading selector', async ({ page, baseURL }) => {
    // Create a test project
    const project = await seedProject('[TEST] QR Final Screenshot', '/tmp/qr-final-test');

    // Navigate to the project edit page
    try {
      await navigateAndWait(page, `${baseURL}/#/projects/${project.id}/edit`);
    } catch (e) {
      // If navigation fails, the server might not be running
      console.error('Failed to navigate to project edit page');
      throw e;
    }

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Verify we're on the edit page
    const editHeading = page.locator('h1, h2').filter({ hasText: /Edit Project|Project Settings/ });
    await expect(editHeading).toBeVisible({ timeout: 10000 });

    // Find and expand Quick Responses section
    const details = page.locator('details').filter({ hasText: 'Quick Responses' });
    if (await details.isVisible({ timeout: 5000 })) {
      // Click summary to expand
      await details.locator('summary').click();
      await page.waitForTimeout(300);
    }

    // Click "Manage Quick Responses"
    const manageBtn = page.getByRole('button', { name: 'Manage Quick Responses' });
    await manageBtn.click();

    // Wait for modal
    const modal = page.locator('.settings-panel');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(300);

    // Take screenshot of modal
    await modal.screenshot({ path: 'screenshots/quick-response-settings.png' });
    console.log('✓ Screenshot saved: quick-response-settings.png');

    // Click "+ Add" button for project responses
    const addButtons = page.getByRole('button', { name: /\+ Add/ });
    const addButton = addButtons.first();
    await addButton.click();

    // Wait for dialog
    const dialog = page.locator('[role="dialog"]').last();
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(300);

    // Take screenshot of dialog
    await dialog.screenshot({ path: 'screenshots/quick-response-dialog.png' });
    console.log('✓ Screenshot saved: quick-response-dialog.png');

    // Find Save button and verify it's visible
    const saveButton = dialog.locator('button[type="submit"]');
    await expect(saveButton).toBeVisible();

    // Take screenshot of just the footer with Save button
    const footer = dialog.locator('.dialog-footer');
    await footer.screenshot({ path: 'screenshots/quick-response-dialog-footer.png' });
    console.log('✓ Screenshot saved: quick-response-dialog-footer.png');

    // Verify button text
    const buttonText = await saveButton.textContent();
    console.log('Save button text:', buttonText);
    expect(buttonText?.toLocaleLowerCase()).toContain('save');

    // Fill form to show all fields including save button
    await dialog.locator('#qr-label').fill('Test Response');
    await dialog.locator('#qr-content').fill('This is a test quick response');

    // Take final screenshot with form filled
    await dialog.screenshot({ path: 'screenshots/quick-response-dialog-filled.png' });
    console.log('✓ Screenshot saved: quick-response-dialog-filled.png');

    console.log('\n✓ All screenshots captured successfully!');
    console.log('Files saved to screenshots/:');
    console.log('  - quick-response-settings.png');
    console.log('  - quick-response-dialog.png');
    console.log('  - quick-response-dialog-footer.png');
    console.log('  - quick-response-dialog-filled.png');
  });
});
