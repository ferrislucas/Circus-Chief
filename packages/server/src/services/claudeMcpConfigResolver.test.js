import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { resolveClaudeMcpServers } from './claudeMcpConfigResolver.js';

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

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
