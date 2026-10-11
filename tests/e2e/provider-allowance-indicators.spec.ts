import { test, expect } from '@playwright/test';
import {
  API_URL, cleanupCreatedResources, getProvider, seedProject, seedSession, waitForStatus,
} from './helpers';

const snapshots = [
  allowanceSnapshot('alpha', 'Alpha', 'available', 81),
  allowanceSnapshot('bravo', 'Bravo', 'warning', 42),
  allowanceSnapshot('charlie', 'Charlie', 'critical', 9),
  allowanceSnapshot('delta', 'Delta', 'exhausted', 0),
];
const LIVE_SERVER_TESTS = new Set([
  'renders an adapter-observed OpenAI allowance update without source metadata',
  'renders a Claude rate-limit allowance update without source metadata',
]);

function allowanceSnapshot(providerId: string, providerName: string, status: string, percent: number) {
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
      model: 'gpt-5.4', providerId: provider.id, startImmediately: true,
    });
    await waitForStatus(session.id, 'waiting');

    await page.setViewportSize({ width: 375, height: 720 });

    const indicators = page.getByTestId('provider-allowance-indicators');
    await expect(indicators.getByTestId('provider-allowance-trigger')).toHaveAccessibleName(/75%/);
    await expect.poll(() => receivedFrames.some((frame) => frame.includes('provider:allowance_updated'))).toBe(true);
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

    const indicators = page.getByTestId('provider-allowance-indicators');
    await expect(indicators.getByTestId('provider-allowance-trigger')).toHaveAccessibleName(/58%/);
    await expect.poll(() => receivedFrames.some((frame) => frame.includes('provider:allowance_updated'))).toBe(true);
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
