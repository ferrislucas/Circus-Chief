import { test, expect } from '@playwright/test';

const snapshots = [
  allowanceSnapshot('alpha', 'Alpha', 'available', 81),
  allowanceSnapshot('bravo', 'Bravo', 'warning', 42),
  allowanceSnapshot('charlie', 'Charlie', 'critical', 9),
  allowanceSnapshot('delta', 'Delta', 'exhausted', 0),
];

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
  test.beforeEach(async ({ page }) => {
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
    await expect(items).toHaveCount(3);
    await expect(indicators.getByTestId('provider-allowance-overflow')).toHaveText('+1');

  });

});
