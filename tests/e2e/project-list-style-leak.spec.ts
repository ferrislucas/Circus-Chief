import { test, expect } from '@playwright/test';
import { cleanupAll, seedProject } from './helpers';

/*
 * Regression test for global CSS leaking out of SessionListView.css.
 *
 * SessionListView imports an unscoped stylesheet that contains a mobile
 * (max-width: 700px) `.page-header { flex-direction: column }` rule. Lazy
 * route chunks keep their <style> tags after navigating away, so after
 * visiting any session-list route the Projects page header restacked itself
 * (centered heading, Add Project button wrapped below) until a hard refresh.
 * The sheet is now scoped under the `.session-list-view` root class, and
 * ProjectListView explicitly declares `flex-direction: row`; this test keeps
 * both defenses intact.
 */
test.describe('Project list header layout', () => {
  // The leaked stacking rule only applied below 700px.
  test.use({ viewport: { width: 600, height: 900 } });

  test.beforeEach(async () => {
    await cleanupAll();
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('projects header stays left-aligned in a row after navigating from a session view', async ({ page }) => {
    const project = await seedProject('Header Layout', '/tmp');

    // Load a session-list route first so its lazily-imported CSS is injected.
    await page.goto(`/projects/${project.id}/sessions`);
    await expect(page.locator('.session-list-view')).toBeVisible();

    // Navigate back to the project list via the header logo. This is an SPA
    // navigation (no reload), which historically kept the leaked stylesheet
    // active on the projects page.
    await page.click('a.logo');
    await expect(page).toHaveURL('/');

    const header = page.locator('.page-header');
    await expect(header).toBeVisible();
    const headerBox = await header.boundingBox();

    const heading = page.locator('.page-header h1', { hasText: 'Projects' });
    await expect(heading).toBeVisible();
    const headingBox = await heading.boundingBox();

    const button = page.locator('.page-header .btn');
    await expect(button).toBeVisible();
    const buttonBox = await button.boundingBox();

    expect(headerBox).not.toBeNull();
    expect(headingBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();

    // Heading and Add Project button share a row (their vertical extents overlap).
    expect(headingBox!.y).toBeLessThan(buttonBox!.y + buttonBox!.height);
    expect(buttonBox!.y).toBeLessThan(headingBox!.y + headingBox!.height);

    // The button sits to the right of the heading, not below it.
    expect(buttonBox!.x).toBeGreaterThanOrEqual(headingBox!.x + headingBox!.width - 1);

    // The heading is left-aligned with the header, not centered by a stacked
    // column layout.
    expect(Math.abs(headingBox!.x - headerBox!.x)).toBeLessThan(4);
  });
});
