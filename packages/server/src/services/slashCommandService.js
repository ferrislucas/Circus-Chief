import { readFile, readdir, access, constants } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import YAML from 'yaml';

/**
 * Built-in Claude Code commands
 * NOTE: All built-in commands are hidden because they require terminal interaction
 * or don't make sense in the wizard context. Plugin commands are the primary
 * use case for the slash command wizard.
 */
const BUILTIN_COMMANDS = [];

// Command source locations in priority order:
// 1. Project: .claude/commands/*.md
// 2. User: ~/.claude/commands/*.md
// 3. Plugins: ~/.claude/plugins/cache/.../{plugin}/.../commands/*.md
// 4. Built-in: hardcoded list below
const COMMANDS_DIR = '.claude/commands';
const SKILLS_DIR = '.claude/skills';

/**
 * Parse YAML frontmatter from a markdown command file
 * Supports our extended schema with typed arguments
 *
 * @param {string} content - The file content
 * @returns {{ description: string, arguments: Array, body: string }}
 */
export function parseCommandFile(content) {
  // Check for frontmatter
  if (!content.startsWith('---')) {
    // No frontmatter, treat entire content as body
    return {
      description: '',
      arguments: [],
      body: content.trim(),
    };
  }

  // Find end of frontmatter
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    // Malformed frontmatter, treat as body
    return {
      description: '',
      arguments: [],
      body: content.trim(),
    };
  }

  const frontmatterStr = content.slice(3, endIndex).trim();
  const body = content.slice(endIndex + 3).trim();

  try {
    const frontmatter = YAML.parse(frontmatterStr);

    // Validate and normalize arguments schema
    const args = Array.isArray(frontmatter.arguments)
      ? frontmatter.arguments.map(normalizeArgument)
      : [];

    return {
      description: frontmatter.description || '',
      arguments: args,
      body,
    };
  } catch (err) {
    console.warn('Failed to parse command frontmatter:', err.message);
    return {
      description: '',
      arguments: [],
      body: content.trim(),
    };
  }
}

/**
 * Normalize an argument definition to ensure it has all required fields
 * @param {Object} arg - Argument from frontmatter
 * @returns {Object} Normalized argument
 */
function normalizeArgument(arg) {
  if (!arg || typeof arg !== 'object') {
    return null;
  }

  const normalized = {
    name: arg.name || 'unnamed',
    type: ['select', 'text', 'multiline'].includes(arg.type) ? arg.type : 'text',
    label: arg.label || arg.name || 'Unnamed',
    required: arg.required === true,
    placeholder: arg.placeholder || '',
  };

  // Add options for select type
  if (normalized.type === 'select' && Array.isArray(arg.options)) {
    normalized.options = arg.options.map(opt => {
      if (typeof opt === 'string') {
        return { value: opt, label: opt };
      }
      return {
        value: opt.value || opt.label || '',
        label: opt.label || opt.value || '',
      };
    });
  }

  // Add default value if specified
  if (arg.default !== undefined) {
    normalized.default = arg.default;
  }

  return normalized;
}

/**
 * Parse a SKILL.md file with its extended frontmatter
 * @param {string} content - File content
 * @param {string} directoryName - The skill directory name (used as fallback name)
 * @returns {Object} Parsed skill object with name, description, argumentHint, userInvocable, disableModelInvocation, body
 */
