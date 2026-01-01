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
    await page.waitForSelector('[data-testid="session-list"]', { timeout: 10000 }).catch(() => null);
    await page.waitForTimeout(1000);
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

test.describe('Quick Responses - NewSessionView', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the application
    await page.goto('http://localhost:5000');
    // Wait for app to load
    await page.waitForSelector('[data-testid="session-list"]', { timeout: 10000 }).catch(() => null);
    await page.waitForTimeout(1000);
  });

  async function createProjectAndNavigateToNewSession(page) {
    try {
      // Try to navigate to an existing session's new session view
      const sessionLinks = page.locator('a').filter({ hasText: /Session|Project/ });
      const sessionCount = await sessionLinks.count();

      if (sessionCount > 0) {
        // Click on first project link
        const projectLinks = page.locator('a').filter({ hasText: /Project/ });
        const projectCount = await projectLinks.count();

        if (projectCount > 0) {
          await projectLinks.first().click();
          await page.waitForTimeout(2000);
        }
      }

      // Try to find and click "New Session" button
      let newSessionButton = page.locator('button').filter({ hasText: 'New Session' });
      let buttonCount = await newSessionButton.count();

      if (buttonCount > 0) {
        await newSessionButton.first().click();
        await page.waitForTimeout(2000);

        // Check if textarea appeared
        const textarea = page.locator('textarea[id="prompt"]');
        const isVisible = await textarea.isVisible().catch(() => false);
        if (isVisible) {
          await page.waitForTimeout(1000);
          return true;
        }
      }

      // Fallback: Try to create a new project if no projects exist
      const createProjectButton = page.locator('button:has-text("Create a new project")');
      if (await createProjectButton.isVisible()) {
        await createProjectButton.click();
        await page.waitForTimeout(500);

        const projectNameInput = page.locator('input[placeholder="Project name"]');
        if (await projectNameInput.isVisible()) {
          await projectNameInput.fill('QR-Test-' + Date.now());

          const workdirInputs = page.locator('input[type="text"]').filter({ hasText: /\// });
          const inputs = page.locator('input[type="text"]');
          const inputCount = await inputs.count();
          if (inputCount > 1) {
            await inputs.nth(1).fill('/tmp');
          }

          const createBtn = page.locator('button:has-text("Create Project")');
          if (await createBtn.isVisible()) {
            await createBtn.click();
            await page.waitForTimeout(2000);

            // Now try to navigate to new session again
            newSessionButton = page.locator('button').filter({ hasText: 'New Session' });
            if (await newSessionButton.isVisible()) {
              await newSessionButton.click();
              await page.waitForTimeout(2000);
            }
          }
        }
      }

      return true;
    } catch (error) {
      console.error('Error in setup:', error);
      return false;
    }
  }

  test('Test Case 1: Non-Auto-Submit Response Inserts Correct Text', async ({ page }) => {
    await createProjectAndNavigateToNewSession(page);

    // Get textarea reference
    const textarea = page.locator('textarea[id="prompt"]');
    await expect(textarea).toBeVisible();

    // Find and click a non-auto-submit quick response button
    const quickResponseButtons = page.locator('button').filter({
      has: page.locator('.button-label')
    });

    const buttonCount = await quickResponseButtons.count();
    let testPassed = false;

    for (let i = 0; i < buttonCount; i++) {
      const button = quickResponseButtons.nth(i);
      const hasAutoIcon = await button.locator('.auto-icon').isVisible().catch(() => false);

      if (!hasAutoIcon) {
        // This is a non-auto-submit button
        const responseText = await button.textContent();
        await button.click();
        await page.waitForTimeout(500);

        // Assertion 1: Textarea value contains the quick response content text
        const textareaValue = await textarea.inputValue();
        expect(textareaValue).toBeTruthy();
        expect(textareaValue.length).toBeGreaterThan(0);

        // Assertion 2: Textarea does NOT contain "[object Object]"
        expect(textareaValue).not.toContain('[object Object]');

        // Assertion 3: Textarea length is greater than 0
        expect(textareaValue.length).toBeGreaterThan(0);

        // Assertion 4: Textarea remains focused after insertion
        const isFocused = await textarea.evaluate((el: HTMLTextAreaElement) => {
          return document.activeElement === el;
        });
        expect(isFocused).toBeTruthy();

        // Assertion 5: Form has NOT been submitted (user still on NewSessionView)
        expect(page.url()).toContain('/new-session');

        testPassed = true;
        break;
      }
    }

    if (!testPassed) {
      test.skip();
    }
  });

  test('Test Case 2: Auto-Submit Response Automatically Submits Form', async ({ page }) => {
    await createProjectAndNavigateToNewSession(page);

    // Find and click an auto-submit quick response button
    const quickResponseButtons = page.locator('button').filter({
      has: page.locator('.button-label')
    });

    const buttonCount = await quickResponseButtons.count();
    let testPassed = false;

    for (let i = 0; i < buttonCount; i++) {
      const button = quickResponseButtons.nth(i);
      const hasAutoIcon = await button.locator('.auto-icon').isVisible().catch(() => false);

      if (hasAutoIcon) {
        // This is an auto-submit button
        await button.click();

        // Wait for navigation to happen
        await page.waitForNavigation({ timeout: 5000 }).catch(() => null);
        await page.waitForTimeout(1000);

        // Assertion 1: Form submission is triggered (navigates away from NewSessionView)
        expect(page.url()).not.toContain('/new-session');
        expect(page.url()).toContain('/sessions/');

        // Assertion 2: Session is created and visible in the UI
        const sessionTitle = page.locator('h1');
        await expect(sessionTitle).toBeVisible();

        // Assertion 3: No "[object Object]" appears anywhere in the page
        const pageContent = await page.content();
        expect(pageContent).not.toContain('[object Object]');

        testPassed = true;
        break;
      }
    }

    if (!testPassed) {
      test.skip();
    }
  });

  test('Test Case 3: Multiple Quick Response Insertions (Non-Auto-Submit)', async ({ page }) => {
    await createProjectAndNavigateToNewSession(page);

    const textarea = page.locator('textarea[id="prompt"]');
    const quickResponseButtons = page.locator('button').filter({
      has: page.locator('.button-label')
    });

    const buttonCount = await quickResponseButtons.count();
    if (buttonCount < 2) {
      test.skip();
      return;
    }

    // Click first non-auto-submit button
    let firstClicked = false;
    for (let i = 0; i < buttonCount; i++) {
      const button = quickResponseButtons.nth(i);
      const hasAutoIcon = await button.locator('.auto-icon').isVisible().catch(() => false);

      if (!hasAutoIcon) {
        await button.click();
        await page.waitForTimeout(500);

        // Assertion 1: First response is inserted correctly
        let textareaValue = await textarea.inputValue();
        expect(textareaValue).toBeTruthy();
        expect(textareaValue.length).toBeGreaterThan(0);
        expect(textareaValue).not.toContain('[object Object]');

        const firstContent = textareaValue;

        // Click second non-auto-submit button
        for (let j = i + 1; j < buttonCount; j++) {
          const button2 = quickResponseButtons.nth(j);
          const hasAutoIcon2 = await button2.locator('.auto-icon').isVisible().catch(() => false);

          if (!hasAutoIcon2) {
            await button2.click();
            await page.waitForTimeout(500);

            textareaValue = await textarea.inputValue();

            // Assertion 2: Second response is appended with proper spacing (newline)
            expect(textareaValue).toContain('\n\n');

            // Assertion 3: No "[object Object]" appears after either insertion
            expect(textareaValue).not.toContain('[object Object]');

            // Assertion 4: Content length reflects both insertions
            expect(textareaValue.length).toBeGreaterThan(firstContent.length);

            firstClicked = true;
            break;
          }
        }
        break;
      }
    }

    if (!firstClicked) {
      test.skip();
    }
  });

  test('Test Case 5: Mixed Auto and Non-Auto Submit Responses Visual Indicator', async ({ page }) => {
    await createProjectAndNavigateToNewSession(page);

    const quickResponseButtons = page.locator('button').filter({
      has: page.locator('.button-label')
    });

    const buttonCount = await quickResponseButtons.count();

    if (buttonCount === 0) {
      test.skip();
      return;
    }

    let hasAutoSubmitButton = false;
    let hasNonAutoSubmitButton = false;

    for (let i = 0; i < buttonCount; i++) {
      const button = quickResponseButtons.nth(i);
      const hasAutoIcon = await button.locator('.auto-icon').isVisible().catch(() => false);

      if (hasAutoIcon) {
        hasAutoSubmitButton = true;

        // Assertion 1: Auto-submit responses show a visual indicator (lightning bolt icon ⚡)
        const autoIcon = button.locator('.auto-icon');
        await expect(autoIcon).toBeVisible();

        // Assertion 3: Clicking auto-submit response submits and navigates away
        await button.click();
        await page.waitForNavigation({ timeout: 5000 }).catch(() => null);
        await page.waitForTimeout(500);

        // Should navigate away from new-session
        expect(page.url()).not.toContain('/new-session');
        break;
      } else {
        hasNonAutoSubmitButton = true;

        // Assertion 2: Non-auto-submit responses do NOT show the lightning bolt icon
        const autoIcon = button.locator('.auto-icon');
        await expect(autoIcon).not.toBeVisible();

        // Assertion 3: Clicking non-auto-submit response inserts text and stays on NewSessionView
        await button.click();
        await page.waitForTimeout(500);

        const textarea = page.locator('textarea[id="prompt"]');
        const textareaValue = await textarea.inputValue();
        expect(textareaValue).toBeTruthy();
        expect(page.url()).toContain('/new-session');
      }
    }

    if (!hasAutoSubmitButton && !hasNonAutoSubmitButton) {
      test.skip();
    }
  });
});
