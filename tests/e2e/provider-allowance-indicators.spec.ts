import { test, expect } from '@playwright/test';
import {
  API_URL, cleanupCreatedResources, getProvider, seedProject, seedSession, waitForStatus,
} from './helpers';

const snapshots = [
  allowanceSnapshot('alpha', 'Alpha', 'available', 81, 1_799_999_000_100),
  allowanceSnapshot('bravo', 'Bravo', 'warning', 42, 1_799_999_000_300),
  allowanceSnapshot('charlie', 'Charlie', 'critical', 9, 1_799_999_000_200),
  allowanceSnapshot('delta', 'Delta', 'exhausted', 0, null),
];
const LIVE_SERVER_TESTS = new Set([
  'renders an adapter-observed OpenAI allowance update without source metadata',
  'renders a Claude rate-limit allowance update without source metadata',
  'orders the dialog most-recently-used and moves a provider to top without reload',
  'reclaims the top provider after same-status activity without reload',
]);

function allowanceSnapshot(providerId: string, providerName: string, status: string, percent: number, lastUsedAt: number | null) {
  return {
    providerId,
    providerName,
    providerKind: 'openai',
    status,
    allowances: [{
      key: 'requests', label: 'Requests', remaining: percent, limit: 100,
      remainingPercent: percent, unit: 'requests', resetsAt: 1_800_000_000_000,
    }],
    source: 'provider', updatedAt: 1_799_999_000_000, staleAt: 1_800_001_000_000,
    lastUsedAt,
    unavailableReason: null,
  };
}