export function parseSkillFile(content, directoryName) {
  // Check for frontmatter
  if (!content.startsWith('---')) {
    return {
      name: directoryName,
      description: '',
      argumentHint: null,
      userInvocable: true,
      disableModelInvocation: false,
      body: content.trim(),
    };
  }

  // Find end of frontmatter
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return {
      name: directoryName,
      description: '',
      argumentHint: null,
      userInvocable: true,
      disableModelInvocation: false,
      body: content.trim(),
    };
  }

  const frontmatterStr = content.slice(3, endIndex).trim();
  const body = content.slice(endIndex + 3).trim();

  try {
    const frontmatter = YAML.parse(frontmatterStr);

    return {
      name: frontmatter.name || directoryName,
      description: frontmatter.description || '',
      argumentHint: frontmatter['argument-hint'] || null,
      userInvocable: frontmatter['user-invocable'] !== false,
      disableModelInvocation: frontmatter['disable-model-invocation'] === true,
      body,
    };
  } catch (err) {
    console.warn('Failed to parse skill frontmatter:', err.message);
    return {
      name: directoryName,
      description: '',
      argumentHint: null,
      userInvocable: true,
      disableModelInvocation: false,
      body: content.trim(),
    };
  }
}

/**
 * Discover commands from a directory
 * @param {string} directory - Directory to scan
 * @param {string} source - Source type ('project', 'user', or 'plugin')
 * @param {string} [namespace] - Optional namespace prefix for plugin commands
 * @returns {Promise<Array>} Array of command objects
 */
async function discoverCommandsFromDir(directory, source, namespace = null) {
  const commands = [];

  try {
    // Check if directory exists
    await access(directory, constants.R_OK);

    const files = await readdir(directory);

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const baseName = file.replace(/\.md$/, '');
      // For plugin commands, prefix with namespace (e.g., "commit-commands:commit")
      const name = namespace ? `${namespace}:${baseName}` : baseName;
      const filePath = join(directory, file);

      try {
        const content = await readFile(filePath, 'utf-8');
        const parsed = parseCommandFile(content);

        commands.push({
          name,
          description: parsed.description,
          arguments: parsed.arguments.filter(Boolean),
          source,
          filePath,
        });
      } catch (err) {
        console.warn(`Failed to read command file ${filePath}:`, err.message);
      }
    }
  } catch {
    // Directory doesn't exist or isn't readable - that's fine
  }

  return commands;
}

// Discover skills from a directory
// Scans basePath/.claude/skills/*/SKILL.md
async function discoverSkillsFromDir(basePath, source, namespace = null) {
  const skillsDir = join(basePath, SKILLS_DIR);
  const skills = [];

  try {
    await access(skillsDir, constants.R_OK);
    const entries = await readdir(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = join(skillsDir, entry.name, 'SKILL.md');

      try {
        const content = await readFile(skillMdPath, 'utf-8');
        const parsed = parseSkillFile(content, entry.name);

        // Filter out skills that aren't user-invocable
        if (!parsed.userInvocable) continue;

        // For plugin skills, prefix with namespace (e.g., "plugin-name:skill-name")
        const name = namespace ? `${namespace}:${parsed.name}` : parsed.name;

        skills.push({
          name,
          description: parsed.description,
          arguments: [], // Skills use argument-hint, not structured args
          argumentHint: parsed.argumentHint,
          source,
          filePath: skillMdPath,
          isSkill: true,
          disableModelInvocation: parsed.disableModelInvocation,
        });
      } catch {
        // SKILL.md doesn't exist or isn't readable in this directory
      }
    }
  } catch {
    // Skills directory doesn't exist - that's fine
  }

  return skills;
}

/**
 * Check if a working directory matches a plugin's project path
 * Handles git worktrees which are subdirectories of the main repo
 * @param {string} workingDirectory - The current working directory (may be a worktree)
 * @param {string} projectPath - The plugin's configured project path
 * @returns {boolean} True if the directories match
 */
function isMatchingProject(workingDirectory, projectPath) {
  // Exact match
  if (workingDirectory === projectPath) {
    return true;
  }

  // Check if workingDirectory is a worktree of projectPath
  // Worktrees are typically at: {projectPath}/.worktrees/{session-id}
  if (workingDirectory.startsWith(projectPath + '/.worktrees/')) {
    return true;
  }

  // Check if workingDirectory contains .worktrees and projectPath is the parent
  const worktreeMarker = '/.worktrees/';
  const worktreeIndex = workingDirectory.indexOf(worktreeMarker);
  if (worktreeIndex !== -1) {
    const mainRepoPath = workingDirectory.substring(0, worktreeIndex);
    if (mainRepoPath === projectPath) {
      return true;
    }
  }

  return false;
}

