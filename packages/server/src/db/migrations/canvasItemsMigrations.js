/**
 * Migrations for the canvas_items table.
 * Each export is an array of { name, up(db) } migration objects.
 */
import { addColumnIfMissing, getColumns, getTableSql } from './migrationUtils.js';

/**
 * Migrate canvas_items table to include 'code' in type CHECK constraint.
 * SQLite doesn't support ALTER TABLE to modify constraints, so we recreate the table.
 */
function migrateCanvasItemsTypeConstraint(db) {
  const tableSql = getTableSql(db, 'canvas_items');

  // If schema already includes 'code', no migration needed
  if (tableSql?.includes("'code'")) {
    return;
  }

  db.exec(`
    CREATE TABLE canvas_items_new (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('image', 'markdown', 'text', 'json', 'pdf', 'code')),
      content TEXT,
      data TEXT,
      mime_type TEXT,
      filename TEXT,
      label TEXT,
      width INTEGER,
      height INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    INSERT INTO canvas_items_new SELECT * FROM canvas_items;

    DROP TABLE canvas_items;

    ALTER TABLE canvas_items_new RENAME TO canvas_items;

    CREATE INDEX IF NOT EXISTS idx_canvas_session ON canvas_items(session_id);
  `);
}

/**
 * Migrate canvas_items table to drop label column.
 */
function migrateCanvasItemsDropLabel(db) {
  const columns = getColumns(db, 'canvas_items');

  // If label column doesn't exist, migration already done
  if (!columns.includes('label')) {
    return;
  }

  db.exec(`
    CREATE TABLE canvas_items_new (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('image', 'markdown', 'text', 'json', 'pdf', 'code')),
      content TEXT,
      data TEXT,
      mime_type TEXT,
      filename TEXT,
      width INTEGER,
      height INTEGER,
      deleted_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    INSERT INTO canvas_items_new (id, session_id, type, content, data, mime_type, filename, width, height, deleted_at, created_at)
    SELECT id, session_id, type, content, data, mime_type, filename, width, height, deleted_at, created_at FROM canvas_items;

    DROP TABLE canvas_items;

    ALTER TABLE canvas_items_new RENAME TO canvas_items;

    CREATE INDEX IF NOT EXISTS idx_canvas_session ON canvas_items(session_id);
    CREATE INDEX IF NOT EXISTS idx_canvas_deleted ON canvas_items(deleted_at);
  `);
}

/** @type {Array<{name: string, up: (db: import('better-sqlite3').Database) => void}>} */
export const canvasItemsMigrations = [
  {
    name: 'canvas_items-migrate-type-constraint',
    up(db) { migrateCanvasItemsTypeConstraint(db); },
  },
  {
    name: 'canvas_items-add-deleted_at',
    up(db) {
      addColumnIfMissing(db, 'canvas_items', 'deleted_at', 'INTEGER');
      db.exec('CREATE INDEX IF NOT EXISTS idx_canvas_deleted ON canvas_items(deleted_at)');
    },
  },
  {
    name: 'canvas_items-drop-label',
    up(db) { migrateCanvasItemsDropLabel(db); },
  },
  {
    name: 'canvas_items-add-updated_at',
    up(db) {
      const columns = getColumns(db, 'canvas_items');
      if (!columns.includes('updated_at')) {
        db.exec('ALTER TABLE canvas_items ADD COLUMN updated_at INTEGER');
        db.exec('UPDATE canvas_items SET updated_at = created_at WHERE updated_at IS NULL');
      }
    },
  },
];
