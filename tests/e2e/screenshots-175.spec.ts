/**
 * Screenshot capture for Issue #175: Token Usage Per Conversation
 *
 * This test file captures screenshots demonstrating the new conversation-level
 * token usage feature and posts them to the session canvas.
 *
 * Run with: ./scripts/pw.sh test tests/e2e/screenshots-175.spec.ts
 */
import { test, expect } from '@playwright/test';
import { join } from 'path';

// Session in the worktree's database with token usage data
const EXISTING_SESSION_ID = '1bfc83eb-4ca2-4322-b0f8-a8656eec9bda';
const CANVAS_SESSION_ID = 'b8ed79d9-5f87-4b6b-9920-fb419ad1cf07';
// Our worktree frontend runs on port 5173, backend on 5001
// Screenshots are posted to the MAIN server's canvas (port 5000)
const WORKTREE_FRONTEND_URL = 'http://localhost:5173';
const MAIN_API_URL = 'http://localhost:5000';

async function postScreenshotToCanvas(filePath: string, label: string, filename: string) {
  console.log(`Posting screenshot to canvas: ${filename}`);
  const response = await fetch(`${MAIN_API_URL}/api/sessions/${CANVAS_SESSION_ID}/canvas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'image',
      filePath,
      filename,
      label,
    }),
  });
  if (!response.ok) {
    console.error('Failed to post screenshot to canvas:', await response.text());
  } else {
    console.log(`Successfully posted ${filename} to canvas`);
  }
  return response.ok;
}

test.describe('Issue #175 Screenshots', () => {
  // Skip these tests in normal runs - they use hardcoded session IDs
  // and URLs that only work in specific worktree environments
  test.skip(
    !process.env.SCREENSHOT_MODE,
    'Screenshots only run with SCREENSHOT_MODE=1'
  );

  // Use longer timeout since we're taking multiple screenshots
  test.setTimeout(60000);

  test('1. Compact Token Usage Panel', async ({ page }) => {
    await page.goto(`${WORKTREE_FRONTEND_URL}/sessions/${EXISTING_SESSION_ID}/conversation`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Take screenshot of the conversation tab header area (includes ConversationSelector + TokenUsagePanel)
    const conversationTab = page.locator('.conversation-tab');
    await expect(conversationTab).toBeVisible();

    // Screenshot the top portion showing ConversationSelector and TokenUsagePanel
    const screenshotPath = 'screenshots/175-01-compact-token-panel.png';
    await page.screenshot({
      path: screenshotPath,
      clip: await (async () => {
        const box = await conversationTab.boundingBox();
        if (!box) throw new Error('Could not get bounding box');
        return { x: box.x, y: box.y, width: box.width, height: Math.min(250, box.height) };
      })(),
    });

    await postScreenshotToCanvas(
      join(process.cwd(), screenshotPath),
      '175: Compact Token Usage Panel - Shows total tokens + context bar always visible',
      '175-01-compact-token-panel.png'
    );
  });

  test('2. Expanded Token Usage Details', async ({ page }) => {
    await page.goto(`${WORKTREE_FRONTEND_URL}/sessions/${EXISTING_SESSION_ID}/conversation`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Click expand button if present
    const expandButton = page.locator('.toggle-details');
    const hasExpandButton = await expandButton.count() > 0;

    if (hasExpandButton) {
      await expandButton.click();
      await page.waitForTimeout(500);
    }

    // Screenshot the token usage panel with details expanded
    const tokenPanel = page.locator('.token-usage-panel');
    await expect(tokenPanel).toBeVisible();

    const screenshotPath = 'screenshots/175-02-expanded-details.png';
    await tokenPanel.screenshot({ path: screenshotPath });

    await postScreenshotToCanvas(
      join(process.cwd(), screenshotPath),
      '175: Expanded Token Details - Input/Output/Cache breakdown',
      '175-02-expanded-details.png'
    );
  });

  test('3. Conversation Selector Dropdown with Tokens', async ({ page }) => {
    await page.goto(`${WORKTREE_FRONTEND_URL}/sessions/${EXISTING_SESSION_ID}/conversation`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Click the conversation dropdown to open it
    const dropdownTrigger = page.locator('.dropdown-trigger');
    await expect(dropdownTrigger).toBeVisible();
    await dropdownTrigger.click();
    await page.waitForTimeout(500);

    // Screenshot the dropdown showing token counts - capture a larger area
    const conversationSelector = page.locator('.conversation-selector');
    const screenshotPath = 'screenshots/175-03-conversation-dropdown.png';
    await conversationSelector.screenshot({ path: screenshotPath });

    await postScreenshotToCanvas(
      join(process.cwd(), screenshotPath),
      '175: Conversation Dropdown - Shows token count per conversation',
      '175-03-conversation-dropdown.png'
    );
  });

  test('4. Full Conversation Tab Layout', async ({ page }) => {
    await page.goto(`${WORKTREE_FRONTEND_URL}/sessions/${EXISTING_SESSION_ID}/conversation`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Take a full screenshot of the conversation tab
    const screenshotPath = 'screenshots/175-04-full-conversation-tab.png';
    await page.screenshot({
      path: screenshotPath,
      fullPage: false,
    });

    await postScreenshotToCanvas(
      join(process.cwd(), screenshotPath),
      '175: Full Conversation Tab - ConversationSelector + TokenUsagePanel + Messages',
      '175-04-full-conversation-tab.png'
    );
  });

  test('5. Session Header (Token Panel Removed)', async ({ page }) => {
    await page.goto(`${WORKTREE_FRONTEND_URL}/sessions/${EXISTING_SESSION_ID}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Screenshot the session header to show TokenUsagePanel is NOT there
    const sessionHeader = page.locator('.session-header');
    await expect(sessionHeader).toBeVisible();

    const screenshotPath = 'screenshots/175-05-session-header.png';
    await sessionHeader.screenshot({ path: screenshotPath });

    await postScreenshotToCanvas(
      join(process.cwd(), screenshotPath),
      '175: Session Header - Token panel moved to conversation level',
      '175-05-session-header.png'
    );
  });
});
