import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { resolveClaudeMcpServers, resolveCodexMcpServers } from './claudeMcpConfigResolver.js';

describe('resolveClaudeMcpServers', () => {
  let tempDir;
  let homeDirectory;
  let workingDirectory;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'claude-mcp-config-resolver-test-'));
    homeDirectory = join(tempDir, 'home');
    workingDirectory = join(tempDir, 'workspace');
    mkdirSync(homeDirectory, { recursive: true });
    mkdirSync(workingDirectory, { recursive: true });
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('includes user-level Claude MCP servers', () => {
    writeJson(join(homeDirectory, '.claude.json'), {
      mcpServers: {
        userServer: { command: 'node', args: ['server.js'], env: { TOKEN: 'secret' } },
      },
    });

    const result = resolveClaudeMcpServers({ workingDirectory, homeDirectory });

    expect(result.mcpServers).toEqual({
      userServer: { command: 'node', args: ['server.js'], env: { TOKEN: 'secret' } },
    });
    expect(result.diagnostics.included).toContainEqual({
      name: 'userServer',
      source: 'user',
      transport: 'stdio',
    });
  });

  it('includes matching directory-scoped local project MCP servers', () => {
    writeJson(join(homeDirectory, '.claude.json'), {
      projects: {
        [workingDirectory]: {
          mcpServers: {
            localServer: { type: 'http', url: 'https://example.test/mcp' },
          },
        },
      },
    });

    const result = resolveClaudeMcpServers({ workingDirectory, homeDirectory });

    expect(result.mcpServers).toEqual({
      localServer: { type: 'http', url: 'https://example.test/mcp' },
    });
  });

  it('ignores unrelated project entries', () => {
    writeJson(join(homeDirectory, '.claude.json'), {
      projects: {
        [join(tempDir, 'other')]: {
          mcpServers: {
            unrelated: { command: 'node' },
          },
        },
      },
    });

    const result = resolveClaudeMcpServers({ workingDirectory, homeDirectory });

    expect(result.mcpServers).toEqual({});
  });

  it('matches a normalized git repository root project entry', () => {
    const repoRoot = join(tempDir, 'repo');
    const nestedDirectory = join(repoRoot, 'packages', 'server');
    mkdirSync(join(repoRoot, '.git'), { recursive: true });
    mkdirSync(nestedDirectory, { recursive: true });
    writeJson(join(homeDirectory, '.claude.json'), {
      projects: {
        [repoRoot]: {
          mcpServers: {
            repoServer: { command: 'node' },
          },
        },
      },
    });

    const result = resolveClaudeMcpServers({
      workingDirectory: nestedDirectory,
      homeDirectory,
    });

    expect(result.mcpServers.repoServer).toEqual({ command: 'node' });
  });

  it('includes .mcp.json servers when explicitly enabled', () => {
    writeJson(join(workingDirectory, '.mcp.json'), {
      mcpServers: {
        projectServer: { command: 'node', args: ['project.js'] },
      },
    });
    writeJson(join(homeDirectory, '.claude.json'), {
      projects: {
        [workingDirectory]: {
          enabledMcpjsonServers: ['projectServer'],
        },
      },
    });

    const result = resolveClaudeMcpServers({ workingDirectory, homeDirectory });

    expect(result.mcpServers.projectServer).toEqual({ command: 'node', args: ['project.js'] });
  });

  it('includes .mcp.json servers when enableAllProjectMcpServers is true', () => {
    writeJson(join(workingDirectory, '.mcp.json'), {
      mcpServers: {
        projectServer: { type: 'sse', url: 'https://example.test/sse' },
      },
    });
    writeJson(join(homeDirectory, '.claude.json'), {
      projects: {
        [workingDirectory]: {
          enableAllProjectMcpServers: true,
        },
      },
    });

    const result = resolveClaudeMcpServers({ workingDirectory, homeDirectory });

    expect(result.mcpServers.projectServer).toEqual({
      type: 'sse',
      url: 'https://example.test/sse',
    });
  });

  it('excludes .mcp.json servers when disabled', () => {
    writeJson(join(workingDirectory, '.mcp.json'), {
      mcpServers: {
        enabledServer: { command: 'node' },
        disabledServer: { command: 'node' },
      },
    });
    writeJson(join(homeDirectory, '.claude.json'), {
      projects: {
        [workingDirectory]: {
          enableAllProjectMcpServers: true,
          disabledMcpjsonServers: ['disabledServer'],
        },
      },
    });

    const result = resolveClaudeMcpServers({ workingDirectory, homeDirectory });

    expect(result.mcpServers).toEqual({ enabledServer: { command: 'node' } });
    expect(result.diagnostics.skipped).toContainEqual({
      name: 'disabledServer',
      source: 'project',
      reason: 'disabled',
    });
  });

  it('reads .mcp.json approval from .claude/settings.local.json', () => {
    mkdirSync(join(workingDirectory, '.claude'), { recursive: true });
    writeJson(join(workingDirectory, '.mcp.json'), {
      mcpServers: {
        projectServer: { command: 'node' },
      },
    });
    writeJson(join(workingDirectory, '.claude', 'settings.local.json'), {
      enabledMcpjsonServers: ['projectServer'],
    });

    const result = resolveClaudeMcpServers({ workingDirectory, homeDirectory });

    expect(result.mcpServers.projectServer).toEqual({ command: 'node' });
  });

  it('merges sources by server name with project .mcp.json taking precedence', () => {
    writeJson(join(homeDirectory, '.claude.json'), {
      mcpServers: {
        shared: { command: 'user-command' },
      },
      projects: {
        [workingDirectory]: {
          mcpServers: {
            shared: { command: 'local-command' },
          },
          enabledMcpjsonServers: ['shared'],
        },
      },
    });
    writeJson(join(workingDirectory, '.mcp.json'), {
      mcpServers: {
        shared: { command: 'project-command' },
      },
    });

    const result = resolveClaudeMcpServers({ workingDirectory, homeDirectory });

    expect(result.mcpServers.shared).toEqual({ command: 'project-command' });
  });

  it('does not throw on malformed or missing config files', () => {
    writeFileSync(join(homeDirectory, '.claude.json'), '{bad json', 'utf8');

    expect(() => resolveClaudeMcpServers({ workingDirectory, homeDirectory })).not.toThrow();
    expect(resolveClaudeMcpServers({ workingDirectory, homeDirectory }).mcpServers).toEqual({});
  });

  it('skips unsupported server shapes', () => {
    writeJson(join(homeDirectory, '.claude.json'), {
      mcpServers: {
        sdkServer: { type: 'sdk', name: 'sdkServer' },
        missingCommand: { args: ['server.js'] },
        validServer: { command: 'node', extra: 'ignored' },
      },
    });

    const result = resolveClaudeMcpServers({ workingDirectory, homeDirectory });

    expect(result.mcpServers).toEqual({
      validServer: { command: 'node' },
    });
    expect(result.diagnostics.skipped).toEqual([
      { name: 'sdkServer', source: 'user', reason: 'unsupported-or-malformed-server' },
      { name: 'missingCommand', source: 'user', reason: 'unsupported-or-malformed-server' },
    ]);
  });

  it('leaves unapproved .mcp.json servers out', () => {
    writeJson(join(workingDirectory, '.mcp.json'), {
      mcpServers: {
        projectServer: { command: 'node' },
      },
    });

    const result = resolveClaudeMcpServers({ workingDirectory, homeDirectory });

    expect(result.mcpServers).toEqual({});
    expect(result.diagnostics.skipped).toContainEqual({
      name: 'projectServer',
      source: 'project',
      reason: 'not-approved',
    });
  });
});

