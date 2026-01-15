import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  updateSessionStatus,
  navigateAndWait,
  cleanupCreatedResources,
  sendSessionMessage,
  getSession,
} from './helpers';

// Helper to parse token count from display text like "1,234" or "1.2K"
function parseTokenCount(text: string | null): number {
  if (!text) return 0;
  text = text.trim();

  // Handle K suffix (e.g., "1.2K" -> 1200)
  if (text.endsWith('K')) {
    return Math.round(parseFloat(text.slice(0, -1)) * 1000);
  }

  // Handle M suffix (e.g., "1.5M" -> 1500000)
  if (text.endsWith('M')) {
    return Math.round(parseFloat(text.slice(0, -1)) * 1000000);
  }

  // Handle dash (no tokens yet)
  if (text === '-' || text === '--') {
    return 0;
  }

  // Remove commas and parse (e.g., "1,234" -> 1234)
  return parseInt(text.replace(/,/g, ''), 10) || 0;
}

test.describe('Token Count Real-Time Updates', () => {
  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('token count should update in real-time when submitting a prompt', async ({ page }) => {
    // Capture browser console logs
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      // Only capture our debug logs
      if (text.includes('[Store]') || text.includes('[WS Client]')) {
        consoleLogs.push(text);
        console.log('Browser:', text);
      }
    });

    // 1. Setup: Create project and session
    const project = await seedProject('Token Test', '/tmp');
    const session = await seedSession(project.id, {
      prompt: 'Say hello briefly',
      name: 'Token Count Test Session',
    });

    console.log(`Created session: ${session.id}`);

    // 2. Wait for session to be ready (give it time to start)
    await new Promise((r) => setTimeout(r, 2000));

    // 3. Navigate to session detail page
    const sessionDetailUrl = `/sessions/${session.id}/conversation`;
    console.log(`Navigating to: ${sessionDetailUrl}`);
    await navigateAndWait(page, sessionDetailUrl);
    console.log(`Current URL: ${page.url()}`);

    // 4. Wait for the token panel and conversation tab to fully load
    await page.waitForTimeout(2000); // Give the page time to fully load

    // Debug: Check what's actually on the page
    const pageTitle = await page.title();
    console.log(`Page title: ${pageTitle}`);
    const mainContent = await page.locator('body').textContent({ timeout: 1000 });
    if (mainContent) {
      console.log(`Page content preview (first 500 chars): ${mainContent.substring(0, 500)}`);
    }

    // Check for any error messages or toasts
    const toastMessages = await page.locator('[role="alert"]').count();
    console.log(`Toast/alert messages found: ${toastMessages}`);
    if (toastMessages > 0) {
      const toastText = await page.locator('[role="alert"]').first().textContent();
      console.log(`Toast message: ${toastText}`);
    }

    // Debug: Check if the page is loading properly
    const sessionHeader = await page.locator('.session-header').count();
    console.log(`Session header found: ${sessionHeader}`);
    const messagesContainer = await page.locator('.messages').count();
    console.log(`Messages container found: ${messagesContainer}`);
    const tabs = await page.locator('.tabs').count();
    console.log(`Tabs container found: ${tabs}`);
    const loadingState = await page.locator('.loading-state').count();
    console.log(`Loading state found: ${loadingState}`);

    // Get initial state from API
    let sessionState = await getSession(session.id);
    const initialInputTokens = sessionState.inputTokens || 0;
    const initialOutputTokens = sessionState.outputTokens || 0;
    const initialApiTokens = initialInputTokens + initialOutputTokens;
    console.log(`Initial API tokens - Input: ${initialInputTokens}, Output: ${initialOutputTokens}, Total: ${initialApiTokens}`);

    // Check if token panel element exists
    const tokenPanelCount = await page.locator('.token-usage-panel').count();
    console.log(`Token usage panels found on page: ${tokenPanelCount}`);

    // Get the total-label span which shows the token count
    // The TokenUsagePanel uses this structure: <span class="total-label">{{ formattedTokens.total }}</span>
    let tokenLabelText = '';
    if (tokenPanelCount > 0) {
      try {
        tokenLabelText = await page.locator('.token-usage-panel .total-label').first().textContent({ timeout: 3000 });
      } catch (e) {
        console.log(`Failed to get initial token label: ${e}`);
        // Try to get the text content of the entire panel to debug
        try {
          const panelText = await page.locator('.token-usage-panel').first().textContent({ timeout: 3000 });
          console.log(`Token panel text content: "${panelText}"`);
        } catch (e2) {
          console.log(`Failed to get panel text: ${e2}`);
        }
      }
    } else {
      console.log('Token panel not found - checking for conversation tab...');
      const conversationTabCount = await page.locator('.conversation-tab').count();
      console.log(`Conversation tabs found: ${conversationTabCount}`);
      // Check if any elements with "token" in the class exist
      const tokenElements = await page.locator('[class*="token"]').count();
      console.log(`Elements with "token" in class: ${tokenElements}`);
    }
    console.log(`Initial token label: ${tokenLabelText || '[not found]'}`);

    // 5. Update session to waiting status so we can send a message
    await updateSessionStatus(session.id, 'waiting');
    await page.waitForTimeout(500);

    // 6. Submit a follow-up message via API
    console.log('Sending follow-up message...');
    try {
      await sendSessionMessage(session.id, 'What is 2 + 2? Answer briefly.');
    } catch (e) {
      console.log(`Message send error (may be expected): ${e}`);
    }

    // 7. Wait for response to stream and complete
    console.log('Waiting for response to complete...');
    await page.waitForTimeout(5000); // Wait for streaming to complete

    // 8. Check the UI token display WITHOUT refreshing
    let tokenPanelTextAfter = '';
    try {
      const panelElement = await page.locator('.token-usage-panel').first({ timeout: 3000 });
      tokenPanelTextAfter = await panelElement.textContent({ timeout: 3000 });
    } catch (e) {
      console.log(`Failed to get token panel text after message: ${e}`);
      // Provide empty string as fallback to avoid "undefined" errors
      tokenPanelTextAfter = '';
    }
    console.log(`Token panel text after message (no refresh): ${tokenPanelTextAfter || '[not found]'}`);

    // 9. Get current session state from API
    sessionState = await getSession(session.id);
    const afterInputTokens = sessionState.inputTokens || 0;
    const afterOutputTokens = sessionState.outputTokens || 0;
    const afterApiTokens = afterInputTokens + afterOutputTokens;
    console.log(`API tokens after message - Input: ${afterInputTokens}, Output: ${afterOutputTokens}, Total: ${afterApiTokens}`);

    // 10. Now refresh the page and check what the "correct" value should be
    console.log('Refreshing page...');
    try {
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);
    } catch (e) {
      console.log(`Reload error: ${e}`);
    }

    let tokenPanelTextAfterRefresh = '';
    try {
      const panelElement = await page.locator('.token-usage-panel').first({ timeout: 5000 });
      tokenPanelTextAfterRefresh = await panelElement.textContent({ timeout: 5000 });
    } catch (e) {
      console.log(`Failed to get text after refresh: ${e}`);
      // Provide empty string as fallback
      tokenPanelTextAfterRefresh = '';
    }
    console.log(`Token panel text after refresh: ${tokenPanelTextAfterRefresh}`);

    // 11. Compare: Did the tokens update in real-time?
    // Parse the numbers from the panel text
    const extractNumbers = (text: string) => {
      const matches = text.match(/[\d,]+\.?\d*[KM]?/g) || [];
      return matches.map(parseTokenCount);
    };

    const numbersBeforeRefresh = extractNumbers(tokenPanelTextAfter);
    const numbersAfterRefresh = extractNumbers(tokenPanelTextAfterRefresh);

    console.log(`Numbers before refresh: ${numbersBeforeRefresh.join(', ')}`);
    console.log(`Numbers after refresh: ${numbersAfterRefresh.join(', ')}`);

    // The bug: if numbers are different before/after refresh, the UI didn't update in real-time
    const maxBeforeRefresh = Math.max(...numbersBeforeRefresh, 0);
    const maxAfterRefresh = Math.max(...numbersAfterRefresh, 0);

    console.log(`Max token value before refresh: ${maxBeforeRefresh}`);
    console.log(`Max token value after refresh: ${maxAfterRefresh}`);

    // THE BUG CHECK:
    // If the API shows tokens increased, but the UI didn't update until refresh,
    // that confirms the bug
    if (afterApiTokens > initialApiTokens) {
      console.log(`API shows tokens increased from ${initialApiTokens} to ${afterApiTokens}`);

      if (maxBeforeRefresh < maxAfterRefresh) {
        console.log('');
        console.log('========================================');
        console.log('BUG CONFIRMED: Token count did NOT update in real-time!');
        console.log(`  Before refresh: ${maxBeforeRefresh}`);
        console.log(`  After refresh: ${maxAfterRefresh}`);
        console.log(`  API value: ${afterApiTokens}`);
        console.log('========================================');
        console.log('');
        console.log('Captured browser logs:');
        consoleLogs.forEach((log, i) => console.log(`  ${i + 1}. ${log}`));
      }

      // This assertion will FAIL if the bug exists (which is what we want to confirm)
      expect(
        maxBeforeRefresh,
        `Token count should update in real-time. UI showed ${maxBeforeRefresh} before refresh but ${maxAfterRefresh} after refresh. API has ${afterApiTokens}.`
      ).toBeGreaterThanOrEqual(maxAfterRefresh * 0.9); // Allow 10% tolerance
    } else {
      console.log('Note: API tokens did not increase - session may not have processed the message');
    }
  });
});
