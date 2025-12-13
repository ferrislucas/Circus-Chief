import { beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase } from '../src/database.js';

beforeEach(() => {
  initDatabase(':memory:');
});

afterEach(() => {
  closeDatabase();
});
