import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
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
  let originalHome;
  let fakeHome;

  beforeAll(async () => {
    // Create a temporary directory for test files
    testDir = join(tmpdir(), `slash-command-test-${Date.now()}`);
    projectCommandsDir = join(testDir, '.claude', 'commands');
    await mkdir(projectCommandsDir, { recursive: true });

    // Isolate from real ~/.claude/plugins to prevent real marketplace plugins
    // from leaking into tests
    originalHome = process.env.HOME;
    fakeHome = join(tmpdir(), `slash-cmd-home-${Date.now()}`);
    await mkdir(fakeHome, { recursive: true });
    process.env.HOME = fakeHome;
  });

  afterAll(async () => {
    // Restore HOME
    process.env.HOME = originalHome;

    // Clean up test directories
    await rm(testDir, { recursive: true, force: true });
    await rm(fakeHome, { recursive: true, force: true });
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

    it('returns the body content of a skill using parseSkillFile', async () => {
      const skillsDir = join(testDir, '.claude', 'skills');
      await mkdir(join(skillsDir, 'review'), { recursive: true });
      await writeFile(
        join(skillsDir, 'review', 'SKILL.md'),
        `---
name: review
description: Review code
argument-hint: "[file]"
user-invocable: true
---
Review the code in $ARGUMENTS`
      );

      const body = await getCommandBody(testDir, 'review');

      expect(body).toBe('Review the code in $ARGUMENTS');
    });

    it('returns skill body (not command body) when both share same name', async () => {
      // Create a command
      await writeFile(
        join(projectCommandsDir, 'deploy.md'),
        `---
description: Deploy command
---
Command body here`
      );

      // Create a skill with the same name
      const skillsDir = join(testDir, '.claude', 'skills');
      await mkdir(join(skillsDir, 'deploy'), { recursive: true });
      await writeFile(
        join(skillsDir, 'deploy', 'SKILL.md'),
        `---
name: deploy
description: Deploy skill
---
Skill body here`
      );

      const body = await getCommandBody(testDir, 'deploy');

      expect(body).toBe('Skill body here'); // Skill wins per Anthropic docs
    });
  });

  describe('buildCommandString', () => {
    beforeEach(async () => {
      await rm(projectCommandsDir, { recursive: true, force: true });
      await mkdir(projectCommandsDir, { recursive: true });
      // Also clean skills dir to avoid leaking from other tests
      await rm(join(testDir, '.claude', 'skills'), { recursive: true, force: true });
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

    it('skill takes precedence over command with same name', async () => {
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
      expect(deployItems[0].source).toBe('project-skill'); // Skill wins per Anthropic docs
      expect(deployItems[0].isSkill).toBe(true);
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

  describe('marketplace plugin discovery', () => {
    let marketplaceDir;
    let originalHome;

    beforeEach(async () => {
      // Save original HOME and set to temp directory so known_marketplaces.json is discovered
      originalHome = process.env.HOME;
      marketplaceDir = join(tmpdir(), `marketplace-test-${Date.now()}`);
      process.env.HOME = marketplaceDir;

      // Clean project commands/skills to avoid interference
      await rm(join(testDir, '.claude', 'commands'), { recursive: true, force: true });
      await mkdir(join(testDir, '.claude', 'commands'), { recursive: true });
      await rm(join(testDir, '.claude', 'skills'), { recursive: true, force: true });
    });

    afterEach(async () => {
      process.env.HOME = originalHome;
      await rm(marketplaceDir, { recursive: true, force: true });
    });

    async function setupMarketplace(structure = {}) {
      const installLocation = join(marketplaceDir, '.claude', 'plugins', 'marketplaces', 'official');
      const knownMarketplacesPath = join(marketplaceDir, '.claude', 'plugins', 'known_marketplaces.json');

      await mkdir(join(marketplaceDir, '.claude', 'plugins'), { recursive: true });
      await writeFile(knownMarketplacesPath, JSON.stringify({
        'official': { installLocation, ...structure.marketplaceProps },
      }));

      return installLocation;
    }

    // Marketplace skill tests

    it('discovers skills from marketplace plugins', async () => {
      const installLocation = await setupMarketplace();
      const skillDir = join(installLocation, 'plugins', 'test-plugin', 'skills', 'test-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), `---
name: test-skill
description: A marketplace skill
argument-hint: "[file]"
---
Process $ARGUMENTS`);

      const commands = await getCommands(testDir);
      const skill = commands.find(c => c.name === 'test-plugin:test-skill');

      expect(skill).toBeDefined();
      expect(skill.source).toBe('plugin-skill');
      expect(skill.isSkill).toBe(true);
      expect(skill.description).toBe('A marketplace skill');
      expect(skill.argumentHint).toBe('[file]');
    });

    it('discovers skills from external_plugins', async () => {
      const installLocation = await setupMarketplace();
      const skillDir = join(installLocation, 'external_plugins', 'ext-plugin', 'skills', 'ext-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), `---
name: ext-skill
description: An external plugin skill
---
Body`);

      const commands = await getCommands(testDir);
      const skill = commands.find(c => c.name === 'ext-plugin:ext-skill');

      expect(skill).toBeDefined();
      expect(skill.source).toBe('plugin-skill');
      expect(skill.isSkill).toBe(true);
      expect(skill.description).toBe('An external plugin skill');
    });

    it('filters out non-user-invocable marketplace skills', async () => {
      const installLocation = await setupMarketplace();
      const skillDir = join(installLocation, 'plugins', 'test-plugin', 'skills', 'hidden');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), `---
name: hidden
description: Model-only skill
user-invocable: false
---
Hidden body`);

      const commands = await getCommands(testDir);
      const skill = commands.find(c => c.name === 'test-plugin:hidden');

      expect(skill).toBeUndefined();
    });

    it('handles missing known_marketplaces.json gracefully', async () => {
      // Don't create known_marketplaces.json — just set HOME to empty temp dir
      await mkdir(join(marketplaceDir, '.claude', 'plugins'), { recursive: true });

      const commands = await getCommands(testDir);
      // Should not throw, just return no marketplace items
      expect(Array.isArray(commands)).toBe(true);
    });

    it('handles marketplace with no plugins directory', async () => {
      // Create known_marketplaces.json pointing to directory with no plugins/ or external_plugins/
      await setupMarketplace();

      const commands = await getCommands(testDir);
      // Should not throw
      expect(Array.isArray(commands)).toBe(true);
    });

    it('marketplace skills are included in getCommands()', async () => {
      const installLocation = await setupMarketplace();
      const skillDir = join(installLocation, 'plugins', 'frontend-design', 'skills', 'frontend-design');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), `---
name: frontend-design
description: Create frontend interfaces
---
Design $ARGUMENTS`);

      const commands = await getCommands(testDir);
      const skill = commands.find(c => c.name === 'frontend-design:frontend-design');

      expect(skill).toBeDefined();
      expect(skill.isSkill).toBe(true);
    });

    // Marketplace command tests

    it('discovers commands from marketplace plugins', async () => {
      const installLocation = await setupMarketplace();
      const commandsDir = join(installLocation, 'plugins', 'test-plugin', 'commands');
      await mkdir(commandsDir, { recursive: true });
      await writeFile(join(commandsDir, 'test.md'), `---
description: A test command
---
Test command body`);

      const commands = await getCommands(testDir);
      const cmd = commands.find(c => c.name === 'test-plugin:test');

      expect(cmd).toBeDefined();
      expect(cmd.source).toBe('plugin');
      expect(cmd.description).toBe('A test command');
    });

    it('discovers commands from external_plugins', async () => {
      const installLocation = await setupMarketplace();
      const commandsDir = join(installLocation, 'external_plugins', 'ext-plugin', 'commands');
      await mkdir(commandsDir, { recursive: true });
      await writeFile(join(commandsDir, 'run.md'), `---
description: An external command
---
Run something`);

      const commands = await getCommands(testDir);
      const cmd = commands.find(c => c.name === 'ext-plugin:run');

      expect(cmd).toBeDefined();
      expect(cmd.source).toBe('plugin');
      expect(cmd.description).toBe('An external command');
    });

    it('marketplace commands are included in getCommands()', async () => {
      const installLocation = await setupMarketplace();
      const commandsDir = join(installLocation, 'plugins', 'code-review', 'commands');
      await mkdir(commandsDir, { recursive: true });
      await writeFile(join(commandsDir, 'review.md'), `---
description: Review code
---
Review the code`);

      const commands = await getCommands(testDir);
      const cmd = commands.find(c => c.name === 'code-review:review');

      expect(cmd).toBeDefined();
    });

    // Deduplication tests

    it('installed_plugins.json skill entries take precedence over marketplace duplicates', async () => {
      const installLocation = await setupMarketplace();

      // Create the same skill in both installed plugins (cache path) and marketplace
      // Set up installed_plugins.json
      const cachePluginPath = join(marketplaceDir, '.claude', 'plugins', 'cache', 'duped-plugin');
      const cacheSkillDir = join(cachePluginPath, 'skills', 'my-skill');
      await mkdir(cacheSkillDir, { recursive: true });
      await writeFile(join(cacheSkillDir, 'SKILL.md'), `---
name: my-skill
description: Installed version
---
Installed body`);

      const installedPluginsPath = join(marketplaceDir, '.claude', 'plugins', 'installed_plugins.json');
      await writeFile(installedPluginsPath, JSON.stringify({
        plugins: {
          'duped-plugin@official': [{
            scope: 'global',
            installPath: cachePluginPath,
          }],
        },
      }));

      // Create same skill in marketplace
      const marketplaceSkillDir = join(installLocation, 'plugins', 'duped-plugin', 'skills', 'my-skill');
      await mkdir(marketplaceSkillDir, { recursive: true });
      await writeFile(join(marketplaceSkillDir, 'SKILL.md'), `---
name: my-skill
description: Marketplace version
---
Marketplace body`);

      const commands = await getCommands(testDir);
      const matches = commands.filter(c => c.name === 'duped-plugin:my-skill');

      expect(matches).toHaveLength(1);
      // The installed_plugins.json version should win (its filePath is in the cache dir)
      expect(matches[0].filePath).toContain('cache');
      expect(matches[0].description).toBe('Installed version');
    });

    it('installed_plugins.json command entries take precedence over marketplace duplicates', async () => {
      const installLocation = await setupMarketplace();

      // Set up installed_plugins.json with commit-commands
      const cachePluginPath = join(marketplaceDir, '.claude', 'plugins', 'cache', 'commit-commands');
      const cacheCommandsDir = join(cachePluginPath, 'commands');
      await mkdir(cacheCommandsDir, { recursive: true });
      await writeFile(join(cacheCommandsDir, 'commit.md'), `---
description: Installed commit command
---
Installed commit body`);

      const installedPluginsPath = join(marketplaceDir, '.claude', 'plugins', 'installed_plugins.json');
      await writeFile(installedPluginsPath, JSON.stringify({
        plugins: {
          'commit-commands@claude-plugins-official': [{
            scope: 'global',
            installPath: cachePluginPath,
          }],
        },
      }));

      // Create same command in marketplace
      const marketplaceCommandsDir = join(installLocation, 'plugins', 'commit-commands', 'commands');
      await mkdir(marketplaceCommandsDir, { recursive: true });
      await writeFile(join(marketplaceCommandsDir, 'commit.md'), `---
description: Marketplace commit command
---
Marketplace commit body`);

      const commands = await getCommands(testDir);
      const matches = commands.filter(c => c.name === 'commit-commands:commit');

      expect(matches).toHaveLength(1);
      expect(matches[0].filePath).toContain('cache');
      expect(matches[0].description).toBe('Installed commit command');
    });

    // Integration test

    it('buildCommandString works with marketplace-discovered skills', async () => {
      const installLocation = await setupMarketplace();
      const skillDir = join(installLocation, 'plugins', 'test-plugin', 'skills', 'process');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), `---
name: process
description: Process files
---
Process these files: $ARGUMENTS`);

      const result = await buildCommandString(testDir, 'test-plugin:process', { _raw: 'file1.txt file2.txt' });

      expect(result).toBe('Process these files: file1.txt file2.txt');
    });
  });
});
