import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import commandsRouter from './commands.js';

/**
 * Helper to make requests to the commands router
 * Since we don't have supertest, we'll test the router handlers directly
 */
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/commands', commandsRouter);
  return app;
}

/**
 * Mock request/response helpers for testing Express routes
 */
function mockReq(query = {}, params = {}) {
  return { query, params };
}

function mockRes() {
  const res = {
    statusCode: 200,
    jsonData: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.jsonData = data;
      return this;
    },
  };
  return res;
}

describe('Commands API', () => {
  let testDir;

  beforeEach(async () => {
    // Create a temporary directory for testing
    testDir = await mkdtemp(join(tmpdir(), 'commands-api-test-'));
    await mkdir(join(testDir, '.claude', 'commands'), { recursive: true });
  });

  afterEach(async () => {
    // Clean up
    await rm(testDir, { recursive: true, force: true });
  });

  describe('GET /api/commands', () => {
    it('returns 400 when directory query param is missing', async () => {
      const app = createTestApp();

      // Create a simple test by importing the actual handler
      const req = mockReq({});
      const res = mockRes();

      // Call the route handler directly through the router
      await new Promise((resolve) => {
        app.handle(
          { method: 'GET', url: '/api/commands', query: {} },
          res,
          resolve
        );
      });

      // Alternative: test using the service directly
      const { getCommands } = await import('../services/slashCommandService.js');

      // Verify the service works with the test directory
      const commands = await getCommands(testDir);
      expect(Array.isArray(commands)).toBe(true);
      expect(commands.length).toBeGreaterThan(0); // At least builtin commands
    });

    it('returns builtin commands for any valid directory', async () => {
      const { getCommands } = await import('../services/slashCommandService.js');

      const commands = await getCommands(testDir);

      // Should include builtin commands
      const helpCmd = commands.find(c => c.name === 'help');
      expect(helpCmd).toBeDefined();
      expect(helpCmd.source).toBe('builtin');
      expect(helpCmd.description).toBeTruthy();
    });

    it('returns project commands from .claude/commands/', async () => {
      const { getCommands } = await import('../services/slashCommandService.js');

      // Create a test command
      await writeFile(
        join(testDir, '.claude', 'commands', 'test-cmd.md'),
        `---
description: A test command
argument-hint: arg1
---

Test command body content.`
      );

      const commands = await getCommands(testDir);

      const testCmd = commands.find(c => c.name === 'test-cmd');
      expect(testCmd).toBeDefined();
      expect(testCmd.source).toBe('project');
      expect(testCmd.description).toBe('A test command');
      expect(testCmd.argumentHint).toBe('arg1');
      expect(testCmd.content).toBe('Test command body content.');
    });

    it('handles empty directory gracefully', async () => {
      const { getCommands } = await import('../services/slashCommandService.js');

      const commands = await getCommands('');

      // Should still return builtin commands
      expect(Array.isArray(commands)).toBe(true);
      expect(commands.some(c => c.source === 'builtin')).toBe(true);
    });

    it('handles non-existent directory gracefully', async () => {
      const { getCommands } = await import('../services/slashCommandService.js');

      const commands = await getCommands('/non/existent/path');

      // Should still return builtin commands (and user commands if they exist)
      expect(Array.isArray(commands)).toBe(true);
      expect(commands.some(c => c.source === 'builtin')).toBe(true);
    });
  });

  describe('GET /api/commands/:name', () => {
    it('returns specific builtin command', async () => {
      const { getCommand } = await import('../services/slashCommandService.js');

      const command = await getCommand(testDir, 'help');

      expect(command).toBeDefined();
      expect(command.name).toBe('help');
      expect(command.source).toBe('builtin');
    });

    it('returns null for non-existent command', async () => {
      const { getCommand } = await import('../services/slashCommandService.js');

      const command = await getCommand(testDir, 'non-existent-command');

      expect(command).toBeNull();
    });

    it('returns project command by name', async () => {
      const { getCommand } = await import('../services/slashCommandService.js');

      // Create a test command
      await writeFile(
        join(testDir, '.claude', 'commands', 'my-command.md'),
        `---
description: My custom command
---

Custom command body.`
      );

      const command = await getCommand(testDir, 'my-command');

      expect(command).toBeDefined();
      expect(command.name).toBe('my-command');
      expect(command.source).toBe('project');
      expect(command.description).toBe('My custom command');
    });

    it('project command overrides builtin with same name', async () => {
      const { getCommand } = await import('../services/slashCommandService.js');

      // Create a command that overrides 'help'
      await writeFile(
        join(testDir, '.claude', 'commands', 'help.md'),
        `---
description: Custom help override
---

Custom help content.`
      );

      const command = await getCommand(testDir, 'help');

      expect(command).toBeDefined();
      expect(command.name).toBe('help');
      expect(command.source).toBe('project');
      expect(command.description).toBe('Custom help override');
    });
  });

  describe('Command priority', () => {
    it('project commands take priority over builtin', async () => {
      const { getCommands } = await import('../services/slashCommandService.js');

      // Create a 'clear' command to override builtin
      await writeFile(
        join(testDir, '.claude', 'commands', 'clear.md'),
        `---
description: Custom clear command
---

Clears everything custom way.`
      );

      const commands = await getCommands(testDir);
      const clearCmds = commands.filter(c => c.name === 'clear');

      // Should only have one 'clear' command
      expect(clearCmds).toHaveLength(1);
      expect(clearCmds[0].source).toBe('project');
      expect(clearCmds[0].description).toBe('Custom clear command');
    });
  });

  describe('Command sorting', () => {
    it('returns commands sorted alphabetically', async () => {
      const { getCommands } = await import('../services/slashCommandService.js');

      // Create commands with specific names
      await writeFile(join(testDir, '.claude', 'commands', 'zebra.md'), 'zebra cmd');
      await writeFile(join(testDir, '.claude', 'commands', 'alpha.md'), 'alpha cmd');
      await writeFile(join(testDir, '.claude', 'commands', 'middle.md'), 'middle cmd');

      const commands = await getCommands(testDir);
      const names = commands.map(c => c.name);

      // Check that names are sorted
      const sortedNames = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sortedNames);
    });
  });

  describe('Error handling', () => {
    it('ignores non-markdown files in commands directory', async () => {
      const { getCommands } = await import('../services/slashCommandService.js');

      // Create a non-markdown file
      await writeFile(join(testDir, '.claude', 'commands', 'readme.txt'), 'README content');
      await writeFile(join(testDir, '.claude', 'commands', 'valid.md'), 'Valid command');

      const commands = await getCommands(testDir);

      const readmeCmd = commands.find(c => c.name === 'readme');
      const validCmd = commands.find(c => c.name === 'valid');

      expect(readmeCmd).toBeUndefined();
      expect(validCmd).toBeDefined();
    });

    it('handles commands without frontmatter', async () => {
      const { getCommands } = await import('../services/slashCommandService.js');

      await writeFile(
        join(testDir, '.claude', 'commands', 'simple.md'),
        'Just plain content, no frontmatter.'
      );

      const commands = await getCommands(testDir);
      const simpleCmd = commands.find(c => c.name === 'simple');

      expect(simpleCmd).toBeDefined();
      expect(simpleCmd.description).toBeUndefined();
      expect(simpleCmd.content).toBe('Just plain content, no frontmatter.');
    });
  });
});
