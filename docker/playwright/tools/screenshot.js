#!/usr/bin/env node

/**
 * Screenshot capture utility for Playwright container
 *
 * Usage: node screenshot.js <url> [output]
 *
 * Environment variables:
 *   BROWSER         - Browser to use (chromium, firefox, webkit)
 *   HEADLESS        - Run headless (true/false)
 *   FULL_PAGE       - Capture full page (true/false)
 *   VIEWPORT_WIDTH  - Viewport width in pixels
 *   VIEWPORT_HEIGHT - Viewport height in pixels
 *   DEVICE          - Device to emulate (e.g., "iPhone 14")
 *   TIMEOUT         - Navigation timeout in ms
 */

const { chromium, firefox, webkit, devices } = require('playwright');
const path = require('path');

// Parse environment configuration
const config = {
    browser: process.env.BROWSER || 'chromium',
    headless: process.env.HEADLESS !== 'false',
    fullPage: process.env.FULL_PAGE === 'true',
    viewportWidth: parseInt(process.env.VIEWPORT_WIDTH || '1280', 10),
    viewportHeight: parseInt(process.env.VIEWPORT_HEIGHT || '720', 10),
    device: process.env.DEVICE || null,
    timeout: parseInt(process.env.TIMEOUT || '30000', 10),
};

// Browser launcher map
const browsers = {
    chromium,
    firefox,
    webkit,
};

async function captureScreenshot(url, outputPath) {
    const browserType = browsers[config.browser];
    if (!browserType) {
        throw new Error(`Unknown browser: ${config.browser}. Use chromium, firefox, or webkit.`);
    }

    console.log(`Capturing screenshot of: ${url}`);
    console.log(`Browser: ${config.browser}, Headless: ${config.headless}`);

    // Launch browser
    const browser = await browserType.launch({
        headless: config.headless,
    });

    try {
        // Set up context options
        let contextOptions = {};

        if (config.device && devices[config.device]) {
            // Use device emulation
            contextOptions = { ...devices[config.device] };
            console.log(`Emulating device: ${config.device}`);
        } else {
            // Use custom viewport
            contextOptions = {
                viewport: {
                    width: config.viewportWidth,
                    height: config.viewportHeight,
                },
            };
            console.log(`Viewport: ${config.viewportWidth}x${config.viewportHeight}`);
        }

        const context = await browser.newContext(contextOptions);
        const page = await context.newPage();

        // Set timeout
        page.setDefaultTimeout(config.timeout);

        // Navigate to URL
        console.log(`Navigating to: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle' });

        // Capture screenshot
        const screenshotOptions = {
            path: outputPath,
            fullPage: config.fullPage,
        };

        // Determine format from extension
        const ext = path.extname(outputPath).toLowerCase();
        if (ext === '.jpg' || ext === '.jpeg') {
            screenshotOptions.type = 'jpeg';
            screenshotOptions.quality = 90;
        } else if (ext === '.webp') {
            // Note: Playwright doesn't support webp natively, fallback to png
            console.log('WebP not supported, using PNG');
            screenshotOptions.type = 'png';
        }

        await page.screenshot(screenshotOptions);

        console.log(`Screenshot saved: ${outputPath}`);
        console.log(`Full page: ${config.fullPage}`);

        await context.close();
    } finally {
        await browser.close();
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        console.error('Usage: node screenshot.js <url> [output]');
        console.error('');
        console.error('Example:');
        console.error('  node screenshot.js http://localhost:5173 homepage.png');
        console.error('  FULL_PAGE=true node screenshot.js http://localhost:5173 full-page.png');
        console.error('  DEVICE="iPhone 14" node screenshot.js http://localhost:5173 mobile.png');
        process.exit(1);
    }

    const url = args[0];
    const output = args[1] || 'screenshot.png';

    try {
        await captureScreenshot(url, output);
        process.exit(0);
    } catch (error) {
        console.error('Error capturing screenshot:', error.message);
        process.exit(1);
    }
}

main();
