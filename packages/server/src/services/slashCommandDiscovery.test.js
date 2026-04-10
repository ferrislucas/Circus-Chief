import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseCommandFile, parseSkillFile, discoverAllCommands } from './slashCommandDiscovery.js';

// Mock the plugin discovery module so tests don't depend on real ~/.claude/plugins
vi.mock('./slashCommandPluginDiscovery.js', () => ({
  discoverPluginCommands: vi.fn().mockResolvedValue([]),
  discoverPluginSkills: vi.fn().mockResolvedValue([]),
  discoverMarketplaceCommands: vi.fn().mockResolvedValue([]),
  discoverMarketplaceSkills: vi.fn().mockResolvedValue([]),
}));

describe('slashCommandDiscovery', () => {
  // --- parseCommandFile ---
  describe('parseCommandFile', () => {
    it('exports parseCommandFile as a function with arity 1', () => {
      expect(typeof parseCommandFile).toBe('function');
      expect(parseCommandFile.length).toBe(1);
    });

    it('parses a command file with YAML frontmatter', () => {
      const content = `---
description: Deploy the app
arguments:
  - name: env
    type: select
    label: Environment
    required: true
    options:
      - staging
      - production
---
Deploy to $ARGUMENTS.env`;

      const result = parseCommandFile(content);

      expect(result.description).toBe('Deploy the app');
      expect(result.body).toBe('Deploy to $ARGUMENTS.env');
      expect(result.arguments).toHaveLength(1);
      expect(result.arguments[0].name).toBe('env');
      expect(result.arguments[0].type).toBe('select');
      expect(result.arguments[0].required).toBe(true);
      expect(result.arguments[0].options).toEqual([
        { value: 'staging', label: 'staging' },
        { value: 'production', label: 'production' },
      ]);
    });

    it('returns empty description and arguments when no frontmatter', () => {
      const content = 'Just a plain command body';
      const result = parseCommandFile(content);

      expect(result.description).toBe('');
      expect(result.arguments).toEqual([]);
      expect(result.body).toBe('Just a plain command body');
    });

    it('handles unclosed frontmatter gracefully', () => {
      const content = '---\ndescription: incomplete\nBody text here';
      const result = parseCommandFile(content);

      expect(result.description).toBe('');
      expect(result.arguments).toEqual([]);
      expect(result.body).toBe(content.trim());
    });

    it('handles malformed YAML gracefully', () => {
      const content = '---\n: [invalid yaml\n---\nBody';
      const result = parseCommandFile(content);

      // Should fall back to defaults
      expect(result.description).toBe('');
      expect(result.arguments).toEqual([]);
      expect(result.body).toBe(content.trim());
    });

    it('parses multi-arg commands', () => {
      const content = `---
description: Multi-arg command
arguments:
  - name: first
    type: text
    label: First Arg
    required: true
    placeholder: Enter first
  - name: second
    type: multiline
    label: Second Arg
    required: false
    default: hello
---
Use $ARGUMENTS.first and $ARGUMENTS.second`;

      const result = parseCommandFile(content);

      expect(result.arguments).toHaveLength(2);
      expect(result.arguments[0].name).toBe('first');
      expect(result.arguments[0].type).toBe('text');
      expect(result.arguments[0].placeholder).toBe('Enter first');
      expect(result.arguments[1].name).toBe('second');
      expect(result.arguments[1].type).toBe('multiline');
      expect(result.arguments[1].default).toBe('hello');
    });

    it('normalizes unknown argument types to text', () => {
      const content = `---
description: Unknown type
arguments:
  - name: foo
    type: unknown_type
---
Body`;

      const result = parseCommandFile(content);
      expect(result.arguments[0].type).toBe('text');
    });

    it('filters out null arguments from non-object entries', () => {
      const content = `---
description: Bad args
arguments:
  - not an object
  - name: valid
    type: text
---
Body`;

      const result = parseCommandFile(content);
      // null entries are filtered by discoverCommandsFromDir (`.filter(Boolean)`)
      // but parseCommandFile itself maps them
      expect(result.arguments).toHaveLength(2);
      expect(result.arguments[0]).toBeNull();
      expect(result.arguments[1].name).toBe('valid');
    });
  });

  // --- parseSkillFile ---
  describe('parseSkillFile', () => {
    it('exports parseSkillFile as a function with arity 2', () => {
      expect(typeof parseSkillFile).toBe('function');
      expect(parseSkillFile.length).toBe(2);
    });

    it('parses a skill file with frontmatter', () => {
      const content = `---
name: my-skill
description: A test skill
argument-hint: <file_path>
---
Skill instructions here`;

      const result = parseSkillFile(content, 'fallback-name');

      expect(result.name).toBe('my-skill');
      expect(result.description).toBe('A test skill');
      expect(result.argumentHint).toBe('<file_path>');
      expect(result.userInvocable).toBe(true);
      expect(result.disableModelInvocation).toBe(false);
      expect(result.body).toBe('Skill instructions here');
    });

    it('uses directory name as fallback when no frontmatter', () => {
      const content = 'Plain skill body';
      const result = parseSkillFile(content, 'dir-name');

      expect(result.name).toBe('dir-name');
      expect(result.description).toBe('');
      expect(result.body).toBe('Plain skill body');
    });

    it('respects user-invocable: false', () => {
      const content = `---
name: hidden-skill
user-invocable: false
---
Hidden body`;

      const result = parseSkillFile(content, 'hidden');
      expect(result.userInvocable).toBe(false);
    });

    it('respects disable-model-invocation: true', () => {
      const content = `---
name: no-model
disable-model-invocation: true
---
Body`;

      const result = parseSkillFile(content, 'no-model');
      expect(result.disableModelInvocation).toBe(true);
    });

    it('handles malformed YAML gracefully', () => {
      const content = '---\n: [bad yaml\n---\nBody';
      const result = parseSkillFile(content, 'fallback');

      expect(result.name).toBe('fallback');
      expect(result.description).toBe('');
    });
  });

  // --- discoverAllCommands ---
  describe('discoverAllCommands', () => {
    let testDir;
    let originalHome;
    let fakeHome;

    beforeAll(async () => {
      testDir = join(tmpdir(), `slash-discovery-test-${Date.now()}`);
      await mkdir(join(testDir, '.claude', 'commands'), { recursive: true });

      // Write a project command
      await writeFile(
        join(testDir, '.claude', 'commands', 'deploy.md'),
        `---
description: Deploy command
---
Deploy the app`,
      );

      // Write another command
      await writeFile(
        join(testDir, '.claude', 'commands', 'test.md'),
        'Run the tests',
      );

      // Isolate from real HOME
      originalHome = process.env.HOME;
      fakeHome = join(tmpdir(), `slash-discovery-home-${Date.now()}`);
      await mkdir(fakeHome, { recursive: true });
      process.env.HOME = fakeHome;
    });

    afterAll(async () => {
      process.env.HOME = originalHome;
      await rm(testDir, { recursive: true, force: true });
      await rm(fakeHome, { recursive: true, force: true });
    });

    it('exports discoverAllCommands as a function with arity 1', () => {
      expect(typeof discoverAllCommands).toBe('function');
      expect(discoverAllCommands.length).toBe(1);
    });

    it('discovers known commands from a project directory', async () => {
      const commands = await discoverAllCommands(testDir);

      const names = commands.map((c) => c.name);
      expect(names).toContain('deploy');
      expect(names).toContain('test');
    });

    it('returns command objects with expected shape', async () => {
      const commands = await discoverAllCommands(testDir);
      const deploy = commands.find((c) => c.name === 'deploy');

      expect(deploy).toBeDefined();
      expect(deploy.description).toBe('Deploy command');
      expect(deploy.source).toBe('project');
      expect(deploy.filePath).toBe(join(testDir, '.claude', 'commands', 'deploy.md'));
      expect(Array.isArray(deploy.arguments)).toBe(true);
    });

    it('returns empty array when directory is missing', async () => {
      const commands = await discoverAllCommands('/nonexistent/path');
      expect(commands).toEqual([]);
    });

    it('ignores non-.md files in commands directory', async () => {
      // Write a non-.md file
      await writeFile(join(testDir, '.claude', 'commands', 'readme.txt'), 'not a command');

      const commands = await discoverAllCommands(testDir);
      const names = commands.map((c) => c.name);
      expect(names).not.toContain('readme');
      expect(names).not.toContain('readme.txt');
    });
  });
});
