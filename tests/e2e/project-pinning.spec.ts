import { test, expect } from '@playwright/test';
import { API_URL, cleanupAll, getProject, seedProject } from './helpers';

async function setPinned(id: string, pinned: boolean) {
  const response = await fetch(`${API_URL}/api/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinned }),
  });
  expect(response.ok).toBe(true);
}

function projectCard(page: import('@playwright/test').Page, name: string) {
  return page.locator('.project-card').filter({ hasText: name });
}

test.describe('Project pinning', () => {
  // Both scenarios deliberately exercise global project facets and use the
  // shared cleanup helper, so running them concurrently can delete each
  // other's fixtures midway through an assertion.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async () => cleanupAll());
  test.afterEach(async () => cleanupAll());

  test('pins and unpins a project with accessible state and API persistence', async ({ page }) => {
    const project = await seedProject('pin target', '/tmp');
    await page.goto('/');

    const card = projectCard(page, project.name);
    const pin = card.getByRole('button', { name: `Pin ${project.name}` });
    await expect(pin).toHaveAttribute('aria-pressed', 'false');
    await pin.click();
    await expect(card.getByRole('button', { name: `Unpin ${project.name}` })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => getProject(project.id)).toMatchObject({ pinned: true });

    await card.getByRole('button', { name: `Unpin ${project.name}` }).press('Enter');
    await expect.poll(() => getProject(project.id)).toMatchObject({ pinned: false });
  });

  test('pinned-only takes precedence over a simultaneously active status filter', async ({ page }) => {
    const pinned = await seedProject('pinned project', '/tmp');
    const unpinned = await seedProject('unpinned project', '/tmp');
    await setPinned(pinned.id, true);
    await page.goto('/');

    await page.getByRole('button', { name: /Pinned projects \(1\)/ }).click();
    // Other spec files can contribute projects to these global facets while
    // the full suite runs in parallel, so the idle count is not fixture-local.
    await page.getByRole('button', { name: /idle \(\d+\)/ }).click();
    await expect(projectCard(page, pinned.name)).toBeVisible();
    await expect(projectCard(page, unpinned.name)).toHaveCount(0);
  });
});
