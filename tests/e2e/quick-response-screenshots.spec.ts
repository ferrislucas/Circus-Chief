import { test, expect } from '@playwright/test';
import { seedProject, cleanupAll, navigateAndWait } from './helpers';

test.describe('Quick Response Dialog Screenshots', () => {
  test.beforeEach(async () => {
    await cleanupAll();
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('captures Quick Response dialog with Save button visible', async ({ page, baseURL }) => {
    console.log('Using baseURL:', baseURL);

    // Create a test project
    const project = await seedProject('[TEST] QR Screenshots', '/tmp/qr-screenshots');

    // Navigate to project edit page
    await navigateAndWait(page, `${baseURL}/#/projects/${project.id}/edit`);

    // Wait for the page to load
    await expect(page.getByText(/Edit Project|Project Settings/)).toBeVisible();

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
    await settingsPanel.screenshot({ path: 'screenshots/quick-response-settings-panel.png' });
    console.log('✓ Screenshot saved: quick-response-settings-panel.png');

    // Click the "+ Add" button to open the dialog (for Project Responses)
    await page.getByRole('button', { name: '+ Add' }).first().click();

    // Wait for the dialog to appear
    await expect(page.locator('[role="dialog"]').last()).toBeVisible({ timeout: 5000 });

    // Wait for dialog to be fully rendered
    await page.waitForTimeout(300);

    // Take a screenshot of the full dialog with all fields visible
    const dialog = page.locator('[role="dialog"]').last();
    await dialog.screenshot({ path: 'screenshots/quick-response-dialog-full.png' });
    console.log('✓ Screenshot saved: quick-response-dialog-full.png');

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
    await footer.screenshot({ path: 'screenshots/quick-response-dialog-footer.png' });
    console.log('✓ Screenshot saved: quick-response-dialog-footer.png');

    // Verify the Save button exists and is visible
    const saveButton = dialog.locator('button[type="submit"]');
    await expect(saveButton).toBeVisible();

    // Verify the button text contains "Save"
    const buttonText = await saveButton.textContent();
    expect(buttonText).toContain('Save');

    console.log('\n✓ All screenshots captured:');
    console.log('- quick-response-settings-panel.png');
    console.log('- quick-response-dialog-full.png');
    console.log('- quick-response-dialog-footer.png');
  });
});
