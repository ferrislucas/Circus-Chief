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

  // Create built-in command objects
  const builtinCommands = BUILTIN_COMMANDS.map(cmd => ({
    ...cmd,
    source: 'builtin',
    arguments: [],
  }));

  // Deduplicate: project > user > plugin > builtin
  const seen = new Set();
  const commands = [];

  for (const cmd of projectCommands) {
    if (!seen.has(cmd.name)) {
      seen.add(cmd.name);
      commands.push(cmd);
    }
  }

  for (const cmd of userCommands) {
    if (!seen.has(cmd.name)) {
      seen.add(cmd.name);
      commands.push(cmd);
    }
  }

  for (const cmd of pluginCommands) {
    if (!seen.has(cmd.name)) {
      seen.add(cmd.name);
      commands.push(cmd);
    }
  }

  for (const cmd of builtinCommands) {
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

  // Build argument string
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

export default {
  getCommands,
  getCommand,
  getCommandBody,
  buildCommandString,
  parseCommandFile,
};
