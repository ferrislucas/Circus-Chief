#!/usr/bin/env node

/**
 * Health check utility for Playwright container
 *
 * Verifies that browser can launch and navigate successfully.
 * Used by Docker health check to ensure container is ready.
 *
 * Usage: node health-check.js [url]
 *
 * Exit codes:
 *   0 - Healthy (browser works)
 *   1 - Unhealthy (browser failed)
 */

const { chromium } = require('playwright');

async function healthCheck(url) {
    let browser;

    try {
        // Launch browser
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();

        // Set short timeout for health check
        page.setDefaultTimeout(10000);

        if (url) {
            // Try to navigate to provided URL
            await page.goto(url, { waitUntil: 'domcontentloaded' });
            console.log(`Health check passed: Successfully loaded ${url}`);
        } else {
            // Just verify browser can create a page
            await page.goto('about:blank');
            console.log('Health check passed: Browser is operational');
        }

        await context.close();
        await browser.close();

        return true;
    } catch (error) {
        console.error('Health check failed:', error.message);

        if (browser) {
            try {
                await browser.close();
            } catch {
                // Ignore close errors
            }
        }

        return false;
    }
}

async function main() {
    const url = process.argv[2] || null;

    const healthy = await healthCheck(url);
    process.exit(healthy ? 0 : 1);
}

main();
