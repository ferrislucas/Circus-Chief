import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseCommandFile,
  parseSkillFile,
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

  describe('parseSkillFile', () => {
    it('parses a skill file with full frontmatter', () => {
      const content = `---
name: my-skill
description: A test skill
argument-hint: "[filename]"
user-invocable: true
disable-model-invocation: false
---
Process the file: $ARGUMENTS`;

      const result = parseSkillFile(content, 'fallback-name');

      expect(result.name).toBe('my-skill');
      expect(result.description).toBe('A test skill');
      expect(result.argumentHint).toBe('[filename]');
      expect(result.userInvocable).toBe(true);
      expect(result.disableModelInvocation).toBe(false);
      expect(result.body).toBe('Process the file: $ARGUMENTS');
    });

    it('uses directory name as fallback when name not specified', () => {
      const content = `---
description: A skill without name
---
Body content`;

      const result = parseSkillFile(content, 'directory-name');

      expect(result.name).toBe('directory-name');
    });

    it('handles skill without frontmatter', () => {
      const content = 'Just a body, no frontmatter';

      const result = parseSkillFile(content, 'my-skill');

      expect(result.name).toBe('my-skill');
      expect(result.description).toBe('');
      expect(result.body).toBe('Just a body, no frontmatter');
    });

    it('handles malformed frontmatter gracefully', () => {
      const content = `---
name: incomplete`;

      const result = parseSkillFile(content, 'fallback');

      expect(result.name).toBe('fallback');
      expect(result.body).toBe(content.trim());
    });

    it('defaults user-invocable to true', () => {
      const content = `---
name: test
---
body`;

      const result = parseSkillFile(content, 'test');

      expect(result.userInvocable).toBe(true);
    });

    it('respects user-invocable: false', () => {
      const content = `---
name: hidden
user-invocable: false
---
body`;

      const result = parseSkillFile(content, 'hidden');

      expect(result.userInvocable).toBe(false);
    });

    it('defaults disable-model-invocation to false', () => {
      const content = `---
name: test
---
body`;

      const result = parseSkillFile(content, 'test');

      expect(result.disableModelInvocation).toBe(false);
    });

    it('respects disable-model-invocation: true', () => {
      const content = `---
name: user-only
disable-model-invocation: true
---
body`;

      const result = parseSkillFile(content, 'user-only');

      expect(result.disableModelInvocation).toBe(true);
    });
  });

  describe('skill discovery', () => {
    let skillsDir;

    beforeEach(async () => {
      // Clear and recreate skills directory
      skillsDir = join(testDir, '.claude', 'skills');
      await rm(skillsDir, { recursive: true, force: true });
    });

    it('discovers skills from .claude/skills/', async () => {
      await mkdir(join(skillsDir, 'my-skill'), { recursive: true });
      await writeFile(
        join(skillsDir, 'my-skill', 'SKILL.md'),
        `---
name: my-skill
description: A test skill
argument-hint: "[filename]"
---
Process the file: $ARGUMENTS`
      );

      const commands = await getCommands(testDir);
      const skill = commands.find((c) => c.name === 'my-skill');

      expect(skill).toBeDefined();
      expect(skill.isSkill).toBe(true);
      expect(skill.source).toBe('project-skill');
      expect(skill.argumentHint).toBe('[filename]');
      expect(skill.arguments).toEqual([]);
    });

    it('filters out skills with user-invocable: false', async () => {
      await mkdir(join(skillsDir, 'hidden-skill'), { recursive: true });
      await writeFile(
        join(skillsDir, 'hidden-skill', 'SKILL.md'),
        `---
name: hidden-skill
user-invocable: false
---
This skill is model-only`
      );

      const commands = await getCommands(testDir);

      expect(commands.find((c) => c.name === 'hidden-skill')).toBeUndefined();
    });

    it('returns empty array when .claude/skills/ does not exist', async () => {
      // Don't create skills directory
      const commands = await getCommands(testDir);
      const skills = commands.filter((c) => c.isSkill);

      expect(skills).toEqual([]);
    });

    it('ignores directories without SKILL.md', async () => {
      await mkdir(join(skillsDir, 'incomplete-skill'), { recursive: true });
      await writeFile(join(skillsDir, 'incomplete-skill', 'README.md'), 'Not a skill');

      const commands = await getCommands(testDir);

      expect(commands.find((c) => c.name === 'incomplete-skill')).toBeUndefined();
    });

    it('ignores files in skills directory (only directories)', async () => {
      await mkdir(skillsDir, { recursive: true });
      await writeFile(join(skillsDir, 'not-a-skill.md'), 'This is a file, not a directory');

      const commands = await getCommands(testDir);
      const skills = commands.filter((c) => c.isSkill);

      expect(skills).toEqual([]);
    });

    it('command takes precedence over skill with same name', async () => {
      // Create a command
      await mkdir(projectCommandsDir, { recursive: true });
      await writeFile(
        join(projectCommandsDir, 'deploy.md'),
        `---
description: Deploy command
---
Deploy now`
      );

      // Create a skill with the same name
      await mkdir(join(skillsDir, 'deploy'), { recursive: true });
      await writeFile(
        join(skillsDir, 'deploy', 'SKILL.md'),
        `---
name: deploy
description: Deploy skill
---
Deploy skill body`
      );

      const commands = await getCommands(testDir);
      const deployItems = commands.filter((c) => c.name === 'deploy');

      expect(deployItems).toHaveLength(1);
      expect(deployItems[0].source).toBe('project'); // Command, not skill
      expect(deployItems[0].isSkill).toBeUndefined();
    });

    it('uses directory name when skill name not specified', async () => {
      await mkdir(join(skillsDir, 'auto-named'), { recursive: true });
      await writeFile(
        join(skillsDir, 'auto-named', 'SKILL.md'),
        `---
description: No name specified
---
Body`
      );

      const commands = await getCommands(testDir);
      const skill = commands.find((c) => c.name === 'auto-named');

      expect(skill).toBeDefined();
      expect(skill.name).toBe('auto-named');
    });
  });

  describe('buildCommandString with skills', () => {
    let skillsDir;

    beforeEach(async () => {
      skillsDir = join(testDir, '.claude', 'skills');
      await rm(skillsDir, { recursive: true, force: true });
    });

    it('substitutes $ARGUMENTS in skill body', async () => {
      await mkdir(join(skillsDir, 'process'), { recursive: true });
      await writeFile(
        join(skillsDir, 'process', 'SKILL.md'),
        `---
name: process
---
Process these: $ARGUMENTS`
      );

      const result = await buildCommandString(testDir, 'process', { _raw: 'file1.txt file2.txt' });

      expect(result).toBe('Process these: file1.txt file2.txt');
    });

    it('substitutes positional args $0, $1, $2', async () => {
      await mkdir(join(skillsDir, 'copy'), { recursive: true });
      await writeFile(
        join(skillsDir, 'copy', 'SKILL.md'),
        `---
name: copy
---
Copy $0 to $1`
      );

      const result = await buildCommandString(testDir, 'copy', { _raw: 'source.txt dest.txt' });

      expect(result).toBe('Copy source.txt to dest.txt');
    });

    it('handles ${ARGUMENTS} brace syntax', async () => {
      await mkdir(join(skillsDir, 'echo'), { recursive: true });
      await writeFile(
        join(skillsDir, 'echo', 'SKILL.md'),
        `---
name: echo
---
Echo: \${ARGUMENTS}`
      );

      const result = await buildCommandString(testDir, 'echo', { _raw: 'hello world' });

      expect(result).toBe('Echo: hello world');
    });

    it('handles empty arguments', async () => {
      await mkdir(join(skillsDir, 'simple'), { recursive: true });
      await writeFile(
        join(skillsDir, 'simple', 'SKILL.md'),
        `---
name: simple
---
Args: $ARGUMENTS (end)`
      );

      const result = await buildCommandString(testDir, 'simple', { _raw: '' });

      expect(result).toBe('Args:  (end)');
    });

    it('handles multiple positional arguments', async () => {
      await mkdir(join(skillsDir, 'multi'), { recursive: true });
      await writeFile(
        join(skillsDir, 'multi', 'SKILL.md'),
        `---
name: multi
---
First: $0, Second: $1, Third: $2, All: $ARGUMENTS`
      );

      const result = await buildCommandString(testDir, 'multi', { _raw: 'one two three' });

      expect(result).toBe('First: one, Second: two, Third: three, All: one two three');
    });
  });
});
