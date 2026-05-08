#!/usr/bin/env node
import { copyDatabaseBackups } from './dbUtils.js';

export function main() {
  const result = copyDatabaseBackups();

  if (result.copied.length === 0) {
    console.log(`No database found at ${result.dbPath}; nothing to back up.`);
    return 0;
  }

  console.log(`Database backup directory: ${result.backupDir}`);
  for (const file of result.copied) {
    console.log(`${file.source} -> ${file.target}`);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
