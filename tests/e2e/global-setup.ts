/**
 * Global setup for Playwright tests
 * Runs once before all tests start
 */
import { cleanupAll } from './helpers';

async function globalSetup() {
  console.log('Global setup: Cleaning up leftover test data...');
  try {
    await cleanupAll();
    console.log('Global setup: Cleanup complete');
  } catch (error) {
    console.error('Global setup: Cleanup failed', error);
    // Don't fail setup - tests may still work
  }
}

export default globalSetup;
