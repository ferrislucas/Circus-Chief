import { test, expect } from '@playwright/test';
import { API_URL, cleanupCreatedResources, createProvider } from './helpers';

const snapshots = [
  allowanceSnapshot('alpha', 'Alpha', 'available', 81),
  allowanceSnapshot('bravo', 'Bravo', 'warning', 42),
  allowanceSnapshot('charlie', 'Charlie', 'critical', 9),
  allowanceSnapshot('delta', 'Delta', 'exhausted', 0),
];
const LIVE_SERVER_TESTS = new Set([
  'normalizes live updates, reorders attention states, and never leaks source secrets',
  'reconciles the server snapshot after reconnect and renders unknown and stale states honestly',
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
    await page.route('**/api/providers/allowances', (route) => route.fulfill({ json: snapshots }));
  });

  test('renders independent provider values without credential leakage', async ({ page }) => {
    await page.goto('/');

    const indicators = page.getByTestId('provider-allowance-indicators');
    await expect(indicators).toBeVisible();
    await expect(indicators.getByTestId('provider-allowance-item')).toHaveCount(4);
    await expect(indicators).toContainText('Alpha');
    await expect(indicators).toContainText('81%');
    await expect(indicators).toContainText('Delta');
    await expect(indicators).not.toContainText('test-provider-secret');
  });

  test('keeps complete items behind overflow', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 720 });
    await page.goto('/');

    const indicators = page.getByTestId('provider-allowance-indicators');
    const items = indicators.getByTestId('provider-allowance-item');
    await expect(items).toHaveCount(2);
    await expect(indicators.getByTestId('provider-allowance-overflow')).toHaveText('+2');
    expect(await page.locator('html').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  });

  test('uses the compact mobile badge without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto('/');

    const indicators = page.getByTestId('provider-allowance-indicators');
    await expect(indicators).toBeVisible();
    await expect(indicators.getByTestId('provider-allowance-item')).toHaveCount(0);
    await expect(indicators.locator('.mobile-button')).toBeVisible();
    await expect(indicators.locator('.attention-badge')).toHaveText('3');
    expect(await page.locator('html').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });

  test('normalizes live updates, reorders attention states, and never leaks source secrets', async ({ page }) => {
    const alpha = await createProvider({ name: 'Allowance Alpha', kind: 'openai' });
    const bravo = await createProvider({ name: 'Allowance Bravo', kind: 'openai' });
    const receivedFrames: string[] = [];
    page.on('websocket', (socket) => socket.on('framereceived', (frame) => receivedFrames.push(frame.payload)));

    await observeAllowance({
      ...allowanceSnapshot(alpha.id, alpha.name, 'available', 80),
      credentials: { token: 'provider-source-secret-sentinel' },
      allowances: [{
        ...allowanceSnapshot(alpha.id, alpha.name, 'available', 80).allowances[0],
        upstreamMetadata: 'provider-source-secret-sentinel',
      }],
    });
    await observeAllowance(allowanceSnapshot(bravo.id, bravo.name, 'available', 75));
    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto('/');

    const indicators = page.getByTestId('provider-allowance-indicators');
    await observeAllowance(allowanceSnapshot(bravo.id, bravo.name, 'exhausted', 0));
    await expect.poll(() => receivedFrames.some((frame) => frame.includes('provider:allowance_updated'))).toBe(true);
    await indicators.getByRole('button', { name: 'Show provider usage' }).click();
    const detailTexts = await page.getByRole('dialog').locator('.provider-detail').allTextContents();
    expect(detailTexts.findIndex((text) => text.includes(bravo.name))).toBeLessThan(detailTexts.findIndex((text) => text.includes(alpha.name)));
    await expect(page.getByRole('dialog')).toContainText('0%');

    const response = await fetch(`${API_URL}/api/providers/allowances`);
    const responseText = await response.text();
    await expect(response.ok).toBe(true);
    expect(responseText).not.toContain('provider-source-secret-sentinel');
    expect(receivedFrames.join('\n')).not.toContain('provider-source-secret-sentinel');
    await expect(page.getByRole('dialog')).not.toContainText('provider-source-secret-sentinel');
    expect(await page.locator('html').innerHTML()).not.toContain('provider-source-secret-sentinel');
  });

  test('reconciles the server snapshot after reconnect and renders unknown and stale states honestly', async ({ page }) => {
    const provider = await createProvider({ name: 'Allowance Reconnect', kind: 'openai' });
    await observeAllowance(allowanceSnapshot(provider.id, provider.name, 'warning', 40));
    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto('/');

    const indicators = page.getByTestId('provider-allowance-indicators');
    await expect(indicators).toContainText('40%');
    await page.context().setOffline(true);
    await observeAllowance({
      ...allowanceSnapshot(provider.id, provider.name, 'available', 99),
      allowances: [],
      status: 'unknown',
      source: null,
      unavailableReason: 'The provider did not supply verified usage.',
    });
    await page.context().setOffline(false);
    await page.reload();
    await expect(indicators).toContainText('—');
    await page.getByRole('button', { name: 'Show provider usage' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Unknown');
    await expect(dialog).toContainText('The provider did not supply verified usage.');
    await page.keyboard.press('Escape');

    await observeAllowance({ ...allowanceSnapshot(provider.id, provider.name, 'warning', 40), staleAt: Date.now() - 1 });
    await page.reload();
    await page.getByRole('button', { name: 'Show provider usage' }).click();
    await expect(dialog).toContainText('Stale');
    await expect(dialog).toContainText('Last value may be out of date.');
  });

  test('supports complete keyboard dialog operation and restores the exact opener on desktop and mobile', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 720 });
    await page.goto('/');

    const desktopOpener = page.getByTestId('provider-allowance-item').first();
    await desktopOpener.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Close provider usage' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(desktopOpener).toBeFocused();

    await page.setViewportSize({ width: 375, height: 720 });
    const mobileOpener = page.getByRole('button', { name: 'Show provider usage' });
    await mobileOpener.click();
    await expect(dialog).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(mobileOpener).toBeFocused();
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

});

async function observeAllowance(snapshot: Record<string, unknown>) {
  const response = await fetch(`${API_URL}/api/providers/allowances/test-observe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshot }),
  });
  expect(response.status).toBe(204);
}
