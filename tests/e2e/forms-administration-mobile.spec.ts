import { test, expect } from '@playwright/test';
import {
  cleanupCreatedResources,
  navigateAndWait,
  seedCommandButton,
  seedProject,
  seedProjectTemplate,
} from './helpers';

const IPHONE_12_MINI = { width: 375, height: 812 };

async function expectNoDocumentOverflow(page: import('@playwright/test').Page) {
  const metrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
}

async function expectPrimaryTouchAction(page: import('@playwright/test').Page, selector: string) {
  const action = page.locator(selector);
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeInViewport();
  const box = await action.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
}

test.describe('Forms and administration — iPhone 12 mini audit', () => {
  let project: any;
  let template: any;
  let command: any;

  test.beforeEach(async ({ page }) => {
    project = await seedProject('Visual audit project with a deliberately long administrative name '.repeat(3), process.cwd());
    template = await seedProjectTemplate(project.id, {
      name: 'A deliberately long template name for the narrow editor audit',
      prompt: 'Keep this long prompt readable and make every action reachable at a compact phone viewport.',
    });
    command = await seedCommandButton(project.id, {
      label: 'A deliberately long Circus Command label for the narrow editor audit',
      command: 'node -e "console.log(\'administration form audit\')"',
    });
    await page.setViewportSize(IPHONE_12_MINI);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('keeps project and editor forms contained with phone-safe actions', async ({ page }) => {
    await navigateAndWait(page, '/projects/new', { waitFor: 'form.form', timeout: 15000 });
    await expectNoDocumentOverflow(page);
    await expectPrimaryTouchAction(page, '.form-actions .btn-primary');
    expect(await page.locator('.form-actions').evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
    await page.screenshot({ path: 'test-results/visual-audit/project-new-375x812.png', fullPage: true });

    await navigateAndWait(page, `/projects/${project.id}/edit`, { waitFor: 'form.form', timeout: 15000 });
    await expectNoDocumentOverflow(page);
    await expectPrimaryTouchAction(page, '.form-actions .btn-primary');
    expect(await page.locator('.form-actions').evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
    await page.screenshot({ path: 'test-results/visual-audit/project-edit-375x812.png', fullPage: true });

    await navigateAndWait(page, `/projects/${project.id}/templates/${template.id}`, { waitFor: '.template-form', timeout: 15000 });
    await expectNoDocumentOverflow(page);
    await expectPrimaryTouchAction(page, '.template-form .btn-primary');
    await page.screenshot({ path: 'test-results/visual-audit/template-editor-375x812.png', fullPage: true });

    await navigateAndWait(page, `/projects/${project.id}/circus-commands/${command.id}`, { waitFor: '.command-button-form', timeout: 15000 });
    await expectNoDocumentOverflow(page);
    await expectPrimaryTouchAction(page, '.command-button-form .btn-primary');
    await page.screenshot({ path: 'test-results/visual-audit/circus-command-editor-375x812.png', fullPage: true });
  });

  test('keeps administrative settings, provider modal, and log table reachable', async ({ page }) => {
    await navigateAndWait(page, '/settings/providers', { waitFor: '.page-header .btn-primary', timeout: 15000 });
    await expectNoDocumentOverflow(page);
    await expectPrimaryTouchAction(page, '.page-header .btn-primary');
    await page.getByRole('button', { name: /add provider/i }).click();
    await expect(page.locator('.modal')).toBeVisible();
    await expectPrimaryTouchAction(page, '.modal-footer .btn-primary');
    await page.screenshot({ path: 'test-results/visual-audit/providers-modal-375x812.png', fullPage: true });
    await page.getByRole('button', { name: 'Cancel' }).click();

    await navigateAndWait(page, '/settings/summary', { waitFor: 'form.form', timeout: 15000 });
    await expectNoDocumentOverflow(page);
    await expectPrimaryTouchAction(page, '.form-actions .btn-primary');
    await page.screenshot({ path: 'test-results/visual-audit/summary-settings-375x812.png', fullPage: true });

    await navigateAndWait(page, '/settings/general', { waitFor: 'form.form', timeout: 15000 });
    await expectNoDocumentOverflow(page);
    await expectPrimaryTouchAction(page, '.form-actions .btn-primary');
    await page.screenshot({ path: 'test-results/visual-audit/general-settings-375x812.png', fullPage: true });

    await navigateAndWait(page, '/settings/logs', { waitFor: '.table-wrapper', timeout: 15000 });
    await expectNoDocumentOverflow(page);
    const filters = page.locator('.filter-input, .filter-select');
    for (const filter of await filters.all()) {
      expect((await filter.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator('.table-wrapper')).toHaveCSS('overflow-x', 'auto');
    await page.screenshot({ path: 'test-results/visual-audit/agent-logs-375x812.png', fullPage: true });
  });
});
