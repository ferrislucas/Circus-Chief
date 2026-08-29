import { test, expect, type Page } from '@playwright/test';
import {
  cleanupAll,
  getProjects,
  seedProject,
  seedSession,
  seedChildSession,
  updateSessionStatus,
  seedCommandButton,
  runCommandButtonAndWait,
} from './helpers';

/**
 * Embedded session cards + status filter on the project list.
 *
 * These run against a real Express server, real SQLite DB, and real WebSocket
 * (started by pw.sh on an isolated port). Seeding and status changes go through
 * the real REST API; nothing is stubbed and no network is intercepted.
 *
 * Live-update assertions account for the composable's debounce (~1s) by
 * polling with generous timeouts — never a fixed wait shorter than the debounce.
 *
 * Note: the project list used to render a dedicated "workspace link" block
 * that only appeared for active (running/waiting) workspaces and showed a
 * "N sessions" count. That was replaced by embedding real SessionCard
 * previews (`.embedded-session-list .session-card`) of the project's most
 * recently active workspaces, regardless of status — see ProjectListView.vue
 * and its unit tests for the current contract. The tests below assert
 * against that embedded-card markup instead.
 */

const LIVE_TIMEOUT = 10_000;

function projectCard(page: Page, projectName: string) {
  return page.locator('.project-card').filter({ hasText: projectName });
}

function embeddedSessionCard(page: Page, projectName: string, sessionName: string) {
  return projectCard(page, projectName)
    .locator('.embedded-session-list .session-card')
    .filter({ hasText: sessionName });
}

