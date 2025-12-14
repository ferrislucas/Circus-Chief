import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration optimized for Docker container execution.
 *
 * This config is designed to work with the Playwright browser container
 * and can be used as a reference or copied to playwright.config.ts.
 *
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
    // Test directory
    testDir: '/tests',

    // Run tests in files in parallel
    fullyParallel: true,

    // Fail the build on CI if you accidentally left test.only in the source code
    forbidOnly: !!process.env.CI,

    // Retry on CI only
    retries: process.env.CI ? 2 : 0,

    // Limit parallel workers on CI
    workers: process.env.CI ? 1 : undefined,

    // Reporter configuration
    reporter: [
        ['list'],
        ['html', { outputFolder: '/reports/html', open: 'never' }],
        ['json', { outputFile: '/reports/results.json' }],
    ],

    // Shared settings for all projects
    use: {
        // Base URL from environment
        baseURL: process.env.BASE_URL || 'http://localhost:5000',

        // Collect trace when retrying the failed test
        trace: 'on-first-retry',

        // Capture screenshot on failure
        screenshot: 'only-on-failure',

        // Record video on failure
        video: 'retain-on-failure',

        // Default timeout
        actionTimeout: parseInt(process.env.TIMEOUT || '30000', 10),

        // Viewport settings
        viewport: {
            width: parseInt(process.env.VIEWPORT_WIDTH || '1280', 10),
            height: parseInt(process.env.VIEWPORT_HEIGHT || '720', 10),
        },
    },

    // Global timeout
    timeout: parseInt(process.env.TIMEOUT || '30000', 10),

    // Expect timeout
    expect: {
        timeout: 5000,
    },

    // Output directories
    outputDir: '/reports/test-results',

    // Configure projects for major browsers
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
            },
        },

        {
            name: 'firefox',
            use: {
                ...devices['Desktop Firefox'],
            },
        },

        {
            name: 'webkit',
            use: {
                ...devices['Desktop Safari'],
            },
        },

        // Mobile viewports
        {
            name: 'mobile-chrome',
            use: {
                ...devices['Pixel 5'],
            },
        },

        {
            name: 'mobile-safari',
            use: {
                ...devices['iPhone 14'],
            },
        },

        // Tablet viewport
        {
            name: 'tablet',
            use: {
                ...devices['iPad Pro 11'],
            },
        },
    ],

    // Web server configuration (if running app from container)
    // Uncomment if you want the container to start the dev server
    // webServer: {
    //     command: 'pnpm dev',
    //     url: 'http://localhost:5000',
    //     reuseExistingServer: !process.env.CI,
    //     timeout: 120 * 1000,
    // },
});
