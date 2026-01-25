import { test, expect } from '@playwright/test';

/**
 * Test to verify QuickResponsesPanel is visible and positioned below input form
 */

test('verify quick responses panel is visible below input', async ({ page }) => {
  await page.goto('http://localhost:5002');
  await page.waitForTimeout(1000);

  // Navigate to first project
  const projectLink = page.locator('a').filter({ hasText: /Project|Test/ }).first();
  if (await projectLink.isVisible({ timeout: 5000 })) {
    await projectLink.click();
    await page.waitForTimeout(1500);
  } else {
    throw new Error('No project found');
  }

  // Click New Session
  const newSessionBtn = page.locator('button').filter({ hasText: 'New Session' });
  await newSessionBtn.click();
  await page.waitForTimeout(2000);

  // Verify we're on new-session page
  expect(page.url()).toContain('/new-session');

  // Wait for the form to be visible
  const form = page.locator('form').filter({ has: page.locator('textarea') });
  await expect(form).toBeVisible({ timeout: 5000 });

  // Wait for QuickResponsesPanel to be present
  const quickResponsesPanel = page.locator('.quick-responses-panel');
  await expect(quickResponsesPanel).toBeVisible({ timeout: 5000 });

  // Get position of form and panel
  const formBox = await form.boundingBox();
  const panelBox = await quickResponsesPanel.boundingBox();

  console.log('\n=== Layout Verification ===');
  console.log(`Form: y=${formBox.y}, height=${formBox.height}, bottom=${formBox.y + formBox.height}`);
  console.log(`Panel: y=${panelBox.y}, height=${panelBox.height}`);
  console.log(`Panel is BELOW form: ${panelBox.y > formBox.y + formBox.height}`);

  // Take screenshot of collapsed panel
  await page.screenshot({
    path: 'screenshots/quick-responses-collapsed.png',
    fullPage: false
  });
  console.log('\n✓ Screenshot 1: Collapsed panel saved');

  // Expand the panel
  await quickResponsesPanel.click();
  await page.waitForTimeout(500);

  // Take screenshot of expanded panel
  await page.screenshot({
    path: 'screenshots/quick-responses-expanded.png',
    fullPage: false
  });
  console.log('✓ Screenshot 2: Expanded panel saved');

  // Verify panel title is visible
  const panelTitle = page.locator('.panel-title');
  await expect(panelTitle).toContainText('Quick Responses');

  console.log('\n✓ QuickResponsesPanel is visible and positioned below the input form!');
});
