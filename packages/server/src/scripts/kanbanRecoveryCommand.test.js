import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { KANBAN_RECOVERY_VERSION, parseRecoveryArguments, runKanbanRecovery } from './kanbanRecoveryCommand.js';

const require = createRequire(import.meta.url);
const serverPackage = require('../../package.json');

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('kanban recovery command', () => {
  it('is dry-run by default and exposes a versioned protocol', () => {
    expect(parseRecoveryArguments([])).toEqual({ apply: false, json: false });
    expect(KANBAN_RECOVERY_VERSION).toBe('kanban-recovery/v1');
  });

  it('requires explicit apply and rejects contradictory flags', () => {
    expect(parseRecoveryArguments(['--apply', '--json'])).toEqual({ apply: true, json: true });
    expect(parseRecoveryArguments(['--apply', '--dry-run']).error).toContain('Usage:');
  });

  it('parses the documented package-script apply invocation', () => {
    const scriptArgs = serverPackage.scripts['kanban:recover'].split(/\s+/).slice(2);

    expect(parseRecoveryArguments([...scriptArgs, '--apply'])).toEqual({ apply: true, json: false });
    expect(parseRecoveryArguments(scriptArgs)).toEqual({ apply: false, json: false });
  });

  it('audits a copied database without migrating or modifying it in dry-run mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'circuschief-recovery-'));
    const dbPath = join(dir, 'incident-copy.db');
    const manager = new DatabaseManager();
    manager.init(dbPath);
    manager.close();
    const before = digest(dbPath);
    try {
      const result = runKanbanRecovery({ dbPath });
      expect(result).toEqual(expect.objectContaining({ mode: 'dry-run', applied: false }));
      expect(digest(dbPath)).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
