import { beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase } from '../src/database.js';

// Suppress logs during tests
process.env.NODE_ENV = 'test';
const originalLog = console.log;
console.log = (...args) => {
  // Suppress all console.log during tests
};

beforeEach(() => {
  initDatabase(':memory:');
});

afterEach(async () => {
  // Give any pending async operations time to complete before closing
  await new Promise(resolve => setImmediate(resolve));
  closeDatabase();
});