describe('resolveClaudeMcpServers Codex-only stdio field exclusion', () => {
  let tempDir;
  let homeDirectory;
  let workingDirectory;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'claude-mcp-fields-test-'));
    homeDirectory = join(tempDir, 'home');
    workingDirectory = join(tempDir, 'workspace');
    mkdirSync(homeDirectory, { recursive: true });
    mkdirSync(workingDirectory, { recursive: true });
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('omits stdio cwd even when it is a non-empty string (Codex-only field)', () => {
    writeJson(join(homeDirectory, '.claude.json'), {
      mcpServers: {
        cwdServer: { command: 'node', cwd: '/some/path' },
      },
    });

    const result = resolveClaudeMcpServers({ workingDirectory, homeDirectory });
    expect(result.mcpServers.cwdServer).not.toHaveProperty('cwd');
  });

  it('omits startup_timeout_sec even when it is a valid number (Codex-only field)', () => {
    writeJson(join(homeDirectory, '.claude.json'), {
      mcpServers: {
        timeoutServer: { command: 'node', startup_timeout_sec: 30 },
      },
    });

    const result = resolveClaudeMcpServers({ workingDirectory, homeDirectory });
    expect(result.mcpServers.timeoutServer).not.toHaveProperty('startup_timeout_sec');
  });

  it('omits cwd when it is an empty string', () => {
    writeJson(join(homeDirectory, '.claude.json'), {
      mcpServers: {
        noCwdServer: { command: 'node', cwd: '' },
      },
    });

    const result = resolveClaudeMcpServers({ workingDirectory, homeDirectory });
    expect(result.mcpServers.noCwdServer).not.toHaveProperty('cwd');
  });
});