async function showEmbeddedSessions(page: Page, projectName: string) {
  const toggle = projectCard(page, projectName).locator('.sessions-toggle');
  await expect(toggle).toBeVisible({ timeout: LIVE_TIMEOUT });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

function filterPill(page: Page, status: string) {
  return page.getByRole('button', { name: new RegExp(`^${status}`) });
}

/**
 * The `running` badge is a global running-session count; `waiting` and `idle`
 * badges are global project counts.
 * (playwright.config.ts: fullyParallel + workers: 4 — this spec file's own
 * tests are forced serial below, but 3 other workers are running unrelated
 * spec files against the same shared DB at the same time, and they create,
 * delete and re-status projects throughout). That makes *any* absolute badge
 * count unassertable — even a delta against a snapshot taken moments earlier,
 * because another worker can seed or finish a project in between.
 *
 * So badge counts are asserted through an invariant that holds within a
 * single render regardless of what the other workers are doing for the project
 * count badges: with a status filter applied, the pill's badge count equals
 * the number of project cards the list renders. The per-status semantics
 * — e.g. that a `waiting`-status session with no pending agent input is not a
 * "waiting" project — are asserted by which filters our own seeded project
 * appears under, which is unaffected by other workers' projects.
 */
async function expectPillCountMatchesFilteredList(page: Page, status: string) {
  if (status === 'running') {
    await expect
      .poll(
        async () => {
          const badge = await filterPill(page, status).locator('.filter-count').textContent();
          return Number(badge) === (await getStatusFacets()).running;
        },
        { timeout: LIVE_TIMEOUT }
      )
      .toBe(true);
    return;
  }

  await expect
    .poll(
      async () => {
        const badge = await filterPill(page, status).locator('.filter-count').textContent();
        const cards = await page.locator('.project-card').count();
        return Number(badge) === cards;
      },
      { timeout: LIVE_TIMEOUT }
    )
    .toBe(true);
}

/** Global status facets, derived from the API the same way the store does. */
async function getStatusFacets(): Promise<{ running: number; waiting: number; idle: number }> {
  const projects = await getProjects();
  let running = 0;
  let waiting = 0;
  let idle = 0;
  for (const p of projects) {
    const isRunning = (p.runningSessionCount ?? 0) > 0;
    const isWaiting = (p.waitingSessionCount ?? 0) > 0;
    running += p.runningSessionCount ?? 0;
    if (isWaiting) waiting += 1;
    if (!isRunning && !isWaiting) idle += 1;
  }
  return { running, waiting, idle };
}

test.describe('Project list embedded session cards', () => {
  // Force serial execution within this file: several tests below assert on
  // named projects that must not be touched by another test in *this* file
  // running concurrently (each beforeEach/afterEach calls cleanupAll()).
  // This does not, by itself, isolate the file from the other 3 parallel
  // workers running different spec files against the same DB — see
  // getStatusFacets() above for how the count-sensitive tests handle that.
  // Matches the same accommodation made in
  // built-in-provider-model-management.spec.ts and
  // commit-attribution-settings.spec.ts for file-local state reasons.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async () => {
    await cleanupAll();
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('shows embedded session cards with a running badge for active workspaces, and without one for inactive workspaces', async ({ page }) => {
    const project = await seedProject('rw-links', '/tmp');

    // alpha: root + two children, all running.
    const alpha = await seedSession(project.id, { prompt: 'alpha root', name: 'alpha', startImmediately: false });
    const alphaChild1 = await seedChildSession(project.id, alpha.id, { prompt: 'alpha c1', name: 'alpha-c1' });
    const alphaChild2 = await seedChildSession(project.id, alpha.id, { prompt: 'alpha c2', name: 'alpha-c2' });
    await updateSessionStatus(alpha.id, 'running');
    await updateSessionStatus(alphaChild1.id, 'running');
    await updateSessionStatus(alphaChild2.id, 'running');

    // beta: single running root.
    const beta = await seedSession(project.id, { prompt: 'beta root', name: 'beta', startImmediately: false });
    await updateSessionStatus(beta.id, 'running');

    // gamma: stopped. The unfiltered project list still embeds it (it shows
    // the project's most recently active workspaces regardless of status,
    // capped at 3 — all three fit here) but it must not carry a running badge.
    const gamma = await seedSession(project.id, { prompt: 'gamma root', name: 'gamma', startImmediately: false });
    await updateSessionStatus(gamma.id, 'stopped');

    await page.goto('/');

    // Four running sessions belong to this single project. The filter still
    // renders one project card, but its badge must report all four sessions.
    await expectPillCountMatchesFilteredList(page, 'running');
    await showEmbeddedSessions(page, project.name);

    const alphaCard = embeddedSessionCard(page, project.name, 'alpha');
    await expect(alphaCard).toBeVisible({ timeout: LIVE_TIMEOUT });
    await expect(alphaCard).toHaveAttribute('href', `/sessions/${alpha.id}`);
    await expect(alphaCard.locator('.status-badge.status-running')).toBeVisible();

    const betaCard = embeddedSessionCard(page, project.name, 'beta');
    await expect(betaCard).toBeVisible();
    await expect(betaCard).toHaveAttribute('href', `/sessions/${beta.id}`);
    await expect(betaCard.locator('.status-badge.status-running')).toBeVisible();

    const gammaCard = embeddedSessionCard(page, project.name, 'gamma');
    await expect(gammaCard).toBeVisible();
    await expect(gammaCard).toHaveAttribute('href', `/sessions/${gamma.id}`);
    await expect(gammaCard.locator('.status-badge.status-running')).toHaveCount(0);
  });

  test('embeds session cards for a project with only inactive sessions, none carrying a running badge', async ({ page }) => {
    const project = await seedProject('rw-inactive', '/tmp');
    const stopped = await seedSession(project.id, { prompt: 'stopped', name: 'stopped', startImmediately: false });
    await updateSessionStatus(stopped.id, 'stopped');
    // Note: 'completed' is a valid session status but is not settable via
    // PATCH /api/sessions/:id (the request contract only accepts
    // starting/running/waiting/error/stopped/scheduled) — sessions reach
    // 'completed' through the workflow-complete path, not a direct status
    // PATCH. Use 'error' as the second excluded status instead; combined
    // with 'stopped' above it still exercises two distinct inactive statuses.
    const errored = await seedSession(project.id, { prompt: 'errored', name: 'errored', startImmediately: false });
    await updateSessionStatus(errored.id, 'error');

    await page.goto('/');
    const card = projectCard(page, project.name);
    await expect(card).toBeVisible();

    await showEmbeddedSessions(page, project.name);

    // The existing "N sessions · …" line is intact.
    await expect(card.locator('.project-meta')).toContainText('2 sessions');

    // Both inactive workspaces still get an embedded preview card, just
    // without a running badge.
    await expect(card.locator('.embedded-session-list .session-card')).toHaveCount(2);
    await expect(card.locator('.embedded-session-list .status-badge.status-running')).toHaveCount(0);
  });

  test('shows visible Circus command run badges on embedded session cards', async ({ page }) => {
    const project = await seedProject('project-command-badges', '/tmp');
    const session = await seedSession(project.id, {
      prompt: 'command badge',
      name: 'command badge session',
      startImmediately: false,
    });
    const button = await seedCommandButton(project.id, {
      label: 'Project list command',
      command: 'echo project-list-badge',
      showOnList: true,
    });

    await runCommandButtonAndWait(session.id, button.id);
    await page.goto('/');
    await showEmbeddedSessions(page, project.name);

    const card = embeddedSessionCard(page, project.name, session.name);
    await expect(card).toBeVisible({ timeout: LIVE_TIMEOUT });
    await expect(card.locator('.button-status-indicator[title="Project list command"]'))
      .toBeVisible({ timeout: LIVE_TIMEOUT });
  });

  test('clicking an embedded session card navigates to the root session, never the session list', async ({ page }) => {
    const project = await seedProject('rw-click', '/tmp');
    const workspace = await seedSession(project.id, { prompt: 'click root', name: 'click-me', startImmediately: false });
    await updateSessionStatus(workspace.id, 'running');

    await page.goto('/');
    await showEmbeddedSessions(page, project.name);
    const link = embeddedSessionCard(page, project.name, 'click-me');
    await expect(link).toBeVisible();

    await link.click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${workspace.id}$`));
    // The card's session-list route was never visited.
    expect(page.url()).not.toContain(`/projects/${project.id}/sessions`);
  });

  test('updates the running badge live without a reload when the workspace leaves active state', async ({ page }) => {
    const project = await seedProject('rw-live-dec', '/tmp');
    const root = await seedSession(project.id, { prompt: 'root', name: 'live-root', startImmediately: false });
    const child1 = await seedChildSession(project.id, root.id, { prompt: 'c1', name: 'live-c1' });
    const child2 = await seedChildSession(project.id, root.id, { prompt: 'c2', name: 'live-c2' });
    await updateSessionStatus(root.id, 'running');
    await updateSessionStatus(child1.id, 'running');
    await updateSessionStatus(child2.id, 'running');

    await page.goto('/');
    await showEmbeddedSessions(page, project.name);
    const link = embeddedSessionCard(page, project.name, 'live-root');
    await expect(link.locator('.status-badge.status-running')).toBeVisible();

    // Every member session leaves active state; the running badge drops
    // without reloading. The card itself remains embedded (it's still one
    // of the project's most recently active workspaces).
    await updateSessionStatus(root.id, 'stopped');
    await updateSessionStatus(child1.id, 'stopped');
    await updateSessionStatus(child2.id, 'stopped');
    await expect(link.locator('.status-badge.status-running')).toHaveCount(0, { timeout: LIVE_TIMEOUT });
    await expect(link).toBeVisible();
  });

  test('adds an embedded session card live when a new workspace is created', async ({ page }) => {
    const project = await seedProject('rw-live-add', '/tmp');

    await page.goto('/');
    const card = projectCard(page, project.name);
    await expect(card).toBeVisible();
    await expect(card.locator('.embedded-session-list')).toHaveCount(0);

    const workspace = await seedSession(project.id, { prompt: 'new root', name: 'new-workspace', startImmediately: false });
    await updateSessionStatus(workspace.id, 'running');

    await showEmbeddedSessions(page, project.name);
    const link = embeddedSessionCard(page, project.name, 'new-workspace');
    await expect(link).toBeVisible({ timeout: LIVE_TIMEOUT });
    await expect(link).toHaveAttribute('href', `/sessions/${workspace.id}`);
    await expect(link.locator('.status-badge.status-running')).toBeVisible();
  });

  test('renders filter pills with correct badge counts and filters the list', async ({ page }) => {
    const runningProject = await seedProject('rw-filter-running', '/tmp');
    const waitingProject = await seedProject('rw-filter-waiting', '/tmp');
    const idleProject = await seedProject('rw-filter-idle', '/tmp');

    const running = await seedSession(runningProject.id, { prompt: 'running', name: 'running', startImmediately: false });
    await updateSessionStatus(running.id, 'running');

    const waiting = await seedSession(waitingProject.id, { prompt: 'waiting', name: 'waiting', startImmediately: false });
    await updateSessionStatus(waiting.id, 'waiting');

    // idleProject has no sessions at all → idle.

    await page.goto('/');

    // The running badge is a global session count; waiting and idle are global
    // project counts. Each pill is asserted against its matching invariant —
    // see expectPillCountMatchesFilteredList(). A status='waiting'
    // session is idle unless it has pending_agent_input, which is why
    // waitingProject shows up under `idle` below and never under `waiting`.
    await expect(filterPill(page, 'running')).toContainText('running');

    await filterPill(page, 'running').click();
    await expect(projectCard(page, runningProject.name)).toBeVisible();
    await expect(projectCard(page, waitingProject.name)).toHaveCount(0);
    await expect(projectCard(page, idleProject.name)).toHaveCount(0);
    await expectPillCountMatchesFilteredList(page, 'running');

    await filterPill(page, 'waiting').click();
    await expect(projectCard(page, waitingProject.name)).toHaveCount(0);
    await expect(projectCard(page, runningProject.name)).toHaveCount(0);
    await expectPillCountMatchesFilteredList(page, 'waiting');

    await filterPill(page, 'idle').click();
    await expect(projectCard(page, idleProject.name)).toBeVisible();
    await expect(projectCard(page, waitingProject.name)).toBeVisible();
    await expect(projectCard(page, runningProject.name)).toHaveCount(0);
    await expectPillCountMatchesFilteredList(page, 'idle');

    // Clicking the active pill clears the filter.
    await filterPill(page, 'idle').click();
    await expect(projectCard(page, runningProject.name)).toBeVisible();
    await expect(projectCard(page, waitingProject.name)).toBeVisible();
    await expect(projectCard(page, idleProject.name)).toBeVisible();
  });

  test('does not treat an idle waiting-status session as blocked on agent input', async ({ page }) => {
    const project = await seedProject('rw-overlap', '/tmp');
    const running = await seedSession(project.id, { prompt: 'running', name: 'running', startImmediately: false });
    const waiting = await seedSession(project.id, { prompt: 'waiting', name: 'waiting', startImmediately: false });
    await updateSessionStatus(running.id, 'running');
    await updateSessionStatus(waiting.id, 'waiting');

    await page.goto('/');

    // Only the running session makes this project active; status='waiting'
    // alone does not represent a pending agent prompt. Counts are global and
    // other workers move them constantly, so each pill is checked against its
    // matching invariant while the semantics are asserted by which filters
    // this project appears under.
    await filterPill(page, 'running').click();
    await expect(projectCard(page, project.name)).toBeVisible();
    await expectPillCountMatchesFilteredList(page, 'running');

    await filterPill(page, 'waiting').click();
    await expect(projectCard(page, project.name)).toHaveCount(0);
    await expectPillCountMatchesFilteredList(page, 'waiting');

    // Neither idle.
    await filterPill(page, 'idle').click();
    await expect(projectCard(page, project.name)).toHaveCount(0);
    await expectPillCountMatchesFilteredList(page, 'idle');
  });

  test('enters and leaves the filtered list live without a reload', async ({ page }) => {
    const runningProject = await seedProject('rw-enter-leave', '/tmp');
    const idleProject = await seedProject('rw-enter-leave-idle', '/tmp');

    const running = await seedSession(runningProject.id, { prompt: 'running', name: 'running', startImmediately: false });
    await updateSessionStatus(running.id, 'running');
    const idle = await seedSession(idleProject.id, { prompt: 'idle', name: 'idle', startImmediately: false });
    await updateSessionStatus(idle.id, 'stopped');

    await page.goto('/');
    await filterPill(page, 'running').click();
    await expect(projectCard(page, runningProject.name)).toBeVisible();
    await expect(projectCard(page, idleProject.name)).toHaveCount(0);

    // The visible project's last running session leaves → it drops out.
    await updateSessionStatus(running.id, 'stopped');
    await expect(projectCard(page, runningProject.name)).toHaveCount(0, { timeout: LIVE_TIMEOUT });

    // The hidden project gains a running session → it joins.
    await updateSessionStatus(idle.id, 'running');
    await expect(projectCard(page, idleProject.name)).toBeVisible({ timeout: LIVE_TIMEOUT });
  });

  test('shows the filtered-empty state, not the onboarding hero', async ({ page }) => {
    const idleProject = await seedProject('rw-filtered-empty', '/tmp');
    const stopped = await seedSession(idleProject.id, { prompt: 'stopped', name: 'stopped', startImmediately: false });
    await updateSessionStatus(stopped.id, 'stopped');

    // This assertion needs the *global* running filter to have zero matches.
    // Unlike the delta-based badge-count tests above, "empty" has no useful
    // delta to assert against — so if another parallel worker happens to
    // have a running project at this exact moment (plenty of unrelated spec
    // files legitimately hold one for the duration of their own
    // assertions), skip rather than fail on noise outside this feature.
    // The underlying wiring (filteredProjects → empty state, not onboarding)
    // is also covered deterministically by ProjectListView.test.js.
    const facets = await getStatusFacets();
    test.skip(facets.running > 0, 'another parallel worker currently has a running project');

    await page.goto('/');
    await filterPill(page, 'running').click();

    // idleProject is not running → "no projects match this filter".
    await expect(page.locator('.no-match')).toBeVisible();
    await expect(page.locator('.no-match-text')).toHaveText('No projects match this filter.');
    await expect(page.locator('.welcome-heading')).toHaveCount(0);
  });

  test('persists the selected filter across navigation', async ({ page }) => {
    const runningProject = await seedProject('rw-persist-running', '/tmp');
    const idleProject = await seedProject('rw-persist-idle', '/tmp');
    const running = await seedSession(runningProject.id, { prompt: 'running', name: 'running', startImmediately: false });
    await updateSessionStatus(running.id, 'running');

    await page.goto('/');
    await filterPill(page, 'running').click();
    await expect(projectCard(page, runningProject.name)).toBeVisible();
    await expect(projectCard(page, idleProject.name)).toHaveCount(0);

    // Navigate to a session list and back; the filter must survive. Click the
    // header specifically: the card body below it is the embedded session
    // preview list, whose cards link to individual sessions, so a click on the
    // card's geometric center would land there (or on inert padding between
    // previews) rather than on the session-list target.
    await projectCard(page, runningProject.name).locator('.project-card-header').click();
    await expect(page).toHaveURL(new RegExp(`/projects/${runningProject.id}/sessions`));
    await page.goto('/');

    await expect(filterPill(page, 'running')).toHaveClass(/active/);
    await expect(projectCard(page, runningProject.name)).toBeVisible();
    await expect(projectCard(page, idleProject.name)).toHaveCount(0);
  });

  test('applies the filter client-side without a refetch', async ({ page }) => {
    const runningProject = await seedProject('rw-instant-running', '/tmp');
    const idleProject = await seedProject('rw-instant-idle', '/tmp');
    const running = await seedSession(runningProject.id, { prompt: 'running', name: 'running', startImmediately: false });
    await updateSessionStatus(running.id, 'running');

    let projectListRequests = 0;
    page.on('request', (req) => {
      if (req.method() === 'GET' && new URL(req.url()).pathname === '/api/projects') {
        projectListRequests += 1;
      }
    });

    await page.goto('/');
    await expect(projectCard(page, runningProject.name)).toBeVisible();
    projectListRequests = 0; // reset after the initial load

    await filterPill(page, 'idle').click();
    await expect(projectCard(page, idleProject.name)).toBeVisible();
    await expect(projectCard(page, runningProject.name)).toHaveCount(0);

    await filterPill(page, 'running').click();
    await expect(projectCard(page, runningProject.name)).toBeVisible();

    expect(projectListRequests).toBe(0);
  });
});
