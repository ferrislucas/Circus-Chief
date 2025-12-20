import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import {
  getCommands,
  getCommand,
  parseCommandFile,
} from './slashCommandService.js';
import slashCommandService from './slashCommandService.js';

const { BUILTIN_COMMANDS } = slashCommandService;

describe('slashCommandService', () => {
  let testDir;
  let userCommandsDir;
  let originalHome;

  beforeEach(async () => {
    // Create a temporary directory for project commands
    testDir = await mkdtemp(join(tmpdir(), 'slash-cmd-test-'));

    // Create .claude/commands directory
    await mkdir(join(testDir, '.claude', 'commands'), { recursive: true });
  });

  afterEach(async () => {
    // Clean up temporary directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('parseCommandFile', () => {
    it('parses file with frontmatter', () => {
      const content = `---
description: Test command description
argument-hint: arg1 arg2
---

This is the command body.`;

      const result = parseCommandFile(content);

      expect(result.frontmatter.description).toBe('Test command description');
      expect(result.frontmatter['argument-hint']).toBe('arg1 arg2');
      expect(result.body).toBe('This is the command body.');
    });

    it('parses file with quoted values', () => {
      const content = `---
description: "Quoted description"
argument-hint: 'Single quoted'
---

Body content.`;

      const result = parseCommandFile(content);

      expect(result.frontmatter.description).toBe('Quoted description');
      expect(result.frontmatter['argument-hint']).toBe('Single quoted');
    });

    it('handles file without frontmatter', () => {
      const content = 'Just plain content without frontmatter';

      const result = parseCommandFile(content);

      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe('Just plain content without frontmatter');
    });

    it('handles frontmatter with only whitespace keys', () => {
      const content = `---
description: A command
---

Content here.`;

      const result = parseCommandFile(content);

      expect(result.frontmatter.description).toBe('A command');
      expect(result.body).toBe('Content here.');
    });

    it('handles multiline body', () => {
      const content = `---
description: Test
---

Line 1
Line 2
Line 3`;

      const result = parseCommandFile(content);

      expect(result.body).toBe('Line 1\nLine 2\nLine 3');
    });

    it('handles values with colons', () => {
      const content = `---
description: URL: https://example.com
---

Body`;

      const result = parseCommandFile(content);

      expect(result.frontmatter.description).toBe('URL: https://example.com');
    });

    it('handles Windows line endings', () => {
      const content = '---\r\ndescription: Test\r\n---\r\n\r\nBody content';

      const result = parseCommandFile(content);

      expect(result.frontmatter.description).toBe('Test');
      expect(result.body).toBe('Body content');
    });
  });

  describe('BUILTIN_COMMANDS', () => {
    it('includes standard commands', () => {
      const names = BUILTIN_COMMANDS.map(cmd => cmd.name);

      expect(names).toContain('help');
      expect(names).toContain('clear');
      expect(names).toContain('model');
      expect(names).toContain('mode');
      expect(names).toContain('stop');
    });

    it('all have source set to builtin', () => {
      for (const cmd of BUILTIN_COMMANDS) {
        expect(cmd.source).toBe('builtin');
      }
    });

    it('all have descriptions', () => {
      for (const cmd of BUILTIN_COMMANDS) {
        expect(cmd.description).toBeTruthy();
      }
    });
  });

  describe('getCommands', () => {
    it('returns builtin commands', async () => {
      const commands = await getCommands(testDir);

      const helpCmd = commands.find(c => c.name === 'help');
      expect(helpCmd).toBeDefined();
      expect(helpCmd.source).toBe('builtin');
    });

    it('returns project commands from .claude/commands/', async () => {
      // Create a project command
      await writeFile(
        join(testDir, '.claude', 'commands', 'deploy.md'),
        `---
description: Deploy to production
argument-hint: environment
---

Deploy the application to the specified environment.`
      );

      const commands = await getCommands(testDir);

      const deployCmd = commands.find(c => c.name === 'deploy');
      expect(deployCmd).toBeDefined();
      expect(deployCmd.source).toBe('project');
      expect(deployCmd.description).toBe('Deploy to production');
      expect(deployCmd.argumentHint).toBe('environment');
    });

    it('handles commands without frontmatter', async () => {
      await writeFile(
        join(testDir, '.claude', 'commands', 'simple.md'),
        'Just a simple command body with no metadata.'
      );

      const commands = await getCommands(testDir);

      const simpleCmd = commands.find(c => c.name === 'simple');
      expect(simpleCmd).toBeDefined();
      expect(simpleCmd.source).toBe('project');
      expect(simpleCmd.description).toBeUndefined();
      expect(simpleCmd.content).toBe('Just a simple command body with no metadata.');
    });

    it('ignores non-markdown files', async () => {
      await writeFile(
        join(testDir, '.claude', 'commands', 'readme.txt'),
        'This is a readme file, not a command.'
      );

      const commands = await getCommands(testDir);

      const readmeCmd = commands.find(c => c.name === 'readme');
      expect(readmeCmd).toBeUndefined();
    });

    it('handles missing .claude/commands directory gracefully', async () => {
      // Remove the commands directory
      await rm(join(testDir, '.claude'), { recursive: true, force: true });

      const commands = await getCommands(testDir);

      // Should still return builtin commands
      expect(commands.length).toBeGreaterThan(0);
      const helpCmd = commands.find(c => c.name === 'help');
      expect(helpCmd).toBeDefined();
    });

    it('returns commands sorted alphabetically by name', async () => {
      await writeFile(join(testDir, '.claude', 'commands', 'zebra.md'), 'zebra');
      await writeFile(join(testDir, '.claude', 'commands', 'alpha.md'), 'alpha');

      const commands = await getCommands(testDir);
      const names = commands.map(c => c.name);

      // Check that the list is sorted
      const sortedNames = [...names].sort();
      expect(names).toEqual(sortedNames);
    });

    it('project commands override builtin commands with same name', async () => {
      // Create a project command named 'help' to override builtin
      await writeFile(
        join(testDir, '.claude', 'commands', 'help.md'),
        `---
description: Custom project help
---

Custom help content.`
      );

      const commands = await getCommands(testDir);

      const helpCmds = commands.filter(c => c.name === 'help');
      expect(helpCmds).toHaveLength(1);
      expect(helpCmds[0].source).toBe('project');
      expect(helpCmds[0].description).toBe('Custom project help');
    });

    it('handles empty working directory', async () => {
      const commands = await getCommands('');

      // Should return at least builtin commands
      expect(commands.length).toBeGreaterThan(0);
    });
  });

  describe('getCommand', () => {
    it('returns builtin command by name', async () => {
      const command = await getCommand(testDir, 'help');

      expect(command).toBeDefined();
      expect(command.name).toBe('help');
      expect(command.source).toBe('builtin');
    });

    it('returns project command by name', async () => {
      await writeFile(
        join(testDir, '.claude', 'commands', 'custom.md'),
        `---
description: Custom command
---

Custom body.`
      );

      const command = await getCommand(testDir, 'custom');

      expect(command).toBeDefined();
      expect(command.name).toBe('custom');
      expect(command.source).toBe('project');
    });

    it('returns null for non-existent command', async () => {
      const command = await getCommand(testDir, 'non-existent');

      expect(command).toBeNull();
    });
  });
});
