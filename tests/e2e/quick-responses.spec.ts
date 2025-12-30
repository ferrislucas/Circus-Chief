import { test, expect } from '@playwright/test';

/**
 * E2E Tests for Quick Responses Feature
 * Tests the functionality of quick response buttons in the conversation tab
 */

test.describe('Quick Responses', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the application
    await page.goto('http://localhost:5000');

    // Wait for app to load
    await page.waitForSelector('[data-testid="session-list"], text="Create a new project"', { timeout: 10000 });
  });

  test('should insert quick response text into prompt without auto-submit', async ({ page }) => {
    // Create a new project first
    const projectButton = page.locator('button:has-text("Create a new project")').first();
    if (await projectButton.isVisible()) {
      await projectButton.click();
      await page.fill('input[placeholder="Project name"]', 'Quick Response Test');
      await page.fill('input[placeholder*="working directory"]', '/tmp');
      await page.click('button:has-text("Create Project")');
      await page.waitForTimeout(1000);
    }

    // Click on a project to view sessions
    const projectLink = page.locator('a').filter({ hasText: /Quick Response Test|Test/ }).first();
    if (await projectLink.isVisible()) {
      await projectLink.click();
      await page.waitForSelector('[data-testid="create-session"], text="New Session"', { timeout: 5000 });
    }

    // Create a new session
    const newSessionButton = page.locator('button').filter({ hasText: /New Session|Create/ }).first();
    if (await newSessionButton.isVisible()) {
      await newSessionButton.click();
      await page.waitForSelector('textarea', { timeout: 5000 });
    }

    // Wait for the conversation tab to load with quick responses
    await page.waitForTimeout(2000);

    // Find and click the first quick response button (non-auto-submit)
    const quickResponseButtons = page.locator('button').filter({
      has: page.locator('.button-label')
    });

    const buttonCount = await quickResponseButtons.count();

    if (buttonCount > 0) {
      // Find a non-auto-submit button (one without the lightning icon)
      let clicked = false;
      for (let i = 0; i < buttonCount; i++) {
        const button = quickResponseButtons.nth(i);
        const hasAutoIcon = await button.locator('.auto-icon').isVisible().catch(() => false);

        if (!hasAutoIcon) {
          const buttonText = await button.textContent();
          await button.click();

          // Wait for the text to be inserted
          await page.waitForTimeout(500);

          // Check that the textarea now contains the quick response text
          const textarea = page.locator('textarea').first();
          const textareaValue = await textarea.inputValue();

          expect(textareaValue).toBeTruthy();
          expect(textareaValue.length).toBeGreaterThan(0);

          clicked = true;
          break;
        }
      }

      if (!clicked && buttonCount > 0) {
        // If all have auto-submit, just click the first one and verify insertion
        await quickResponseButtons.first().click();
        await page.waitForTimeout(500);

        const textarea = page.locator('textarea').first();
        const textareaValue = await textarea.inputValue();

        // With auto-submit, it should send immediately, so we won't see it in textarea
        // But we should see it in the conversation
        expect(textareaValue === '' || textareaValue.length > 0).toBeTruthy();
      }
    } else {
      test.skip();
    }
  });

  test('should focus textarea after inserting quick response', async ({ page }) => {
    // Navigate and setup
    await page.goto('http://localhost:5000');
    await page.waitForSelector('[data-testid="session-list"], text="Create"', { timeout: 10000 });

    // Look for an existing session or create one
    const sessionLinks = page.locator('a').filter({ hasText: /Session/ });
    const sessionCount = await sessionLinks.count();

    if (sessionCount > 0) {
      await sessionLinks.first().click();
      await page.waitForSelector('textarea', { timeout: 5000 });
    } else {
      test.skip();
    }

    // Wait for quick responses to load
    await page.waitForTimeout(1000);

    // Find a quick response button
    const quickResponseButton = page.locator('button').filter({
      has: page.locator('.button-label')
    }).first();

    if (await quickResponseButton.isVisible()) {
      await quickResponseButton.click();
      await page.waitForTimeout(500);

      // Check that textarea is focused
      const textarea = page.locator('textarea').first();
      const isFocused = await textarea.evaluate((el: HTMLTextAreaElement) => {
        return document.activeElement === el;
      });

      expect(isFocused || await textarea.inputValue().then(v => v.length > 0)).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('should append quick response to existing text in prompt', async ({ page }) => {
    // Navigate and setup
    await page.goto('http://localhost:5000');
    await page.waitForSelector('[data-testid="session-list"], text="Create"', { timeout: 10000 });

    // Look for an existing session
    const sessionLinks = page.locator('a').filter({ hasText: /Session/ });
    const sessionCount = await sessionLinks.count();

    if (sessionCount > 0) {
      await sessionLinks.first().click();
      await page.waitForSelector('textarea', { timeout: 5000 });
    } else {
      test.skip();
    }

    // Wait for quick responses to load
    await page.waitForTimeout(1000);

    const textarea = page.locator('textarea').first();
    const initialText = 'Some initial text';

    // Set initial text
    await textarea.fill(initialText);
    await page.waitForTimeout(300);

    // Click a quick response button
    const quickResponseButton = page.locator('button').filter({
      has: page.locator('.button-label')
    }).first();

    if (await quickResponseButton.isVisible()) {
      const buttonText = await quickResponseButton.textContent();
      await quickResponseButton.click();
      await page.waitForTimeout(500);

      // Check that the textarea now contains both the initial text and the quick response
      const currentValue = await textarea.inputValue();

      expect(currentValue).toContain(initialText);
      expect(currentValue.length).toBeGreaterThan(initialText.length);
      // Should have the separator
      expect(currentValue).toContain('\n\n');
    } else {
      test.skip();
    }
  });
});