test.describe('Provider allowance indicators', () => {
  // The live-server cases intentionally broadcast to every connected client.
  // Keep their static-fixture neighbors isolated from those real events.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }, testInfo) => {
    if (LIVE_SERVER_TESTS.has(testInfo.title)) return;
    // The REST contract is the full ProviderAllowanceListResponse envelope —
    // a bare snapshot array fails the client-side contract parse and would
    // strand the indicators in the fetch-error state.
    await page.route('**/api/providers/allowances', (route) => route.fulfill({
      json: { snapshots, activeProviderIds: [] },
    }));
  });

  test('renders one battery trigger summarizing the worst provider without credential leakage', async ({ page }) => {
    await page.goto('/');

    const indicators = page.getByTestId('provider-allowance-indicators');
    await expect(indicators).toBeVisible();
    const trigger = indicators.getByTestId('provider-allowance-trigger');
    await expect(trigger).toHaveCount(1);
    // Delta is exhausted at 0%: severity outranks every other snapshot.
    // (The label appends locale-formatted reset info, so match the stable prefix.)
    await expect(trigger).toHaveAccessibleName(/Provider usage: Exhausted, 0% remaining/);
    await expect(trigger.locator('.battery-icon')).toBeVisible();
    await expect(trigger.locator('.attention-badge')).toHaveText('3');
    await expect(indicators).not.toContainText('test-provider-secret');

    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Alpha');
    await expect(dialog).toContainText('81%');
    await expect(dialog).toContainText('Delta');
    await expect(dialog).not.toContainText('test-provider-secret');
  });

  test('lists providers most-recently-used first regardless of severity', async ({ page }) => {
    await page.goto('/');

    const indicators = page.getByTestId('provider-allowance-indicators');
    await indicators.getByTestId('provider-allowance-trigger').click();
    // Cassette recency is bravo > charlie > alpha > never-used delta, while
    // severity runs the opposite way — the dialog must follow recency.
    const names = await page.getByRole('dialog').locator('article.provider-detail header strong').allTextContents();
    expect(names).toEqual(['Bravo', 'Charlie', 'Alpha', 'Delta']);
    // The trigger still summarizes severity, not recency.
    await expect(indicators.getByTestId('provider-allowance-trigger'))
      .toHaveAccessibleName(/Provider usage: Exhausted, 0% remaining/);
  });

  test('renders the same battery trigger at every width without horizontal overflow', async ({ page }) => {
    for (const width of [1280, 768, 640, 375]) {
      await page.setViewportSize({ width, height: 720 });
      await page.goto('/');

      const indicators = page.getByTestId('provider-allowance-indicators');
      const trigger = indicators.getByTestId('provider-allowance-trigger');
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveAccessibleName(/Provider usage: Exhausted, 0% remaining/);
      expect(await page.locator('html').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
  });

  test('renders an adapter-observed OpenAI allowance update without source metadata', async ({ page }) => {
    const project = await seedProject('Allowance adapter E2E', process.cwd());
    const provider = await getProvider('openai-default');
    const receivedFrames: string[] = [];
    page.on('websocket', (socket) => socket.on('framereceived', (frame) => receivedFrames.push(frame.payload)));

    await page.goto('/');
    const session = await seedSession(project.id, {
      prompt: 'Return a brief allowance fixture response.',
      model: 'gpt-5.6-sol', providerId: provider.id, startImmediately: true,
    });
    await waitForStatus(session.id, 'waiting');

    await page.setViewportSize({ width: 375, height: 720 });

    // Wait for THIS provider's update: the trigger summarizes the worst
    // provider across every provider on the shared test server, so under a
    // fully parallel run a concurrent spec's session can own the worst slot
    // (and any provider's frame satisfies an unscoped poll). Scoping the
    // frame wait to our provider id keeps the assertions below deterministic.
    await expect.poll(() => receivedFrames.some((frame) =>
      frame.includes('provider:allowance_updated') && frame.includes(provider.id),
    )).toBe(true);

    const indicators = page.getByTestId('provider-allowance-indicators');
    // Presence only: the exact worst-provider value is nondeterministic
    // under parallel load. Worst-provider rendering is pinned by the
    // static-fixture tests above; the live behavior under test here is that
    // our provider's adapter-observed update renders without a reload and
    // without leaking source metadata.
    await expect(indicators.getByTestId('provider-allowance-trigger'))
      .toHaveAccessibleName(/Provider usage:/);
    await indicators.getByRole('button', { name: /Provider usage/ }).click();
    const detailTexts = await page.getByRole('dialog').locator('.provider-detail').allTextContents();
    expect(detailTexts.some((text) => text.includes(provider.name))).toBe(true);
    await expect(page.getByRole('dialog')).toContainText('75%');

    const response = await fetch(`${API_URL}/api/providers/allowances`);
    const responseText = await response.text();
    await expect(response.ok).toBe(true);
    expect(responseText).not.toContain('authorization');
    expect(responseText).not.toContain('req_sanitized');
    expect(receivedFrames.join('\n')).not.toContain('authorization');
    expect(receivedFrames.join('\n')).not.toContain('req_sanitized');
  });

  test('renders a Claude rate-limit allowance update without source metadata', async ({ page }) => {
    const project = await seedProject('Claude allowance adapter E2E', process.cwd());
    const provider = await getProvider('anthropic-default');
    const receivedFrames: string[] = [];
    page.on('websocket', (socket) => socket.on('framereceived', (frame) => receivedFrames.push(frame.payload)));

    await page.goto('/');
    // The E2E Claude fixture replaces the SDK query() boundary on the test
    // server, so this session streams a sanitized rate_limit_event through the
    // production adapter tap (57.5% remaining → 58% displayed).
    const session = await seedSession(project.id, {
      prompt: 'Return a brief Claude allowance fixture response.',
      model: 'claude-haiku-4-5-20251001', providerId: provider.id, startImmediately: true,
    });
    await waitForStatus(session.id, 'waiting');

    await page.setViewportSize({ width: 375, height: 720 });

    // Wait for THIS provider's update: the trigger summarizes the worst
    // provider across every provider on the shared test server, so under a
    // fully parallel run a concurrent spec's session can own the worst slot
    // (and any provider's frame satisfies an unscoped poll). Scoping the
    // frame wait to our provider id keeps the assertions below deterministic.
    await expect.poll(() => receivedFrames.some((frame) =>
      frame.includes('provider:allowance_updated') && frame.includes(provider.id),
    )).toBe(true);

    const indicators = page.getByTestId('provider-allowance-indicators');
    // Presence only: the exact worst-provider value is nondeterministic
    // under parallel load. Worst-provider rendering is pinned by the
    // static-fixture tests above; the live behavior under test here is that
    // our provider's adapter-observed update renders without a reload and
    // without leaking source metadata.
    await expect(indicators.getByTestId('provider-allowance-trigger'))
      .toHaveAccessibleName(/Provider usage:/);
    await indicators.getByRole('button', { name: /Provider usage/ }).click();
    const detailTexts = await page.getByRole('dialog').locator('.provider-detail').allTextContents();
    expect(detailTexts.some((text) => text.includes(provider.name))).toBe(true);
    await expect(page.getByRole('dialog')).toContainText('58%');

    // The raw SDK event identity fields and stream metadata never reach the
    // browser — only normalized allowance fields do (FR-8 / AC 20).
    const response = await fetch(`${API_URL}/api/providers/allowances`);
    const responseText = await response.text();
    await expect(response.ok).toBe(true);
    expect(responseText).not.toContain('redacted');
    expect(responseText).not.toContain('rate_limit_event');
    expect(receivedFrames.join('\n')).not.toContain('redacted');
    expect(receivedFrames.join('\n')).not.toContain('rate_limit_event');
  });

  test('orders the dialog most-recently-used and moves a provider to top without reload', async ({ page }) => {
    const project = await seedProject('Allowance recency E2E', process.cwd());
    const openai = await getProvider('openai-default');
    const anthropic = await getProvider('anthropic-default');

    // Each seed below must reconcile through a live WebSocket dispatch: a
    // seed whose creation frame arrives before the page subscribes leaves the
    // dialog stale and the recency poll below would time out. Counting
    // allowance REST fetches proves each seed's frames were dispatched to the
    // page before moving on (same guard as the reconcile test below).
    const allowanceFetches: string[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/api/providers/allowances')) allowanceFetches.push(response.url());
    });

    await page.goto('/');
    const indicators = page.getByTestId('provider-allowance-indicators');
    await expect(indicators).toBeVisible();
    const fetchesAfterSettling = allowanceFetches.length;

    // Seeding a session counts as use (MAX(sessions.updated_at)). Runs stay
    // off (startImmediately: false): a running agent would complete turns
    // and bump updated_at asynchronously, making recency nondeterministic.
    await seedSession(project.id, { prompt: 'Recency probe on the first provider.', providerId: openai.id, startImmediately: false });
    await expect.poll(() => allowanceFetches.length).toBeGreaterThan(fetchesAfterSettling);

    await indicators.getByRole('button', { name: /Provider usage/ }).click();
    const dialog = page.getByRole('dialog');
    const headerNames = () => dialog.locator('article.provider-detail header strong').allTextContents();
    await expect.poll(async () => (await headerNames()).indexOf(openai.name)).toBeGreaterThanOrEqual(0);
    const fetchesAfterFirst = allowanceFetches.length;

    await seedSession(project.id, { prompt: 'Recency probe on the second provider.', providerId: anthropic.id, startImmediately: false });
    await expect.poll(() => allowanceFetches.length).toBeGreaterThan(fetchesAfterFirst);
    await expect.poll(async () => {
      const names = await headerNames();
      return names.indexOf(anthropic.name) >= 0 && names.indexOf(anthropic.name) < names.indexOf(openai.name);
    }).toBe(true);
    const fetchesAfterSecond = allowanceFetches.length;

    // New work on the older provider moves it back to top without a reload.
    await seedSession(project.id, { prompt: 'Recency probe returns to the first provider.', providerId: openai.id, startImmediately: false });
    await expect.poll(() => allowanceFetches.length).toBeGreaterThan(fetchesAfterSecond);
    await expect.poll(async () => {
      const names = await headerNames();
      return names.indexOf(openai.name) >= 0 && names.indexOf(openai.name) < names.indexOf(anthropic.name);
    }).toBe(true);
  });

  test('reclaims the top provider after same-status activity without reload', async ({ page }) => {
    const project = await seedProject('Allowance recency reconcile E2E', process.cwd());
    const openai = await getProvider('openai-default');
    const anthropic = await getProvider('anthropic-default');

    // Each seed below must reconcile through a live WebSocket dispatch: a
    // seed whose creation frame arrives before the page subscribes leaves no
    // session-priority memo entry, and a later same-status update would then
    // refetch for the wrong reason (unknown session) instead of through the
    // recency gate under test. Counting allowance REST fetches proves each
    // seed's frames were dispatched to the page before moving on.
    const allowanceFetches: string[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/api/providers/allowances')) allowanceFetches.push(response.url());
    });

    await page.goto('/');
    const indicators = page.getByTestId('provider-allowance-indicators');
    await expect(indicators).toBeVisible();
    await indicators.getByRole('button', { name: /Provider usage/ }).click();
    const dialog = page.getByRole('dialog');
    const headerNames = () => dialog.locator('article.provider-detail header strong').allTextContents();
    const fetchesAfterSettling = allowanceFetches.length;

    const sessionA = await seedSession(project.id, { prompt: 'Recency reconcile probe on the first provider.', providerId: openai.id, startImmediately: false });
    await expect.poll(() => allowanceFetches.length).toBeGreaterThan(fetchesAfterSettling);
    await expect.poll(async () => (await headerNames()).indexOf(openai.name)).toBeGreaterThanOrEqual(0);
    const fetchesAfterA = allowanceFetches.length;

    // A later-created session on the second provider displaces the first.
    await seedSession(project.id, { prompt: 'Recency reconcile probe on the second provider.', providerId: anthropic.id, startImmediately: false });
    await expect.poll(() => allowanceFetches.length).toBeGreaterThan(fetchesAfterA);
    await expect.poll(async () => {
      const names = await headerNames();
      return names.indexOf(anthropic.name) >= 0 && names.indexOf(anthropic.name) < names.indexOf(openai.name);
    }).toBe(true);

    // Same-status activity on the first provider (a field edit bumps
    // updated_at exactly like a turn's usage write, with no status
    // transition) moves it back on top without a reload.
    const rename = await fetch(`${API_URL}/api/sessions/${sessionA.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Recency reconcile probe on the first provider (renamed)' }),
    });
    await expect(rename.ok).toBe(true);
    await expect.poll(async () => {
      const names = await headerNames();
      return names.indexOf(openai.name) >= 0 && names.indexOf(openai.name) < names.indexOf(anthropic.name);
    }).toBe(true);
  });

  test('supports complete keyboard dialog operation and restores the single opener at every width', async ({ page }) => {
    for (const width of [768, 375]) {
      await page.setViewportSize({ width, height: 720 });
      await page.goto('/');

      const opener = page.getByTestId('provider-allowance-trigger');
      await opener.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(dialog.getByRole('button', { name: 'Close provider usage' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(dialog).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(opener).toBeFocused();
    }
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

});
