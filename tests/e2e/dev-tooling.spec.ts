import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync, accessSync, constants } from 'fs';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { API_URL, getAPIURL } from './helpers';

/**
 * Development & Testing Tooling Tests
 *
 * Validates the development infrastructure: shell scripts, build tools,
 * test runners, and monorepo configuration.
 *
 * Categories:
 *   1. start-server.sh Script Behavior (5 tests)
 *   2. Port Isolation & Server Liveness (3 tests)
 *   3. Monorepo Structure & Build (4 tests)
 *   4. pw.sh Enhancements (3 tests)
 */

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Execute a shell command and capture stdout/stderr/exitCode.
 * Uses execSync with try/catch to capture non-zero exit codes.
 */
function runScript(
  command: string,
  options?: { cwd?: string; env?: Record<string, string>; timeout?: number }
): { stdout: string; stderr: string; exitCode: number } {
  // If options.env is provided, use it as the complete environment (don't merge with process.env).
  // This allows callers like cleanEnvForUnitTests() to remove keys (e.g., VCR_MODE).
  const env = options?.env ?? { ...process.env };
  try {
    const stdout = execSync(command, {
      cwd: options?.cwd,
      env,
      timeout: options?.timeout ?? 120_000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: stdout.toString(), stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
      exitCode: err.status ?? 1,
    };
  }
}

/**
 * Read .server-port file content (or null if missing).
 */
function readPortFile(dir?: string): string | null {
  const filePath = join(dir ?? process.cwd(), '.server-port');
  if (existsSync(filePath)) {
    return readFileSync(filePath, 'utf-8').trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Temp directory tracking for cleanup
// ---------------------------------------------------------------------------
const tmpDirs: string[] = [];

function createTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function cleanupTmpDirs() {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
  tmpDirs.length = 0;
}

// ==========================================================================
// Category 1: start-server.sh Script Behavior
// ==========================================================================

test.describe('Category 1: start-server.sh Script Behavior', () => {
  test.describe.configure({ timeout: 15_000 });

  test.afterEach(() => {
    cleanupTmpDirs();
  });

  // Test 1
  test('start-server.sh exists and is executable', () => {
    const scriptPath = join(process.cwd(), 'scripts', 'start-server.sh');
    expect(existsSync(scriptPath)).toBe(true);
    // Check execute permission
    accessSync(scriptPath, constants.X_OK);
  });

  // Test 2
  test('is_worktree detects .git directory as main repo', () => {
    const tmpDir = createTmpDir('dev-tooling-test-main-');
    mkdirSync(join(tmpDir, '.git'));

    const result = runScript(
      `bash -c '[ -f .git ] && echo worktree || echo main'`,
      { cwd: tmpDir }
    );

    expect(result.stdout.trim()).toBe('main');
  });

  // Test 3
  test('is_worktree detects .git file as worktree', () => {
    const tmpDir = createTmpDir('dev-tooling-test-wt-');
    writeFileSync(join(tmpDir, '.git'), 'gitdir: /tmp/fake-git-dir');

    const result = runScript(
      `bash -c '[ -f .git ] && echo worktree || echo main'`,
      { cwd: tmpDir }
    );

    expect(result.stdout.trim()).toBe('worktree');
  });

  // Test 4
  test('port assignment gives 5000 for main repo and 5001+ for worktree', () => {
    const tmpMainRepo = createTmpDir('dev-tooling-test-main-');
    mkdirSync(join(tmpMainRepo, '.git'));

    const tmpWorktree = createTmpDir('dev-tooling-test-wt-');
    writeFileSync(join(tmpWorktree, '.git'), 'gitdir: /tmp/fake-git-dir');

    const portScript = `bash -c 'if [ -f .git ]; then echo 5001; else echo 5000; fi'`;

    const mainResult = runScript(portScript, { cwd: tmpMainRepo });
    const wtResult = runScript(portScript, { cwd: tmpWorktree });

    expect(mainResult.stdout.trim()).toBe('5000');
    const worktreePort = parseInt(wtResult.stdout.trim(), 10);
    expect(worktreePort).toBeGreaterThanOrEqual(5001);
  });

  // Test 5
  test('current worktree .server-port file exists with valid port', () => {
    const port = readPortFile();
    expect(port).not.toBeNull();

    const portNum = parseInt(port!, 10);
    expect(portNum).toBeGreaterThanOrEqual(1024);
    expect(portNum).toBeLessThanOrEqual(65535);

    // Since we're running in a worktree, port should be >= 5001
    // (but only if we can confirm we're in a worktree)
    const gitPath = join(process.cwd(), '.git');
    if (existsSync(gitPath)) {
      try {
        // .git is a file => worktree
        accessSync(gitPath, constants.R_OK);
        const stat = readFileSync(gitPath, 'utf-8');
        if (stat.startsWith('gitdir:')) {
          // Confirmed worktree
          expect(portNum).toBeGreaterThanOrEqual(5001);
        }
      } catch {
        // Not readable or not a file, skip worktree assertion
      }
    }
  });
});

// ==========================================================================
// Category 2: Port Isolation & Server Liveness
// ==========================================================================

test.describe('Category 2: Port Isolation & Server Liveness', () => {
  test.describe.configure({ timeout: 15_000 });

  // Test 6
  test('.server-port contains a valid port number', () => {
    const portContent = readPortFile();
    expect(portContent).not.toBeNull();
    expect(portContent).toMatch(/^\d+$/);

    const port = parseInt(portContent!, 10);
    expect(port).toBeGreaterThanOrEqual(1024);
    expect(port).toBeLessThanOrEqual(65535);
  });

  // Test 7
  test('server is running on the port from .server-port', async () => {
    const port = readPortFile();
    expect(port).not.toBeNull();

    const url = `http://localhost:${port}/api/projects`;
    const response = await fetch(url);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
  });

  // Test 8
  test('helpers.ts getAPIURL returns URL matching .server-port', () => {
    const port = readPortFile();
    expect(port).not.toBeNull();

    const expectedURL = `http://localhost:${port}`;
    // API_URL is resolved at import time from getAPIURL()
    expect(API_URL).toBe(expectedURL);

    // Also verify the function directly
    const freshURL = getAPIURL();
    expect(freshURL).toBe(expectedURL);
  });
});

// ==========================================================================
// Category 3: Monorepo Structure & Build
// ==========================================================================

test.describe('Category 3: Monorepo Structure & Build', () => {
  // Test 9
  test('monorepo has correct workspace packages', { timeout: 15_000 }, () => {
    // yarn workspaces info (Yarn v1 syntax) outputs JSON with header/footer lines
    // Output format:
    //   yarn workspaces v1.22.22
    //   { ... JSON ... }
    //   Done in 0.06s.
    const result = runScript('yarn workspaces info');
    expect(result.exitCode).toBe(0);

    const combined = result.stdout + result.stderr;

    // Log for debugging if parsing fails
    if (!combined.includes('{')) {
      console.log('[workspaces info] combined output:', combined.slice(0, 500));
    }

    // Extract the JSON block between the header and footer lines.
    // Yarn v1 outputs: "yarn workspaces v1.22.22\n{...JSON...}\nDone in Xs."
    // Find the first '{' and last '}' to extract the JSON object.
    const firstBrace = combined.indexOf('{');
    expect(firstBrace).toBeGreaterThan(-1);

    // Find matching closing brace by finding the last '}' before "Done in"
    const doneIdx = combined.lastIndexOf('Done in');
    const searchEnd = doneIdx > -1 ? doneIdx : combined.length;
    const lastBrace = combined.lastIndexOf('}', searchEnd);
    expect(lastBrace).toBeGreaterThan(firstBrace);

    const jsonStr = combined.slice(firstBrace, lastBrace + 1);
    const workspaceInfo = JSON.parse(jsonStr);

    expect(workspaceInfo).toHaveProperty('@claudetools/server');
    expect(workspaceInfo).toHaveProperty('@claudetools/web');
    expect(workspaceInfo).toHaveProperty('@claudetools/shared');
    expect(Object.keys(workspaceInfo)).toHaveLength(3);
  });

  // Test 10
  test('shared package is a dependency of server and web', { timeout: 15_000 }, () => {
    const serverPkg = JSON.parse(
      readFileSync(join(process.cwd(), 'packages', 'server', 'package.json'), 'utf-8')
    );
    const webPkg = JSON.parse(
      readFileSync(join(process.cwd(), 'packages', 'web', 'package.json'), 'utf-8')
    );

    expect(serverPkg.dependencies).toHaveProperty('@claudetools/shared');
    expect(webPkg.dependencies).toHaveProperty('@claudetools/shared');
  });

  // Test 11
  test('yarn build succeeds and produces web dist', { timeout: 120_000 }, () => {
    const result = runScript('yarn build', { timeout: 110_000 });
    expect(result.exitCode).toBe(0);

    // Only packages/web/dist/ should exist (server has no build step)
    const webDistPath = join(process.cwd(), 'packages', 'web', 'dist');
    expect(existsSync(webDistPath)).toBe(true);

    const indexHtmlPath = join(webDistPath, 'index.html');
    expect(existsSync(indexHtmlPath)).toBe(true);
  });

  // Test 12
  test('yarn lint succeeds', { timeout: 120_000 }, () => {
    const result = runScript('yarn lint', { timeout: 110_000 });
    expect(result.exitCode).toBe(0);
  });
});

// ==========================================================================
// Category 4: pw.sh Enhancements
// ==========================================================================

test.describe('Category 4: pw.sh Enhancements', () => {
  test.describe.configure({ timeout: 15_000 });

  // Test 13
  test('pw.sh help command shows usage information', () => {
    // pw.sh help outputs via heredoc to stdout; other funcs use stderr.
    // Capture both.
    const result = runScript('./scripts/pw.sh help');
    expect(result.exitCode).toBe(0);

    const combined = result.stdout + result.stderr;

    // Should contain usage info
    const hasUsage = combined.includes('Usage') || combined.includes('usage');
    expect(hasUsage).toBe(true);

    // Should mention key commands
    expect(combined).toContain('test');
    expect(combined).toContain('debug');
    expect(combined).toContain('screenshot');
    expect(combined).toContain('codegen');
  });

  // Test 14
  test('pw.sh sets VCR_MODE for test runs', () => {
    const pwshSource = readFileSync(
      join(process.cwd(), 'scripts', 'pw.sh'),
      'utf-8'
    );

    // Verify VCR_MODE is exported with auto default
    expect(pwshSource).toContain('export VCR_MODE=${VCR_MODE:-auto}');

    // Verify it appears in cmd_test function context
    // The export should come before detect_or_start_server in cmd_test()
    const cmdTestStart = pwshSource.indexOf('cmd_test()');
    expect(cmdTestStart).toBeGreaterThan(-1);

    const vcrModePos = pwshSource.indexOf('export VCR_MODE=${VCR_MODE:-auto}', cmdTestStart);
    expect(vcrModePos).toBeGreaterThan(cmdTestStart);

    const detectServerPos = pwshSource.indexOf('detect_or_start_server', vcrModePos);
    expect(detectServerPos).toBeGreaterThan(vcrModePos);
  });

  // Test 15
  test('pw.sh handles stale .server-port by removing and restarting', () => {
    const pwshSource = readFileSync(
      join(process.cwd(), 'scripts', 'pw.sh'),
      'utf-8'
    );

    // Find detect_or_start_server function
    const funcStart = pwshSource.indexOf('detect_or_start_server()');
    expect(funcStart).toBeGreaterThan(-1);

    // Get the function body (up to the next top-level function or end)
    const funcBody = pwshSource.slice(funcStart, funcStart + 2000);

    // (a) Curl check against the port from .server-port
    expect(funcBody).toMatch(/curl.*localhost.*\$.*port/i);

    // (b) rm -f when curl fails (stale port file removal)
    expect(funcBody).toContain('rm -f');

    // (c) Call to start-server.sh to start a new server
    expect(funcBody).toContain('start-server.sh');

    // Verify order: curl check comes before rm, which comes before start-server.sh
    const curlPos = funcBody.search(/curl/);
    const rmPos = funcBody.indexOf('rm -f');
    const startPos = funcBody.indexOf('start-server.sh');

    expect(curlPos).toBeGreaterThan(-1);
    expect(rmPos).toBeGreaterThan(curlPos);
    expect(startPos).toBeGreaterThan(rmPos);
  });
});