/**
 * Discover commands from installed plugins
 * Reads ~/.claude/plugins/installed_plugins.json and scans each plugin's commands/ directory
 *
 * @param {string} workingDirectory - Project directory to filter plugins for
 * @returns {Promise<Array>} Array of plugin command objects
 */
async function discoverPluginCommands(workingDirectory) {
  const commands = [];
  const installedPluginsPath = join(homedir(), '.claude', 'plugins', 'installed_plugins.json');

  try {
    const content = await readFile(installedPluginsPath, 'utf-8');
    const installedPlugins = JSON.parse(content);

    if (!installedPlugins.plugins) {
      return commands;
    }

    // Iterate through each plugin
    for (const [pluginId, installations] of Object.entries(installedPlugins.plugins)) {
      // Find installation relevant to this project (local scope) or global
      // Handle worktrees by checking if workingDirectory is under the plugin's projectPath
      const relevantInstall = installations.find(
        install => install.scope === 'global' || isMatchingProject(workingDirectory, install.projectPath)
      );

      if (!relevantInstall) continue;

      // Extract namespace from pluginId (e.g., "commit-commands@claude-plugins-official" -> "commit-commands")
      const namespace = pluginId.split('@')[0];

      // Scan the plugin's commands directory
      const pluginCommandsDir = join(relevantInstall.installPath, 'commands');
      const pluginCommands = await discoverCommandsFromDir(pluginCommandsDir, 'plugin', namespace);
      commands.push(...pluginCommands);
    }
  } catch {
    // No installed plugins or file doesn't exist - that's fine
  }

  return commands;
}

/**
 * Discover skills from installed plugins
 * Reads ~/.claude/plugins/installed_plugins.json and scans each plugin's skills/ directory
 *
 * @param {string} workingDirectory - Project directory to filter plugins for
 * @returns {Promise<Array>} Array of plugin skill objects
 */
async function discoverPluginSkills(workingDirectory) {
  const skills = [];
  const installedPluginsPath = join(homedir(), '.claude', 'plugins', 'installed_plugins.json');

  try {
    const content = await readFile(installedPluginsPath, 'utf-8');
    const installedPlugins = JSON.parse(content);

    if (!installedPlugins.plugins) {
      return skills;
    }

    for (const [pluginId, installations] of Object.entries(installedPlugins.plugins)) {
      const relevantInstall = installations.find(
        install => install.scope === 'global' || isMatchingProject(workingDirectory, install.projectPath)
      );

      if (!relevantInstall) continue;

      const namespace = pluginId.split('@')[0];
      const pluginSkillsDir = join(relevantInstall.installPath, 'skills');
      const pluginSkills = await scanSkillsDirectory(pluginSkillsDir, namespace);
      skills.push(...pluginSkills);
    }
  } catch {
    // No installed plugins or file doesn't exist
  }

  return skills;
}

/**
 * Parse a single SKILL.md file and return skill object if valid
 * @param {string} skillMdPath - Path to SKILL.md file
 * @param {string} namespace - Plugin namespace
 * @param {string} directoryName - Skill directory name
 * @returns {Promise<Object|null>} Skill object or null
 */
async function parseSkillFromPath(skillMdPath, namespace, directoryName) {
  try {
    const skillContent = await readFile(skillMdPath, 'utf-8');
    const parsed = parseSkillFile(skillContent, directoryName);
    if (!parsed.userInvocable) return null;

    return {
      name: `${namespace}:${parsed.name}`,
      description: parsed.description,
      arguments: [],
      argumentHint: parsed.argumentHint,
      source: 'plugin-skill',
      filePath: skillMdPath,
      isSkill: true,
      disableModelInvocation: parsed.disableModelInvocation,
    };
  } catch {
    return null;
  }
}

