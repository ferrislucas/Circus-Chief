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
  // Let pending I/O callbacks complete before closing DB.
  // setTimeout(0) defers past the I/O phase, unlike setImmediate
  // which runs before pending I/O callbacks in some cases.
  await new Promise(resolve => setTimeout(resolve, 0));
  closeDatabase();
});
