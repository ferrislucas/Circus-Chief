import { join } from 'path';
import { homedir } from 'os';
import { parseCommandFile, parseSkillFile } from './commandParser.js';
import { discoverCommandsFromDir, discoverPluginCommands } from './commandDiscovery.js';
import { discoverSkillsFromDir, discoverPluginSkills } from './skillDiscovery.js';
import { buildCommandStringFromParts, readCommandBody } from './commandBuilder.js';

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

  // Discover skills from all sources
  const projectSkills = await discoverSkillsFromDir(workingDirectory, 'project-skill');
  const userSkills = await discoverSkillsFromDir(homedir(), 'user-skill');
  const pluginSkills = await discoverPluginSkills(workingDirectory);

  // Create built-in command objects
  const builtinCommands = BUILTIN_COMMANDS.map(cmd => ({
    ...cmd,
    source: 'builtin',
    arguments: [],
  }));

  // Deduplicate: commands take precedence over skills with same name
  // Priority: project > user > plugin > builtin
  const seen = new Set();
  const commands = [];

  // Add all commands first (they take precedence)
  for (const cmd of [...projectCommands, ...userCommands, ...pluginCommands, ...builtinCommands]) {
    if (!seen.has(cmd.name)) {
      seen.add(cmd.name);
      commands.push(cmd);
    }
  }

  // Then add skills (only if name not already taken by a command)
  for (const skill of [...projectSkills, ...userSkills, ...pluginSkills]) {
    if (!seen.has(skill.name)) {
      seen.add(skill.name);
      commands.push(skill);
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

  return readCommandBody(command, name);
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

  const body = await getCommandBody(workingDirectory, name);

  return buildCommandStringFromParts(command, body, name, args);
}

// Re-export parsing functions so existing imports continue to work
export { parseCommandFile, parseSkillFile };

export default {
  getCommands,
  getCommand,
  getCommandBody,
  buildCommandString,
  parseCommandFile,
  parseSkillFile,
};