/**
 * Scan a skills directory and return all valid skills
 * @param {string} skillsDir - Path to skills directory
 * @param {string} namespace - Plugin namespace
 * @returns {Promise<Array>} Array of skill objects
 */
async function scanSkillsDirectory(skillsDir, namespace) {
  const skills = [];
  try {
    await access(skillsDir, constants.R_OK);
    const entries = await readdir(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = join(skillsDir, entry.name, 'SKILL.md');
      const skill = await parseSkillFromPath(skillMdPath, namespace, entry.name);
      if (skill) skills.push(skill);
    }
  } catch { /* skills directory doesn't exist */ }
  return skills;
}

/**
 * Scan a plugins directory for skills
 * @param {string} pluginsDir - Path to plugins directory
 * @returns {Promise<Array>} Array of skill objects
 */
async function scanPluginsDirForSkills(pluginsDir) {
  const skills = [];
  try {
    await access(pluginsDir, constants.R_OK);
    const pluginDirs = await readdir(pluginsDir, { withFileTypes: true });

    for (const pluginEntry of pluginDirs) {
      if (!pluginEntry.isDirectory()) continue;
      const namespace = pluginEntry.name;
      const skillsDir = join(pluginsDir, pluginEntry.name, 'skills');
      const pluginSkills = await scanSkillsDirectory(skillsDir, namespace);
      skills.push(...pluginSkills);
    }
  } catch { /* plugins directory doesn't exist */ }
  return skills;
}

/**
 * Discover skills from marketplace plugins
 * Reads ~/.claude/plugins/known_marketplaces.json and scans each marketplace's
 * plugins/ and external_plugins/ directories for skills
 *
 * @returns {Promise<Array>} Array of marketplace skill objects
 */
async function discoverMarketplaceSkills() {
  const skills = [];
  const knownMarketplacesPath = join(homedir(), '.claude', 'plugins', 'known_marketplaces.json');

  try {
    const content = await readFile(knownMarketplacesPath, 'utf-8');
    const marketplaces = JSON.parse(content);

    for (const [_marketplaceId, marketplace] of Object.entries(marketplaces)) {
      const basePath = marketplace.installLocation;
      if (!basePath) continue;

      for (const subdir of ['plugins', 'external_plugins']) {
        const pluginsDir = join(basePath, subdir);
        const subdirSkills = await scanPluginsDirForSkills(pluginsDir);
        skills.push(...subdirSkills);
      }
    }
  } catch { /* no known_marketplaces.json */ }

  return skills;
}

/**
 * Scan a plugins directory for commands
 * @param {string} pluginsDir - Path to plugins directory
 * @returns {Promise<Array>} Array of command objects
 */
async function scanPluginsDirForCommands(pluginsDir) {
  const commands = [];
  try {
    await access(pluginsDir, constants.R_OK);
    const pluginDirs = await readdir(pluginsDir, { withFileTypes: true });

    for (const pluginEntry of pluginDirs) {
      if (!pluginEntry.isDirectory()) continue;
      const namespace = pluginEntry.name;
      const pluginCommandsDir = join(pluginsDir, pluginEntry.name, 'commands');
      const pluginCommands = await discoverCommandsFromDir(pluginCommandsDir, 'plugin', namespace);
      commands.push(...pluginCommands);
    }
  } catch { /* plugins directory doesn't exist */ }
  return commands;
}

/**
 * Discover commands from marketplace plugins
 * Reads ~/.claude/plugins/known_marketplaces.json and scans each marketplace's
 * plugins/ and external_plugins/ directories for commands
 *
 * @returns {Promise<Array>} Array of marketplace command objects
 */
