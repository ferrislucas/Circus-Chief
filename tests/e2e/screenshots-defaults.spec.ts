import { test, expect } from '@playwright/test';
import { writeFileSync } from 'fs';

test.describe('Project Defaults Screenshots', () => {
  test('capture ProjectEditView with Session Defaults', async ({ page }) => {
    // Navigate to app
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    
    // Click the first Edit button
    const editBtn = await page.$('text=/^Edit$/');
    if (!editBtn) {
      test.skip();
      return;
    }
    
    await editBtn.click();
    await page.waitForNavigation({ waitUntil: 'networkidle' });
    // Wait longer for all data to load including defaults
    await page.waitForTimeout(3000);
    
    const screenshotsDir = '/screenshots';
    
    // Screenshot 1: Full page
    const fullPageScreenshot = await page.screenshot({ fullPage: true });
    writeFileSync(`${screenshotsDir}/01-project-edit-full.png`, fullPageScreenshot);
    
    // Check what details elements exist after a longer wait
    const detailsTexts = await page.$$eval('details', details =>
      details.map(d => {
        const summary = d.querySelector('summary');
        return summary ? summary.textContent : '';
      })
    );
    
    console.log('Details found:', detailsTexts);
    
    // Get all form inputs to check if defaults fields exist
    const labels = await page.$$eval('label', labels =>
      labels.map(l => l.textContent).filter(t => t && t.length > 0)
    );
    
    console.log('Labels found:', labels);
    
    // Check the page HTML for "Session Defaults"
    const pageContent = await page.content();
    const hasSessionDefaults = pageContent.includes('Session Defaults');
    console.log('Page contains "Session Defaults":', hasSessionDefaults);
    
    // Take another screenshot after longer wait
    await page.waitForTimeout(1000);
    const screenshot2 = await page.screenshot({ fullPage: true });
    writeFileSync(`${screenshotsDir}/02-after-long-wait.png`, screenshot2);
  });
});