describe('resolveCodexMcpServers', () => {
  let tempDir;
  let homeDirectory;
  let workingDirectory;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'codex-mcp-resolver-test-'));
    homeDirectory = join(tempDir, 'home');
    workingDirectory = join(tempDir, 'workspace');
    mkdirSync(homeDirectory, { recursive: true });
    mkdirSync(workingDirectory, { recursive: true });
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('includes approved project .mcp.json servers', () => {
    writeJson(join(workingDirectory, '.mcp.json'), {
      mcpServers: { projectServer: { command: 'node', args: ['server.js'] } },
    });
    mkdirSync(join(workingDirectory, '.claude'), { recursive: true });
    writeJson(join(workingDirectory, '.claude', 'settings.local.json'), {
      enabledMcpjsonServers: ['projectServer'],
    });

    const result = resolveCodexMcpServers({ workingDirectory, homeDirectory });
    expect(result.mcpServers).toEqual({ projectServer: { command: 'node', args: ['server.js'] } });
  });

  it('omits unapproved project .mcp.json servers', () => {
    writeJson(join(workingDirectory, '.mcp.json'), {
      mcpServers: { unapprovedServer: { command: 'node' } },
    });

    const result = resolveCodexMcpServers({ workingDirectory, homeDirectory });
    expect(result.mcpServers).toEqual({});
  });

  it('omits user-level Claude MCP servers', () => {
    writeJson(join(homeDirectory, '.claude.json'), {
      mcpServers: { userServer: { command: 'user-cmd' } },
    });

    const result = resolveCodexMcpServers({ workingDirectory, homeDirectory });
    expect(result.mcpServers).toEqual({});
  });

  it('omits local Claude project-entry MCP servers', () => {
    writeJson(join(homeDirectory, '.claude.json'), {
      projects: {
        [workingDirectory]: {
          mcpServers: { localServer: { command: 'local-cmd' } },
        },
      },
    });

    const result = resolveCodexMcpServers({ workingDirectory, homeDirectory });
    expect(result.mcpServers).toEqual({});
  });

  it('same-name user/local/project entries resolve to the approved project .mcp.json entry', () => {
    writeJson(join(homeDirectory, '.claude.json'), {
      mcpServers: { shared: { command: 'user-cmd' } },
      projects: {
        [workingDirectory]: {
          mcpServers: { shared: { command: 'local-cmd' } },
        },
      },
    });
    writeJson(join(workingDirectory, '.mcp.json'), {
      mcpServers: { shared: { command: 'project-cmd', args: ['server.js'] } },
    });
    mkdirSync(join(workingDirectory, '.claude'), { recursive: true });
    writeJson(join(workingDirectory, '.claude', 'settings.local.json'), {
      enabledMcpjsonServers: ['shared'],
    });

    const result = resolveCodexMcpServers({ workingDirectory, homeDirectory });
    expect(result.mcpServers).toEqual({ shared: { command: 'project-cmd', args: ['server.js'] } });
  });

  it('augments approved project stdio servers with cwd from raw .mcp.json', () => {
    writeJson(join(workingDirectory, '.mcp.json'), {
      mcpServers: {
        myServer: { command: 'node', args: ['server.js'], cwd: '/custom/cwd' },
      },
    });
    mkdirSync(join(workingDirectory, '.claude'), { recursive: true });
    writeJson(join(workingDirectory, '.claude', 'settings.local.json'), {
      enabledMcpjsonServers: ['myServer'],
    });

    const result = resolveCodexMcpServers({ workingDirectory, homeDirectory });
    expect(result.mcpServers.myServer).toMatchObject({ command: 'node', args: ['server.js'] });
    expect(result.mcpServers.myServer.cwd).toBe('/custom/cwd');
  });

  it('augments approved project stdio servers with startup_timeout_sec from raw .mcp.json', () => {
    writeJson(join(workingDirectory, '.mcp.json'), {
      mcpServers: {
        myServer: { command: 'node', startup_timeout_sec: 45 },
      },
    });
    mkdirSync(join(workingDirectory, '.claude'), { recursive: true });
    writeJson(join(workingDirectory, '.claude', 'settings.local.json'), {
      enabledMcpjsonServers: ['myServer'],
    });

    const result = resolveCodexMcpServers({ workingDirectory, homeDirectory });
    expect(result.mcpServers.myServer.startup_timeout_sec).toBe(45);
  });

  it('omits cwd from augmentation when raw .mcp.json cwd is an empty string', () => {
    writeJson(join(workingDirectory, '.mcp.json'), {
      mcpServers: {
        myServer: { command: 'node', cwd: '' },
      },
    });
    mkdirSync(join(workingDirectory, '.claude'), { recursive: true });
    writeJson(join(workingDirectory, '.claude', 'settings.local.json'), {
      enabledMcpjsonServers: ['myServer'],
    });

    const result = resolveCodexMcpServers({ workingDirectory, homeDirectory });
    expect(result.mcpServers.myServer).not.toHaveProperty('cwd');
  });

  it('omits startup_timeout_sec from augmentation when raw value is not a finite number', () => {
    writeJson(join(workingDirectory, '.mcp.json'), {
      mcpServers: {
        infiniteServer: { command: 'node', startup_timeout_sec: Infinity },
        stringServer: { command: 'node', startup_timeout_sec: '30' },
      },
    });
    mkdirSync(join(workingDirectory, '.claude'), { recursive: true });
    writeJson(join(workingDirectory, '.claude', 'settings.local.json'), {
      enabledMcpjsonServers: ['infiniteServer', 'stringServer'],
    });

    const result = resolveCodexMcpServers({ workingDirectory, homeDirectory });
    // Infinity is not a valid JSON number; JSON.parse will give null for its key or omit it.
    // Either way, the field should not appear in the resolved server.
    expect(result.mcpServers.infiniteServer).not.toHaveProperty('startup_timeout_sec');
    expect(result.mcpServers.stringServer).not.toHaveProperty('startup_timeout_sec');
  });

  it('does not augment remote servers with cwd or startup_timeout_sec', () => {
    writeJson(join(workingDirectory, '.mcp.json'), {
      mcpServers: {
        remoteServer: { type: 'sse', url: 'https://example.test/mcp', cwd: '/some/path', startup_timeout_sec: 10 },
      },
    });
    mkdirSync(join(workingDirectory, '.claude'), { recursive: true });
    writeJson(join(workingDirectory, '.claude', 'settings.local.json'), {
      enabledMcpjsonServers: ['remoteServer'],
    });

    const result = resolveCodexMcpServers({ workingDirectory, homeDirectory });
    expect(result.mcpServers.remoteServer).not.toHaveProperty('cwd');
    expect(result.mcpServers.remoteServer).not.toHaveProperty('startup_timeout_sec');
  });

  it('reads the project .mcp.json file exactly once during resolveCodexMcpServers', () => {
    writeJson(join(workingDirectory, '.mcp.json'), {
      mcpServers: {
        myServer: { command: 'node', args: ['server.js'], cwd: '/custom/cwd', startup_timeout_sec: 30 },
      },
    });
    mkdirSync(join(workingDirectory, '.claude'), { recursive: true });
    writeJson(join(workingDirectory, '.claude', 'settings.local.json'), {
      enabledMcpjsonServers: ['myServer'],
    });

    // Spy on readFileSync via a custom fs to count reads of .mcp.json
    const mcpJsonPath = join(workingDirectory, '.mcp.json');
    const readFileSpy = vi.fn(readFileSync);
    const customFs = {
      existsSync,
      readFileSync: readFileSpy,
    };

    resolveCodexMcpServers({ workingDirectory, homeDirectory, fs: customFs });

    const mcpJsonReads = readFileSpy.mock.calls.filter(([p]) => String(p) === mcpJsonPath);
    expect(mcpJsonReads).toHaveLength(1);
  });

  it('diagnostics.skipped contains only project-source entries', () => {
    // user-level server (will be skipped at the Codex filter level — source: 'user')
    writeJson(join(homeDirectory, '.claude.json'), {
      mcpServers: {
        userServer: { command: 'user-cmd' },
      },
      projects: {
        [workingDirectory]: {
          mcpServers: {
            localServer: { command: 'local-cmd' },
          },
          enableAllProjectMcpServers: true,
          disabledMcpjsonServers: ['disabledProject'],
        },
      },
    });
    writeJson(join(workingDirectory, '.mcp.json'), {
      mcpServers: {
        unapprovedProject: { command: 'unapproved-cmd' },
        disabledProject: { command: 'disabled-cmd' },
        approvedServer: { command: 'approved-cmd' },
      },
    });
    // unapprovedProject has no approval entry; disabledProject is explicitly disabled

    const result = resolveCodexMcpServers({ workingDirectory, homeDirectory });

    // Only project-source skipped entries should appear
    expect(result.diagnostics.skipped.every((e) => e.source === 'project')).toBe(true);
    expect(result.diagnostics.skipped).toContainEqual(
      expect.objectContaining({ name: 'disabledProject', source: 'project', reason: 'disabled' }),
    );
    // user and local skipped entries should NOT appear
    expect(result.diagnostics.skipped.some((e) => e.source === 'user')).toBe(false);
    expect(result.diagnostics.skipped.some((e) => e.source === 'local')).toBe(false);
  });
});

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
