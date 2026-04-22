import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REAL_SCRIPT = resolve(HERE, '..', '..', '..', '..', 'scripts', 'start-server.sh');

/**
 * These tests exercise the DB_PATH resolution in scripts/start-server.sh
 * without actually booting a server. The script supports --dry-run, which
 * exits immediately after resolving DB_PATH and printing it.
 *
 * Each test creates a temp directory with a scripts/start-server.sh that
 * is a symlink pointing at the real script. Because the script computes
 * PROJECT_ROOT via `cd "$(dirname $BASH_SOURCE)/.." && pwd` (which in bash
 * returns the *logical* path by default), PROJECT_ROOT ends up as the
 * fake temp root — not the real worktree.
 *
 * That property is also what gives us per-worktree DB isolation in prod:
 * two worktrees have two different logical paths, so they get two
 * different DB files. We exercise that directly in the "two worktrees"
 * test below.
 */
describe('start-server.sh --dry-run DB_PATH resolution', () => {
  let fakeRoot;
  let scriptPath;

  const makeFakeRoot = () => {
    const root = mkdtempSync(join(tmpdir(), 'cc-start-server-test-'));
    // Resolve /var -> /private/var etc. so we can compare paths reliably on macOS.
    const resolvedRoot = realpathSync(root);
    mkdirSync(join(resolvedRoot, 'scripts'));
    const fakeScript = join(resolvedRoot, 'scripts', 'start-server.sh');
    symlinkSync(REAL_SCRIPT, fakeScript);
    return { root: resolvedRoot, scriptPath: fakeScript };
  };

  beforeEach(() => {
    const created = makeFakeRoot();
    fakeRoot = created.root;
    scriptPath = created.scriptPath;
  });

  afterEach(() => {
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  const runDryRun = (env = {}, opts = {}) => {
    const start = Date.now();
    const stdout = execFileSync('bash', [opts.scriptPath ?? scriptPath, '--dry-run'], {
      env: { ...process.env, ...env },
      encoding: 'utf-8',
      cwd: opts.cwd ?? fakeRoot,
    });
    const elapsed = Date.now() - start;
    return { stdout, elapsed };
  };

  it('VCR_MODE=replay resolves DB_PATH to <PROJECT_ROOT>/.circuschief-test.db', () => {
    const { stdout } = runDryRun({ VCR_MODE: 'replay', DB_PATH: '' });
    expect(stdout).toContain(`DB_PATH=${fakeRoot}/.circuschief-test.db`);
  });

  it('caller-provided DB_PATH wins over the VCR default', () => {
    const { stdout } = runDryRun({ VCR_MODE: 'replay', DB_PATH: '/x/y/custom.db' });
    expect(stdout).toContain('DB_PATH=/x/y/custom.db');
  });

  it('no VCR_MODE and no caller DB_PATH leaves DB_PATH empty (server falls back to default)', () => {
    const { stdout } = runDryRun({ VCR_MODE: '', DB_PATH: '' });
    expect(stdout).toMatch(/^DB_PATH=$/m);
  });

  it('two simulated worktrees resolve to different DB_PATH values', () => {
    const other = mkdtempSync(join(tmpdir(), 'cc-start-server-test-'));
    const otherRoot = realpathSync(other);
    try {
      mkdirSync(join(otherRoot, 'scripts'));
      const otherScript = join(otherRoot, 'scripts', 'start-server.sh');
      symlinkSync(REAL_SCRIPT, otherScript);

      const a = runDryRun({ VCR_MODE: 'replay', DB_PATH: '' });
      const b = runDryRun({ VCR_MODE: 'replay', DB_PATH: '' }, { scriptPath: otherScript, cwd: otherRoot });

      const matchA = a.stdout.match(/DB_PATH=(.*)$/m);
      const matchB = b.stdout.match(/DB_PATH=(.*)$/m);
      expect(matchA[1]).not.toBe(matchB[1]);
      expect(matchA[1]).toBe(`${fakeRoot}/.circuschief-test.db`);
      expect(matchB[1]).toBe(`${otherRoot}/.circuschief-test.db`);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('--dry-run exits quickly without running `yarn build`', () => {
    const { elapsed } = runDryRun({ VCR_MODE: 'replay', DB_PATH: '' });
    // Generous budget — yarn build is typically 15-30s, so 3s is plenty
    // of headroom for slow CI while still catching regressions.
    expect(elapsed).toBeLessThan(3000);
  });
});
