/**
 * Utility helpers shared by migration modules.
 *
 * These helpers keep each migration definition concise and avoid repeating
 * the same PRAGMA + includes() pattern in every single migration object.
 */

/**
 * Return the column names for a given table.
 * @param {import('better-sqlite3').Database} db
 * @param {string} table
 * @returns {string[]}
 */
export function getColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((col) => col.name);
}

/**
 * Add a column to a table only when it does not already exist.
 * @param {import('better-sqlite3').Database} db
 * @param {string} table
 * @param {string} column
 * @param {string} definition  e.g. "TEXT", "INTEGER DEFAULT 0"
 */
export function addColumnIfMissing(db, table, column, definition) {
  const columns = getColumns(db, table);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Check whether a given table exists in the database.
 * @param {import('better-sqlite3').Database} db
 * @param {string} table
 * @returns {boolean}
 */
export function tableExists(db, table) {
  return !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);
}

/**
 * Get the CREATE TABLE SQL for a table from sqlite_master.
 * @param {import('better-sqlite3').Database} db
 * @param {string} table
 * @returns {string|undefined}
 */
export function getTableSql(db, table) {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);
  return row?.sql;
}
