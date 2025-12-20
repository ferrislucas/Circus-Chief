import { readdir, readFile } from 'fs/promises';
import { homedir } from 'os';
import { join, basename } from 'path';

/**
 * @typedef {Object} SlashCommand
 * @property {string} name - Command name without slash
 * @property {'builtin' | 'project' | 'user'} source
 * @property {string} [description] - From YAML frontmatter
 * @property {string} [argumentHint] - From 'argument-hint' in frontmatter
 * @property {string} [content] - Markdown body for custom commands
 */

/**
 * Built-in commands available in all sessions
 */
const BUILTIN_COMMANDS = [
  { name: 'help', source: 'builtin', description: 'Display help information' },
  { name: 'clear', source: 'builtin', description: 'Clear conversation history' },
  { name: 'compact', source: 'builtin', description: 'Compress conversation context' },
  { name: 'model', source: 'builtin', description: 'Switch AI model', argumentHint: 'model-name' },
  { name: 'mode', source: 'builtin', description: 'Switch execution mode', argumentHint: 'plan|standard|yolo' },
  { name: 'config', source: 'builtin', description: 'Open configuration' },
  { name: 'status', source: 'builtin', description: 'Show session status' },
  { name: 'cost', source: 'builtin', description: 'Display token usage' },
  { name: 'stop', source: 'builtin', description: 'Stop current session' },
];

/**
 * Parse YAML frontmatter from a markdown file content
 * @param {string} content - Raw file content
 * @returns {{ frontmatter: Object, body: string }}
 */
export function parseCommandFile(content) {
  // Match frontmatter delimited by --- lines
  // Allows for empty frontmatter (---\n---)
  const match = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content.trim() };
  }

  // Handle empty frontmatter section
  const frontmatterContent = match[1].trim();
  if (!frontmatterContent) {
    return { frontmatter: {}, body: match[2].trim() };
  }

  const frontmatter = {};
  const lines = match[1].split(/\r?\n/);

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();

    // Remove surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key) {
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body: match[2].trim() };
}

/**
 * Read commands from a directory
 * @param {string} directory - Path to commands directory
 * @param {'project' | 'user'} source - Command source type
 * @returns {Promise<SlashCommand[]>}
 */
async function readCommandsFromDirectory(directory, source) {
  const commands = [];

  try {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

      const filePath = join(directory, entry.name);
      const name = basename(entry.name, '.md');

      try {
        const content = await readFile(filePath, 'utf-8');
        const { frontmatter, body } = parseCommandFile(content);

        commands.push({
          name,
          source,
          description: frontmatter.description || undefined,
          argumentHint: frontmatter['argument-hint'] || undefined,
          content: body || undefined,
        });
      } catch (err) {
        // Skip files that can't be read
        console.warn(`Failed to read command file ${filePath}:`, err.message);
      }
    }
  } catch (err) {
    // Directory doesn't exist or can't be read - that's fine
    if (err.code !== 'ENOENT' && err.code !== 'EACCES') {
      console.warn(`Failed to read commands directory ${directory}:`, err.message);
    }
  }

  return commands;
}

/**
 * Get all available slash commands for a working directory
 * @param {string} workingDirectory - Project working directory
 * @returns {Promise<SlashCommand[]>}
 */
export async function getCommands(workingDirectory) {
  const commands = [...BUILTIN_COMMANDS];

  // Read project-level commands
  if (workingDirectory) {
    const projectCommandsDir = join(workingDirectory, '.claude', 'commands');
    const projectCommands = await readCommandsFromDirectory(projectCommandsDir, 'project');
    commands.push(...projectCommands);
  }

  // Read user-level commands
  const userCommandsDir = join(homedir(), '.claude', 'commands');
  const userCommands = await readCommandsFromDirectory(userCommandsDir, 'user');
  commands.push(...userCommands);

  // Deduplicate by name (project overrides user, user overrides builtin)
  const commandMap = new Map();
  for (const cmd of commands) {
    const existing = commandMap.get(cmd.name);
    if (!existing || getPriority(cmd.source) > getPriority(existing.source)) {
      commandMap.set(cmd.name, cmd);
    }
  }

  return Array.from(commandMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get priority for deduplication (higher = wins)
 * @param {'builtin' | 'project' | 'user'} source
 * @returns {number}
 */
function getPriority(source) {
  switch (source) {
    case 'project': return 3;
    case 'user': return 2;
    case 'builtin': return 1;
    default: return 0;
  }
}

/**
 * Get a specific command by name
 * @param {string} workingDirectory - Project working directory
 * @param {string} name - Command name
 * @returns {Promise<SlashCommand | null>}
 */
export async function getCommand(workingDirectory, name) {
  const commands = await getCommands(workingDirectory);
  return commands.find(cmd => cmd.name === name) || null;
}

export default {
  getCommands,
  getCommand,
  parseCommandFile,
  BUILTIN_COMMANDS,
};
