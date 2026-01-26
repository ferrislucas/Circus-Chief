import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseCommandFile,
  getCommands,
  getCommand,
  getCommandBody,
  buildCommandString,
} from './slashCommandService.js';

describe('slashCommandService', () => {
  let testDir;
  let projectCommandsDir;

  beforeAll(async () => {
    // Create a temporary directory for test files
    testDir = join(tmpdir(), `slash-command-test-${Date.now()}`);
    projectCommandsDir = join(testDir, '.claude', 'commands');
    await mkdir(projectCommandsDir, { recursive: true });
  });

  afterAll(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('parseCommandFile', () => {
    it('parses a command file with frontmatter', () => {
      const content = `---
description: Deploy the application
arguments:
  - name: environment
    type: select
    label: Environment
    required: true
    options:
      - value: staging
        label: Staging
      - value: production
        label: Production
  - name: notes
    type: multiline
    label: Deployment Notes
    placeholder: Enter any notes...
---

Deploy the application to $environment.

Notes: $notes
`;

      const result = parseCommandFile(content);

      expect(result.description).toBe('Deploy the application');
      expect(result.arguments).toHaveLength(2);
      expect(result.arguments[0]).toEqual({
        name: 'environment',
        type: 'select',
        label: 'Environment',
        required: true,
        placeholder: '',
        options: [
          { value: 'staging', label: 'Staging' },
          { value: 'production', label: 'Production' },
        ],
      });
      expect(result.arguments[1]).toEqual({
        name: 'notes',
        type: 'multiline',
        label: 'Deployment Notes',
        required: false,
        placeholder: 'Enter any notes...',
      });
      expect(result.body).toContain('Deploy the application to $environment');
    });

    it('parses a command file without frontmatter', () => {
      const content = `Run this prompt as-is.

No YAML here.`;

      const result = parseCommandFile(content);

      expect(result.description).toBe('');
      expect(result.arguments).toEqual([]);
      expect(result.body).toBe(content);
    });

    it('handles malformed frontmatter', () => {
      const content = `---
description: This is incomplete
`;

      const result = parseCommandFile(content);

      // Should treat as body since no closing ---
      expect(result.body).toBe(content.trim());
    });

    it('normalizes argument types', () => {
      const content = `---
arguments:
  - name: test
    type: unknown_type
---
Body`;

      const result = parseCommandFile(content);

      // Unknown type should default to 'text'
      expect(result.arguments[0].type).toBe('text');
    });

    it('handles string options in select type', () => {
      const content = `---
arguments:
  - name: env
    type: select
    options:
      - dev
      - staging
      - prod
---
Body`;

      const result = parseCommandFile(content);

      expect(result.arguments[0].options).toEqual([
        { value: 'dev', label: 'dev' },
        { value: 'staging', label: 'staging' },
        { value: 'prod', label: 'prod' },
      ]);
    });

    it('handles default values in arguments', () => {
      const content = `---
arguments:
  - name: count
    type: text
    default: "10"
---
Body`;

      const result = parseCommandFile(content);

      expect(result.arguments[0].default).toBe('10');
    });
  });

  describe('getCommands', () => {
    beforeEach(async () => {
      // Clear the commands directory before each test
      await rm(projectCommandsDir, { recursive: true, force: true });
      await mkdir(projectCommandsDir, { recursive: true });
    });

    it('returns empty array when no custom commands exist', async () => {
      const commands = await getCommands(testDir);

      // Built-in commands were removed (they require terminal interaction)
      // So when no custom commands exist, we should get an empty array
      expect(commands.length).toBe(0);
    });

    it('discovers project commands from .claude/commands/', async () => {
      // Create a test command file
      await writeFile(
        join(projectCommandsDir, 'deploy.md'),
        `---
description: Deploy the application
---
Deploy now!`
      );

      const commands = await getCommands(testDir);

      const deploy = commands.find((c) => c.name === 'deploy');
      expect(deploy).toBeDefined();
      expect(deploy.description).toBe('Deploy the application');
      expect(deploy.source).toBe('project');
    });

    it('ignores non-markdown files', async () => {
      await writeFile(join(projectCommandsDir, 'readme.txt'), 'This is not a command');
      await writeFile(join(projectCommandsDir, 'script.sh'), '#!/bin/bash\necho hi');

      const commands = await getCommands(testDir);

      // Non-markdown files should be ignored (no commands should be discovered)
      expect(commands.length).toBe(0);
      expect(commands.some((c) => c.name === 'readme')).toBe(false);
      expect(commands.some((c) => c.name === 'script')).toBe(false);
    });

    it('project commands are properly discovered', async () => {
      // Create a custom command
      await writeFile(
        join(projectCommandsDir, 'compact.md'),
        `---
description: Custom compact
---
Custom compact content`
      );

      const commands = await getCommands(testDir);

      const compact = commands.find((c) => c.name === 'compact');
      expect(compact).toBeDefined();
      expect(compact.source).toBe('project');
      expect(compact.description).toBe('Custom compact');

      // Should have exactly one compact command
      expect(commands.filter((c) => c.name === 'compact')).toHaveLength(1);
    });
  });

  describe('getCommand', () => {
    beforeEach(async () => {
      await rm(projectCommandsDir, { recursive: true, force: true });
      await mkdir(projectCommandsDir, { recursive: true });
    });

    it('returns a command by name', async () => {
      await writeFile(
        join(projectCommandsDir, 'test.md'),
        `---
description: Test command
---
Test body`
      );

      const cmd = await getCommand(testDir, 'test');

      expect(cmd).toBeDefined();
      expect(cmd.name).toBe('test');
      expect(cmd.description).toBe('Test command');
    });

    it('returns null for non-existent command', async () => {
      const cmd = await getCommand(testDir, 'nonexistent');

      expect(cmd).toBeNull();
    });
  });

  describe('getCommandBody', () => {
    beforeEach(async () => {
      await rm(projectCommandsDir, { recursive: true, force: true });
      await mkdir(projectCommandsDir, { recursive: true });
    });

    it('returns the body content of a custom command', async () => {
      await writeFile(
        join(projectCommandsDir, 'greet.md'),
        `---
description: Greet the user
---
Hello, world!`
      );

      const body = await getCommandBody(testDir, 'greet');

      expect(body).toBe('Hello, world!');
    });

    it('returns null for non-existent commands', async () => {
      const body = await getCommandBody(testDir, 'nonexistent');

      expect(body).toBeNull();
    });
  });

  describe('buildCommandString', () => {
    beforeEach(async () => {
      await rm(projectCommandsDir, { recursive: true, force: true });
      await mkdir(projectCommandsDir, { recursive: true });
    });

    it('substitutes arguments in the command body', async () => {
      await writeFile(
        join(projectCommandsDir, 'deploy.md'),
        `---
description: Deploy
arguments:
  - name: environment
    type: text
---
Deploy to $environment now!`
      );

      const result = await buildCommandString(testDir, 'deploy', { environment: 'production' });

      expect(result).toBe('Deploy to production now!');
    });

    it('handles ${arg} style placeholders', async () => {
      await writeFile(
        join(projectCommandsDir, 'greet.md'),
        `---
arguments:
  - name: name
    type: text
---
Hello \${name}!`
      );

      const result = await buildCommandString(testDir, 'greet', { name: 'Alice' });

      expect(result).toBe('Hello Alice!');
    });

    it('replaces $ARGUMENTS with all argument values', async () => {
      await writeFile(
        join(projectCommandsDir, 'run.md'),
        `---
arguments:
  - name: cmd
    type: text
  - name: flags
    type: text
---
Execute: $ARGUMENTS`
      );

      const result = await buildCommandString(testDir, 'run', { cmd: 'test', flags: '--verbose' });

      expect(result).toBe('Execute: test --verbose');
    });

    it('quotes argument values with spaces', async () => {
      await writeFile(
        join(projectCommandsDir, 'echo.md'),
        `---
arguments:
  - name: message
    type: text
---
Say: $ARGUMENTS`
      );

      const result = await buildCommandString(testDir, 'echo', { message: 'hello world' });

      expect(result).toBe('Say: "hello world"');
    });

    it('throws error for non-existent command', async () => {
      await expect(buildCommandString(testDir, 'nonexistent', {})).rejects.toThrow(
        'Command not found: nonexistent'
      );
    });
  });
});
