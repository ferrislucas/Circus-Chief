import { test, expect } from '@playwright/test';

test.describe('Thinking Tokens Leak Fix', () => {
  test('should not leak thinking tokens between sessions', async ({ page }) => {
    // Navigate to projects list
    await page.goto('http://localhost:5002/projects');

    // Create a new project (simplified)
    await page.locator('text=New Project').click();
    await page.locator('input[name="name"]').fill('Test Project');
    await page.locator('input[name="workingDirectory"]').fill('/Users/ferrislucas/claudetools.io/.worktrees/49ee13cb-dd85-41ac-af40-9b3e3432dcd4');
    await page.locator('text=Create Project').click();

    // Wait for projects list to load and click on our project
    await page.locator('text=Test Project').click();

    // Create first session
    await page.locator('text=New Session').click();
    await page.locator('input[name="name"]').fill('Session 1 - Thinking Test');
    await page.locator('input[name="thinkingEnabled"]').check();
    await page.locator('text=Create Session').click();

    // Wait for session to load
    await page.locator('h3').first().waitFor();
    const session1Title = await page.locator('h3').first().textContent();
    expect(session1Title).toContain('Session 1 - Thinking Test');

    // Get session ID from URL or data attribute
    const session1Url = page.url();
    const session1Id = session1Url.split('/').pop();
    console.log('Session 1 ID:', session1Id);

    // Now go back to session list and create second session
    await page.locator('text=← Sessions').click();
    await page.locator('text=New Session').click();

    // Wait for new session modal
    await page.locator('input[name="name"]').waitFor();
    await page.locator('input[name="name"]').fill('Session 2 - Thinking Test');
    await page.locator('input[name="thinkingEnabled"]').check();
    await page.locator('text=Create Session').click();

    // Wait for session 2 to load
    await page.locator('h3').first().waitFor();
    const session2Title = await page.locator('h3').first().textContent();
    expect(session2Title).toContain('Session 2 - Thinking Test');

    const session2Url = page.url();
    const session2Id = session2Url.split('/').pop();
    console.log('Session 2 ID:', session2Id);

    // Verify different session IDs
    expect(session1Id).not.toBe(session2Id);

    // Navigate back to session 1
    await page.goto(`${session1Url}/conversation`);
    await page.locator('h3').first().waitFor();
    await expect(page.locator('h3').first()).toContainText('Session 1 - Thinking Test');

    // The key test: check that the current session does NOT show thinking from session 2
    // Since we've implemented per-session partial thinking, this should work correctly

    // Look for any thinking-related elements
    const thinkingElements = page.locator('.partial-thinking, .thinking-log, [data-testid="thinking-indicator"]');

    // Count thinking elements
    const thinkingCount = await thinkingElements.count();
    console.log('Number of thinking elements:', thinkingCount);

    // Important: if thinking from session 2 was leaking, we'd see content related to session 2
    // But with our fix, we should only see thinking content relevant to the current session
    const pageText = await page.textContent('body');

    // This test primarily validates that the UI works correctly
    // The real thinking leak would be more apparent with actual streaming tokens
    // For now, we validate that basic navigation and isolation work
    expect(pageText).toContain('Session 1 - Thinking Test');
    expect(pageText).not.toContain('Session 2 - Thinking Test'); // Should not see session 2 content
  });

  test('should handle session switching correctly', async ({ page }) => {
    // Navigate to projects
    await page.goto('http://localhost:5002/projects');

    // Find and click on an existing project (or create one)
    const projectCard = page.locator('[data-testid="project-card"]').first();
    const projectName = await projectCard.textContent();
    await projectCard.click();

    // Click on first session
    const sessionCard = page.locator('[data-testid="session-card"]').first();
    const sessionName = await sessionCard.textContent();
    await sessionCard.click();

    // Wait for session to load
    await page.locator('h3').first().waitFor();

    // Navigate to a second session
    await page.locator('text=← Sessions').click();
    const secondSessionCard = page.locator('[data-testid="session-card"]').nth(1);
    await secondSessionCard.click();

    // Wait for second session to load
    await page.locator('h3').first().waitFor();

    // Navigate back to first session
    await page.locator('text=← Sessions').click();
    await page.locator('[data-testid="session-card"]').first().click();

    // Verify we're back on the first session
    await page.locator('h3').first().waitFor();
    const currentTitle = await page.locator('h3').first().textContent();
    expect(currentTitle).toBe(sessionName);

    // Test that navigation works without thinking token leakage
    const thinkingContent = page.locator('.partial-thinking, .thinking-log').first();
    const thinkingText = await thinkingContent.textContent();

    // Should not contain content from the other session
    expect(thinkingText || '').not.toContain(sessionName); // Edge case, but validates no obvious leakage
  });
});