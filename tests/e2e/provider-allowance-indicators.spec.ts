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
    await expect(indicators).toContainText('75%');
    await expect.poll(() => receivedFrames.some((frame) => frame.includes('provider_allowance_updated'))).toBe(true);
    await indicators.getByRole('button', { name: 'Show provider usage' }).click();
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
