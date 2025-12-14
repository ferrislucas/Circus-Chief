import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('console', msg => console.log('BROWSER:', msg.text()));

console.log('Navigating to app...');
await page.goto('http://localhost:5000');
await page.waitForTimeout(2000);

// Click on "Sessions" link for the first project
console.log('Clicking Sessions...');
await page.locator('text=Sessions').first().click();
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/step0-sessions-list.png' });

// Click "New Session" button in top right
console.log('Clicking New Session...');
await page.locator('text=New Session').first().click();
await page.waitForTimeout(1000);

// Fill prompt
await page.fill('textarea', 'What is the capital of France? Answer in one word.');
await page.screenshot({ path: '/tmp/step1-filled.png' });

// Submit
await page.click('button[type="submit"]');
console.log('Session submitted...');

// Monitor
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `/tmp/step2-session-${i}.png` });
  
  const bodyText = await page.locator('body').innerText();
  console.log(`\n=== Iteration ${i} ===`);
  console.log(bodyText.substring(0, 1500));
  
  if (bodyText.includes('COMPLETED')) {
    console.log('\n\n*** Session completed successfully! ***');
    break;
  }
}

await browser.close();