async function discoverMarketplaceCommands() {
  const commands = [];
  const knownMarketplacesPath = join(homedir(), '.claude', 'plugins', 'known_marketplaces.json');

  try {
    const content = await readFile(knownMarketplacesPath, 'utf-8');
    const marketplaces = JSON.parse(content);

    for (const [_marketplaceId, marketplace] of Object.entries(marketplaces)) {
      const basePath = marketplace.installLocation;
      if (!basePath) continue;

      for (const subdir of ['plugins', 'external_plugins']) {
        const pluginsDir = join(basePath, subdir);
        const subdirCommands = await scanPluginsDirForCommands(pluginsDir);
        commands.push(...subdirCommands);
      }
    }
  } catch { /* no known_marketplaces.json */ }

  return commands;
}

/**
 * Get all available slash commands for a working directory
 * Commands are discovered from:
 * 1. Project .claude/commands/ (highest priority)
 * 2. User ~/.claude/commands/
 * 3. Installed plugins
 * 4. Built-in commands (lowest priority)
 *
 * @param {string} workingDirectory - The project working directory
 * @returns {Promise<Array>} Array of command objects
 */
export async function getCommands(workingDirectory) {
  // Discover commands from all sources
  const projectCommands = await discoverCommandsFromDir(
    join(workingDirectory, COMMANDS_DIR),
    'project'
  );

  const userCommands = await discoverCommandsFromDir(
    join(homedir(), COMMANDS_DIR),
    'user'
  );

  const pluginCommands = await discoverPluginCommands(workingDirectory);

  // Discover marketplace plugins (global, not scoped to installed_plugins.json)
  const marketplaceCommands = await discoverMarketplaceCommands();

  // Discover skills from all sources
  const projectSkills = await discoverSkillsFromDir(workingDirectory, 'project-skill');
  const userSkills = await discoverSkillsFromDir(homedir(), 'user-skill');
  const pluginSkills = await discoverPluginSkills(workingDirectory);
  const marketplaceSkills = await discoverMarketplaceSkills();

  // Create built-in command objects
  const builtinCommands = BUILTIN_COMMANDS.map(cmd => ({
    ...cmd,
    source: 'builtin',
    arguments: [],
  }));

  // Skills take precedence over commands with the same name (per Anthropic docs)
  // Priority: project > user > installed-plugin > marketplace; then commands fill remaining slots
  const seen = new Set();
  const commands = [];

  // Add all skills first (they take precedence)
  // installed_plugins.json entries come before marketplace to win dedup
  for (const skill of [...projectSkills, ...userSkills, ...pluginSkills, ...marketplaceSkills]) {
    if (!seen.has(skill.name)) {
      seen.add(skill.name);
      commands.push(skill);
    }
  }

  // Then add commands (only if name not already taken by a skill)
  // installed_plugins.json entries come before marketplace to win dedup
  for (const cmd of [...projectCommands, ...userCommands, ...pluginCommands, ...marketplaceCommands, ...builtinCommands]) {
    if (!seen.has(cmd.name)) {
      seen.add(cmd.name);
      commands.push(cmd);
    }
  }

  return commands;
}

/**
 * Get a single command by name
 * @param {string} workingDirectory - The project working directory
 * @param {string} name - Command name
 * @returns {Promise<Object|null>} Command object or null if not found
 */
export async function getCommand(workingDirectory, name) {
  const commands = await getCommands(workingDirectory);
  return commands.find(cmd => cmd.name === name) || null;
}

/**
 * Get the command body content (the actual prompt to send to Claude)
 * @param {string} workingDirectory - The project working directory
 * @param {string} name - Command name
 * @returns {Promise<string|null>} Command body or null if not found/builtin
 */
export async function getCommandBody(workingDirectory, name) {
  const command = await getCommand(workingDirectory, name);

  if (!command) {
    return null;
  }

  // Built-in commands don't have a body - they're handled by Claude natively
  if (command.source === 'builtin') {
    return null;
  }

  // Read and parse the file to get the body
  try {
    const content = await readFile(command.filePath, 'utf-8');
    if (command.isSkill) {
      const parsed = parseSkillFile(content, command.name);
      return parsed.body;
    }
    const parsed = parseCommandFile(content);
    return parsed.body;
  } catch (err) {
    console.error(`Failed to read command body for ${name}:`, err.message);
    return null;
  }
}

