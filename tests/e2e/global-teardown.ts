/**
 * Global teardown for Playwright tests
 * Runs once after all tests complete
 */
import { cleanupAll } from './helpers';

async function globalTeardown() {
  console.log('Global teardown: Cleaning up all test data...');
  try {
    await cleanupAll();
    console.log('Global teardown: Cleanup complete');
  } catch (error) {
    console.error('Global teardown: Cleanup failed', error);
    // Don't fail teardown - tests may have already cleaned up
  }
}

export default globalTeardown;
