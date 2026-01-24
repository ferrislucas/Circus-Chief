import { readFile, readdir, access, constants } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import YAML from 'yaml';

/**
 * Built-in commands are no longer exposed through the slash command system.
 * Claude Code handles built-in commands like /help and /compact internally.
 * This service now only discovers custom commands from project and user directories.
 */
const BUILTIN_COMMANDS = [];

/**
 * Command source locations in priority order:
 * 1. Project: .claude/commands/*.md
 * 2. User: ~/.claude/commands/*.md
 * 3. Built-in: hardcoded list above
 */
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
 * @param {string} source - Source type ('project' or 'user')
 * @returns {Promise<Array>} Array of command objects
 */
async function discoverCommandsFromDir(directory, source) {
  const commands = [];

  try {
    // Check if directory exists
    await access(directory, constants.R_OK);

    const files = await readdir(directory);

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const name = file.replace(/\.md$/, '');
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
 * Get all available slash commands for a working directory
 * Commands are deduplicated by name, with project commands taking priority
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

  // Deduplicate: project > user > builtin
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

  for (const cmd of BUILTIN_COMMANDS) {
    if (!seen.has(cmd.name)) {
      seen.add(cmd.name);
      commands.push({ ...cmd });
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