/**
 * Build the command string to send to Claude
 * For built-in commands: "/help", "/compact"
 * For custom commands: "/<name> <args...>" with body content
 *
 * @param {string} workingDirectory - The project working directory
 * @param {string} name - Command name
 * @param {Object} args - Argument values keyed by argument name
 * @returns {Promise<string>} The command string to send
 */
export async function buildCommandString(workingDirectory, name, args = {}) {
  const command = await getCommand(workingDirectory, name);

  if (!command) {
    throw new Error(`Command not found: ${name}`);
  }

  // For built-in commands, just return the slash command
  if (command.source === 'builtin') {
    return `/${name}`;
  }

  // For skills, use different argument substitution
  if (command.isSkill) {
    const body = await getCommandBody(workingDirectory, name);
    if (!body) return `/${name}`;

    // Skills use $ARGUMENTS for all args, $0, $1, etc. for positional
    const rawArgs = args._raw || '';
    let processedBody = body;

    // Replace $ARGUMENTS with raw args string
    processedBody = processedBody
      .replace(/\$\{ARGUMENTS\}/g, rawArgs)
      .replace(/\$ARGUMENTS\b/g, rawArgs);

    // Replace positional args $0, $1, $2, etc.
    const argParts = rawArgs.split(/\s+/).filter(Boolean);
    for (let i = 0; i < argParts.length; i++) {
      processedBody = processedBody
        .replace(new RegExp(`\\$\\{${i}\\}`, 'g'), argParts[i])
        .replace(new RegExp(`\\$${i}\\b`, 'g'), argParts[i]);
    }

    return processedBody;
  }

  // Build argument string for commands
  const argParts = [];
  for (const argDef of command.arguments) {
    const value = args[argDef.name];
    if (value !== undefined && value !== '') {
      // Quote values with spaces
      if (typeof value === 'string' && value.includes(' ')) {
        argParts.push(`"${value}"`);
      } else {
        argParts.push(String(value));
      }
    }
  }

  // Get command body (the actual prompt content)
  const body = await getCommandBody(workingDirectory, name);

  // Build the full command
  let commandString = `/${name}`;
  if (argParts.length > 0) {
    commandString += ` ${argParts.join(' ')}`;
  }

  // If there's a body, we need to send it as context
  // The body may contain $ARGUMENTS placeholder for arg substitution
  if (body) {
    let processedBody = body;

    // Replace argument placeholders like $environment or ${environment}
    for (const argDef of command.arguments) {
      const value = args[argDef.name] || '';
      processedBody = processedBody
        .replace(new RegExp(`\\$\\{${argDef.name}\\}`, 'g'), value)
        .replace(new RegExp(`\\$${argDef.name}\\b`, 'g'), value);
    }

    // If body has $ARGUMENTS, replace with all args
    const allArgsStr = argParts.join(' ');
    processedBody = processedBody
      .replace(/\$\{ARGUMENTS\}/g, allArgsStr)
      .replace(/\$ARGUMENTS\b/g, allArgsStr);

    // Return body with command reference as context
    return processedBody;
  }

  return commandString;
}

/**
 * Build a structured skill invocation, separating skill content (for system prompt)
 * from user arguments (for user message).
 *
 * Returns null if the command is not a skill or not found.
 *
 * @param {string} workingDirectory - The project working directory
 * @param {string} name - Skill name (e.g., "frontend-design" or "frontend-design:frontend-design")
 * @param {Object} args - Arguments object, with _raw for the raw argument string
 * @returns {Promise<{skillContent: string, userMessage: string|null, skillName: string}|null>}
 */
