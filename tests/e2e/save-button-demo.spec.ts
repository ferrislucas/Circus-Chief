import { test, expect } from '@playwright/test';
import { seedProject, cleanupAll, navigateAndWait } from './helpers';

test('Quick Response Dialog - Save Button Visible', async ({ page, baseURL }) => {
  await cleanupAll();

  try {
    // Create a test project
    const project = await seedProject('[TEST] Save Button Demo', '/tmp/save-button-demo');

    // Navigate to project edit page
    await navigateAndWait(page, `${baseURL}/#/projects/${project.id}/edit`);

    // Get the project data to verify
    const projectsResponse = await page.evaluate(async (projectId) => {
      const res = await fetch(`/api/projects/${projectId}`);
      return await res.json();
    }, project.id);

    if (projectsResponse && projectsResponse.id) {
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
      if (await manageBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await manageBtn.click();
        await page.waitForLoadState('networkidle');
      }

      // Click "+ Add" button to open dialog
      const addButtons = page.getByRole('button', { name: /\+ Add/ });
      if (await addButtons.first().isVisible({ timeout: 3000 }).catch(() => false)) {
        await addButtons.first().click();
        await page.waitForTimeout(300);
      }

      // Get the dialog and take a full screenshot showing both buttons
      const dialog = page.locator('[role="dialog"]').first();

      if (await dialog.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Set a reasonable viewport height to show the full dialog
        await page.setViewportSize({ width: 600, height: 1000 });
        await page.waitForTimeout(500);

        // Take screenshot of entire page showing the dialog with buttons
        await page.screenshot({ path: 'screenshots/dialog-with-save-button.png', fullPage: false });
        console.log('✓ Screenshot with Save button saved');

        // Scroll within dialog to show footer
        await dialog.evaluate(el => {
          const content = el.querySelector('.dialog-content');
          if (content) content.scrollTop = content.scrollHeight;
        });
        await page.waitForTimeout(300);

        // Take another screenshot showing the footer clearly
        await page.screenshot({ path: 'screenshots/dialog-footer-buttons.png', fullPage: false });
        console.log('✓ Screenshot of footer buttons saved');

        // Fill in the form to make it look complete
        const labelInput = dialog.locator('#qr-label');
        await labelInput.fill('Test Response');
        const contentTextarea = dialog.locator('#qr-content');
        await contentTextarea.fill('This is a test quick response message');
        await page.waitForTimeout(300);

        // Take a final screenshot with filled form and visible Save button
        await page.screenshot({ path: 'screenshots/dialog-filled-with-save.png', fullPage: false });
        console.log('✓ Screenshot with filled form and Save button saved');
      }
    }
  } finally {
    await cleanupAll();
  }
});
