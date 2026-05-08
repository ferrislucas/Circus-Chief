#!/usr/bin/env node
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import {
  createFreshBaselineDb,
  getActiveDbPath,
  getSchemaObjects,
} from './dbUtils.js';

const BASELINE_TABLES = [
  'sessions',
  'projects',
  'project_session_defaults',
  'session_templates',
  'canvas_items',
  'providers',
  'provider_models',
  'kanban_lanes',
  'agent_call_logs',
];

function printDatabase(db, label) {
  console.log(`# ${label}`);

  for (const row of getSchemaObjects(db)) {
    console.log(`\n-- ${row.type} ${row.name} (${row.tbl_name})`);
    console.log(row.sql || '');
  }

  for (const table of BASELINE_TABLES) {
    const exists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(table);
    if (!exists) continue;

    console.log(`\n-- PRAGMA table_info(${table})`);
    console.table(db.prepare(`PRAGMA table_info(${table})`).all());
    console.log(`-- PRAGMA foreign_key_list(${table})`);
    console.table(db.prepare(`PRAGMA foreign_key_list(${table})`).all());
    console.log(`-- PRAGMA index_list(${table})`);
    const indexes = db.prepare(`PRAGMA index_list(${table})`).all();
    console.table(indexes);

    for (const index of indexes) {
      console.log(`-- PRAGMA index_info(${index.name})`);
      console.table(db.prepare(`PRAGMA index_info(${index.name})`).all());
      console.log(`-- PRAGMA index_xinfo(${index.name})`);
      console.table(db.prepare(`PRAGMA index_xinfo(${index.name})`).all());
    }
  }
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('--fresh')) {
    const fresh = createFreshBaselineDb();
    try {
      printDatabase(fresh.db, `fresh baseline ${fresh.dbPath}`);
    } finally {
      fresh.close();
    }
    return 0;
  }

  const dbPath = getActiveDbPath();
  if (!existsSync(dbPath)) {
    console.log(`No database found at ${dbPath}; use --fresh to inspect a fresh baseline.`);
    return 0;
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    printDatabase(db, `active database ${dbPath}`);
  } finally {
    db.close();
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