export async function buildSkillInvocation(workingDirectory, name, args = {}) {
  const command = await getCommand(workingDirectory, name);
  if (!command || !command.isSkill) return null;

  const body = await getCommandBody(workingDirectory, name);
  if (!body) return null;

  const rawArgs = args._raw || '';

  // Process $ARGUMENTS and positional args in the body
  let processedBody = body;
  processedBody = processedBody
    .replace(/\$\{ARGUMENTS\}/g, rawArgs)
    .replace(/\$ARGUMENTS\b/g, rawArgs);

  const argParts = rawArgs.split(/\s+/).filter(Boolean);
  for (let i = 0; i < argParts.length; i++) {
    processedBody = processedBody
      .replace(new RegExp(`\\$\\{${i}\\}`, 'g'), argParts[i])
      .replace(new RegExp(`\\$${i}\\b`, 'g'), argParts[i]);
  }

  return {
    skillContent: processedBody,
    userMessage: rawArgs.trim() || null,
    skillName: name,
  };
}

/**
 * Build a system prompt that includes skill content as context.
 * Merges the project system prompt with the skill body wrapped in a <skill> tag.
 *
 * @param {string|null} projectSystemPrompt - The project's custom system prompt
 * @param {{skillContent: string, skillName: string}} skillInvocation - From buildSkillInvocation()
 * @returns {string} Combined system prompt
 */
export function buildSkillSystemPrompt(projectSystemPrompt, skillInvocation) {
  const parts = [];
  if (projectSystemPrompt) {
    parts.push(projectSystemPrompt);
  }
  parts.push(`<skill name="${skillInvocation.skillName}">\n${skillInvocation.skillContent}\n</skill>`);
  return parts.join('\n\n');
}

/**
 * Build the user message for a skill invocation.
 * Returns the user's args if provided, otherwise a default prompt
 * telling Claude the skill was invoked.
 *
 * @param {{userMessage: string|null, skillName: string}} skillInvocation - From buildSkillInvocation()
 * @returns {string} User message to send
 */
export function buildSkillUserMessage(skillInvocation) {
  return skillInvocation.userMessage
    || `The user invoked the /${skillInvocation.skillName} skill. Follow the skill instructions above and ask the user what they would like you to build.`;
}

/**
 * Detect and resolve a skill or command invocation from a prompt string.
 * Returns null if the prompt is not a recognized skill/command (pass it through as plain text).
 *
 * @param {string} workingDirectory - Project working directory for command discovery
 * @param {string} prompt - The user's prompt text
 * @param {string|null} projectSystemPrompt - The project's system prompt
 * @returns {Promise<{type: 'skill'|'command', userMessage: string, systemPrompt: string|null}|null>}
 */
export async function resolvePromptSkillOrCommand(workingDirectory, prompt, projectSystemPrompt) {
  if (!prompt || typeof prompt !== 'string' || !prompt.startsWith('/')) return null;

  const match = prompt.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;

  const [, commandName, rawArgs] = match;

  // Try skill first — skills take precedence over commands
  try {
    const skillInvocation = await buildSkillInvocation(
      workingDirectory, commandName, { _raw: rawArgs || '' }
    );
    if (skillInvocation) {
      return {
        type: 'skill',
        userMessage: buildSkillUserMessage(skillInvocation),
        systemPrompt: buildSkillSystemPrompt(projectSystemPrompt, skillInvocation),
      };
    }
  } catch (err) {
    // Skill lookup failed — fall through
  }

  // Try regular (non-skill) command
  try {
    const commandString = await buildCommandString(workingDirectory, commandName, { _raw: rawArgs || '' });
    if (commandString) {
      return {
        type: 'command',
        userMessage: commandString,
        systemPrompt: projectSystemPrompt || null,
      };
    }
  } catch (err) {
    // Command not found — fall through
  }

  return null;
}

export default {
  getCommands,
  getCommand,
  getCommandBody,
  buildCommandString,
  buildSkillInvocation,
  buildSkillSystemPrompt,
  buildSkillUserMessage,
  resolvePromptSkillOrCommand,
  parseCommandFile,
  parseSkillFile,
};
