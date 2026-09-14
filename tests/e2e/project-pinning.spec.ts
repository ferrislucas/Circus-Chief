import { test, expect } from '@playwright/test';
import { API_URL, cleanupAll, getProject, seedProject, seedSession, updateSessionStatus } from './helpers';

async function setPinned(id: string, pinned: boolean) {
  const response = await fetch(`${API_URL}/api/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinned }),
  });
  expect(response.ok).toBe(true);
}

function projectCard(page: import('@playwright/test').Page, name: string) {
  return page.locator('.project-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
}

async function makeProjectWithStatus(name: string, status: 'running' | 'waiting' | 'idle') {
  const project = await seedProject(name, '/tmp');
  if (status !== 'idle') {
    const session = await seedSession(project.id, { prompt: `status fixture: ${status}` });
    await updateSessionStatus(session.id, status);
  }
  return project;
}

function cardNames(page: import('@playwright/test').Page) {
  return page.locator('.project-card .project-name').allTextContents();
}

async function deferPinPut(page: import('@playwright/test').Page, projectId: string) {
  let release: (response: { status?: number; body?: unknown }) => void;
  let requestSeen: () => void;
  const response = new Promise<{ status?: number; body?: unknown }>((resolve) => { release = resolve; });
  const request = new Promise<void>((resolve) => { requestSeen = resolve; });
  await page.route(`**/api/projects/${projectId}`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    requestSeen!();
    const result = await response;
    await route.fulfill({
      status: result.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(result.body ?? { id: projectId, pinned: true }),
    });
  });
  return { release: release!, request };
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

  test('pinned visibility overrides every status filter while unpinned cards obey it', async ({ page }) => {
    const rows = [
      { id: 'pinned-idle', name: 'pinned idle', pinned: true, runningSessionCount: 0, waitingSessionCount: 0 },
      { id: 'running', name: 'unpinned running', pinned: false, runningSessionCount: 1, waitingSessionCount: 0 },
      { id: 'waiting', name: 'unpinned waiting', pinned: false, runningSessionCount: 0, waitingSessionCount: 1 },
      { id: 'idle', name: 'unpinned idle', pinned: false, runningSessionCount: 0, waitingSessionCount: 0 },
    ].map((project) => ({ ...project, workingDirectory: '/tmp', workspaceCount: 0, sessionCount: 0 }));
    await page.route('**/api/projects', (route) => route.request().method() === 'GET'
      ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(rows) })
      : route.continue());
    await page.goto('/');

    for (const [status, expected] of [
      ['running', ['pinned idle', 'unpinned running']],
      ['waiting', ['pinned idle', 'unpinned waiting']],
      ['idle', ['pinned idle', 'unpinned idle']],
    ] as const) {
      await page.getByRole('button', { name: new RegExp(`${status} \\(\\d+\\)`) }).click();
      await expect(projectCard(page, 'pinned idle')).toBeVisible();
      await expect(cardNames(page)).resolves.toEqual(expect.arrayContaining(expected));
      for (const excluded of ['unpinned running', 'unpinned waiting', 'unpinned idle'].filter((name) => !expected.includes(name))) {
        await expect(projectCard(page, excluded)).toHaveCount(0);
      }
    }
  });

  test('pinned-only is status-independent, preserves order, and persists with durable pins', async ({ page }) => {
    const first = await makeProjectWithStatus('first pinned idle', 'idle');
    const middle = await makeProjectWithStatus('middle unpinned running', 'running');
    const last = await makeProjectWithStatus('last pinned waiting', 'waiting');
    await setPinned(first.id, true);
    await setPinned(last.id, true);
    await page.goto('/');

    await expect(projectCard(page, first.name)).toBeVisible();
    await expect(projectCard(page, middle.name)).toBeVisible();
    await expect(projectCard(page, last.name)).toBeVisible();
    const initialOrder = await cardNames(page);
    const pinnedOrder = initialOrder.filter((name) => [first.name, last.name].includes(name));
    await page.getByRole('button', { name: /Pinned projects \(2\)/ }).click();
    const filter = page.getByRole('button', { name: /Pinned projects \(2\)/ });
    await expect(filter).toHaveAttribute('aria-pressed', 'true');
    await expect(cardNames(page)).resolves.toEqual(pinnedOrder);
    for (const status of ['running', 'waiting', 'idle']) {
      await page.getByRole('button', { name: new RegExp(`${status} \\(\\d+\\)`) }).click();
      await expect(cardNames(page)).resolves.toEqual(pinnedOrder);
    }
    await page.reload();
    await expect(filter).toHaveAttribute('aria-pressed', 'true');
    await expect(cardNames(page)).resolves.toEqual(pinnedOrder);
    await expect.poll(() => getProject(first.id)).toMatchObject({ pinned: true });
    await expect.poll(() => getProject(last.id)).toMatchObject({ pinned: true });

    await page.getByRole('button', { name: /idle \(\d+\)/ }).click();
    await filter.click();
    await expect(cardNames(page)).resolves.toEqual(initialOrder);
    await expect(projectCard(page, middle.name)).toBeVisible();
  });

  test('updates icon, count, and pinned-only membership optimistically and suppresses only duplicate input', async ({ page }) => {
    const target = await seedProject('optimistic target', '/tmp');
    const other = await seedProject('independent target', '/tmp');
    await page.goto('/');
    const targetPut = await deferPinPut(page, target.id);
    const otherPut = await deferPinPut(page, other.id);

    const targetPin = projectCard(page, target.name).getByRole('button', { name: `Pin ${target.name}` });
    const targetClick = targetPin.click({ noWaitAfter: true });
    await targetPut.request;
    await expect(targetPin).toBeDisabled();
    await expect(targetPin).toHaveAttribute('aria-busy', 'true');
    await expect(projectCard(page, target.name).getByRole('button', { name: `Unpin ${target.name}` })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /Pinned projects \(1\)/ })).toBeVisible();
    await page.getByRole('button', { name: /Pinned projects \(1\)/ }).click();
    await expect(projectCard(page, target.name)).toBeVisible();
    await expect(projectCard(page, other.name)).toHaveCount(0);

    // A disabled second click cannot issue another request; another card is still independently usable.
    await expect(projectCard(page, other.name)).toHaveCount(0);
    await page.getByRole('button', { name: /Pinned projects \(1\)/ }).click();
    const otherPin = projectCard(page, other.name).getByRole('button', { name: `Pin ${other.name}` });
    const otherClick = otherPin.click({ noWaitAfter: true });
    await otherPut.request;
    await expect(otherPin).toBeDisabled();
    targetPut.release({ body: { id: target.id, pinned: true } });
    otherPut.release({ body: { id: other.id, pinned: true } });
    await targetClick;
    await otherClick;
    await expect(targetPin).not.toBeDisabled();
    await expect(otherPin).not.toBeDisabled();
  });

  test('failed optimistic pin rolls back count and membership, retains refreshed card data, and shows a toast', async ({ page }) => {
    const project = await seedProject('rollback target', '/tmp');
    await page.goto('/');
    const deferred = await deferPinPut(page, project.id);
    const pin = projectCard(page, project.name).getByRole('button', { name: `Pin ${project.name}` });
    const click = pin.click({ noWaitAfter: true });
    await deferred.request;
    await page.getByRole('button', { name: /Pinned projects \(1\)/ }).click();
    await expect(projectCard(page, project.name)).toBeVisible();

    // A silent list refresh while the mutation is pending must not be erased by rollback.
    await page.evaluate(async () => fetch('/api/projects'));
    deferred.release({ status: 500, body: { error: 'Pin persistence failed' } });
    await click;
    await expect(projectCard(page, project.name)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Pinned projects \(0\)/ })).toBeVisible();
    await expect(page.locator('.toast-message')).toContainText('Pin persistence failed');
    await page.getByRole('button', { name: /Pinned projects \(0\)/ }).click();
    await expect(projectCard(page, project.name).getByRole('button', { name: `Pin ${project.name}` })).toHaveAttribute('aria-pressed', 'false');
  });

  test('pin controls isolate card navigation and remain keyboard-accessible at responsive breakpoints', async ({ page }) => {
    const project = await seedProject('interactive card', '/tmp');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const card = projectCard(page, project.name);
    const pin = card.getByRole('button', { name: `Pin ${project.name}` });
    await pin.focus();
    await expect(pin).toBeFocused();
    await pin.press('Enter');
    await expect(card.getByRole('button', { name: `Unpin ${project.name}` })).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/\/$/);
    await card.locator('.project-card-header').click();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/sessions$`));
  });
});
