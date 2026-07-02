import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedChildSession,
  cleanupCreatedResources,
  navigateAndWait,
  openSessionOverlay,
  waitForSessionToExist,
} from './helpers';

test.describe('Session Tree Picker Shows All Children', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let parentSession: any;
  let children: any[] = [];

  test.beforeEach(async () => {
    children = [];
    project = await seedProject('Picker All Children Test', '/tmp/picker-all-children-test');
    parentSession = await seedSession(project.id, {
      prompt: 'Parent session prompt',
      name: 'Parent Session',
    });
    await waitForSessionToExist(parentSession.id);

    // Create 4 child sessions under the same parent
    for (let i = 1; i <= 4; i++) {
      const child = await seedChildSession(project.id, parentSession.id, {
        prompt: `Child ${i} prompt`,
        name: `Child Session ${i}`,
      });
      await waitForSessionToExist(child.id);
      children.push(child);
    }
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  async function openOverlayAndPicker(page: Page, sessionId: string) {
    await navigateAndWait(page, `/sessions/${sessionId}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });
    const overlay = await openSessionOverlay(page);

    // Open the picker dropdown
    const dropdown = overlay.locator('[data-testid="session-tree-dropdown"]');
    await expect(dropdown).toBeVisible({ timeout: 10000 });
    await dropdown.locator('.dropdown-trigger').click();
    const picker = page.locator('[data-testid="session-chat-picker"]');
    await expect(picker).toBeVisible({ timeout: 5000 });

    return { overlay, picker };
  }

  async function expectItemsToBeHitTestVisible(page: Page, picker: Locator) {
    const visibility = await picker.locator('.picker-item').evaluateAll((items) => {
      return items.map((item, index) => {
        const rect = item.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const topElement = document.elementFromPoint(x, y);
        const isHitTestVisible = Boolean(topElement && item.contains(topElement));

        return {
          index,
          name: item.querySelector('.picker-item-name')?.textContent?.trim() || '',
          isHitTestVisible,
          topClass: topElement instanceof HTMLElement ? topElement.className : '',
          center: { x, y },
          rect: {
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
          },
        };
      });
    });

    expect(visibility.filter(item => !item.isHitTestVisible)).toEqual([]);

    const headerOverflow = await page.locator('.overlay-header').evaluate((header) => {
      return window.getComputedStyle(header).overflow;
    });
    expect(headerOverflow).toBe('visible');
  }

  test('picker shows all 4 child sessions plus parent (5 total)', async ({ page }) => {
    const { picker } = await openOverlayAndPicker(page, parentSession.id);

    const items = picker.locator('.picker-item');
    // Should show parent + 4 children = 5 items
    await expect(items).toHaveCount(5, { timeout: 10000 });
  });

  test('picker displays all child session names', async ({ page }) => {
    const { picker } = await openOverlayAndPicker(page, parentSession.id);

    await expect(picker).toContainText('Parent Session');
    await expect(picker).toContainText('Child Session 1');
    await expect(picker).toContainText('Child Session 2');
    await expect(picker).toContainText('Child Session 3');
    await expect(picker).toContainText('Child Session 4');
  });

  test('picker items are visually available and not clipped by overlay header', async ({ page }) => {
    const { picker } = await openOverlayAndPicker(page, parentSession.id);

    const items = picker.locator('.picker-item');
    await expect(items).toHaveCount(5, { timeout: 10000 });

    await expectItemsToBeHitTestVisible(page, picker);
  });

  test('picker items have uniform padding (flat layout)', async ({ page }) => {
    const { picker } = await openOverlayAndPicker(page, parentSession.id);

    const items = picker.locator('.picker-item');
    const count = await items.count();
    expect(count).toBe(5);

    // All items should have the same padding (flat layout, no indentation)
    const firstPadding = await items.nth(0).evaluate(el => {
      return parseFloat(window.getComputedStyle(el).paddingLeft);
    });

    for (let i = 1; i < count; i++) {
      const itemPadding = await items.nth(i).evaluate(el => {
        return parseFloat(window.getComputedStyle(el).paddingLeft);
      });
      expect(itemPadding).toBe(firstPadding);
    }
  });

  test('sessions are listed in reverse chronological order (most recent first)', async ({ page }) => {
    const { picker } = await openOverlayAndPicker(page, parentSession.id);

    const items = picker.locator('.picker-item');
    const count = await items.count();
    expect(count).toBe(5);

    // Sessions should be sorted by most recent activity first.
    // Child sessions were created after the parent, so they should appear before the parent.
    // The last item in the list should be the parent (oldest).
    const lastItemName = await items.nth(count - 1).locator('.picker-item-name').textContent();
    expect(lastItemName?.trim()).toBe('Parent Session');
  });

  test('selecting a sibling session switches the overlay conversation', async ({ page }) => {
    const { overlay, picker } = await openOverlayAndPicker(page, parentSession.id);

    const items = picker.locator('.picker-item');
    const count = await items.count();
    expect(count).toBe(5);

    // Find which index has Child Session 4
    let child4Index = -1;
    for (let i = 0; i < count; i++) {
      const itemName = await items.nth(i).locator('.picker-item-name').textContent();
      if (itemName?.trim() === 'Child Session 4') {
        child4Index = i;
        break;
      }
    }
    expect(child4Index).not.toBe(-1); // Child Session 4 should exist

    // Click the Child Session 4 item
    await items.nth(child4Index).click();

    // Picker should close
    await expect(picker).not.toBeVisible({ timeout: 5000 });

    // The dropdown should now show the selected child session name.
    const dropdownName = overlay.locator('.dropdown-name');
    await expect(dropdownName).toContainText('Child Session 4', { timeout: 5000 });
  });

  test('opening picker from a child session still shows all siblings', async ({ page }) => {
    // Navigate to child session 2 instead of the parent
    const { picker } = await openOverlayAndPicker(page, children[1].id);

    // Should still show all sessions in the tree (parent + 4 children)
    const items = picker.locator('.picker-item');
    await expect(items).toHaveCount(5, { timeout: 10000 });

    await expect(picker).toContainText('Parent Session');
    await expect(picker).toContainText('Child Session 1');
    await expect(picker).toContainText('Child Session 2');
    await expect(picker).toContainText('Child Session 3');
    await expect(picker).toContainText('Child Session 4');
  });
});
