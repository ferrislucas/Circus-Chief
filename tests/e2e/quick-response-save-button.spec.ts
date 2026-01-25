import { test, expect } from '@playwright/test';
import { seedProject, navigateAndWait, cleanupCreatedResources } from './helpers';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function getAPIURL(): string {
  if (process.env.API_URL) return process.env.API_URL;
  const portFile = join(process.cwd(), '.server-port');
  if (existsSync(portFile)) {
    const port = readFileSync(portFile, 'utf-8').trim();
    return `http://localhost:${port}`;
  }
  return 'http://localhost:5000';
}

test.skip('Quick Response Dialog displays Save button - TODO: fix dialog visibility', async ({ page, baseURL }) => {
  const API_URL = getAPIURL();
  const appURL = API_URL.replace('/api', '');

  // Create a project
  const project = await seedProject('Test Project', '/tmp/test-project');
  
  try {
    // Navigate to project edit page
    await navigateAndWait(page, `${appURL}/#/projects/${project.id}/edit`);

    // Find and click the settings/quick response button
    const settingsButton = page.locator('button[title="Manage quick responses"]').first();
    if (await settingsButton.isVisible()) {
      await settingsButton.click();
      await page.waitForTimeout(500);
    }

    // Click the Add button for project-specific responses
    const addButtons = page.locator('button:has-text("Add")');
    const firstAdd = addButtons.first();
    if (await firstAdd.isVisible()) {
      await firstAdd.click();
      await page.waitForTimeout(500);
    }

    // Get the dialog
    const dialog = page.locator('[role="dialog"]').first();
    expect(await dialog.isVisible()).toBeTruthy();

    // Fill in the form
    await page.fill('input[placeholder*="Yes, LGTM"]', 'Looks Good');
    await page.fill('textarea[placeholder*="full message"]', 'This looks good to me!');
    await page.waitForTimeout(300);

    // Take screenshot of dialog with filled form and buttons visible
    await page.setViewportSize({ width: 700, height: 900 });
    await page.screenshot({
      path: 'screenshots/save-button-visible.png',
      fullPage: false
    });
    console.log('✓ Screenshot saved: save-button-visible.png');

    // Verify the Save button exists and is visible
    const saveButton = page.locator('button[type="submit"]');
    expect(await saveButton.isVisible()).toBeTruthy();

    // Take a zoomed in screenshot of the footer
    const footer = page.locator('.dialog-footer');
    await footer.screenshot({ path: 'screenshots/save-button-footer.png' });
    console.log('✓ Screenshot saved: save-button-footer.png');

  } finally {
    await cleanupCreatedResources();
  }
});
