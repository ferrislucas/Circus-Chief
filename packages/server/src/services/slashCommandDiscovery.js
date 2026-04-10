import { readFile, readdir, access, constants } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import YAML from 'yaml';
import {
  discoverPluginCommands,
  discoverPluginSkills,
  discoverMarketplaceCommands,
  discoverMarketplaceSkills,
} from './slashCommandPluginDiscovery.js';

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
    return { description: '', arguments: [], body: content.trim() };
  }

  // Find end of frontmatter
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return { description: '', arguments: [], body: content.trim() };
  }

  const frontmatterStr = content.slice(3, endIndex).trim();
  const body = content.slice(endIndex + 3).trim();

  try {
    const frontmatter = YAML.parse(frontmatterStr);
    const args = Array.isArray(frontmatter.arguments)
      ? frontmatter.arguments.map(normalizeArgument)
      : [];
    return { description: frontmatter.description || '', arguments: args, body };
  } catch (err) {
    console.warn('Failed to parse command frontmatter:', err.message);
    return { description: '', arguments: [], body: content.trim() };
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

  if (normalized.type === 'select' && Array.isArray(arg.options)) {
    normalized.options = arg.options.map(opt => {
      if (typeof opt === 'string') return { value: opt, label: opt };
      return {
        value: opt.value || opt.label || '',
        label: opt.label || opt.value || '',
      };
    });
  }

  if (arg.default !== undefined) {
    normalized.default = arg.default;
  }

  return normalized;
}

/**
 * Parse a SKILL.md file with its extended frontmatter
 * @param {string} content - File content
 * @param {string} directoryName - The skill directory name (used as fallback name)
 * @returns {Object} Parsed skill object
 */
export function parseSkillFile(content, directoryName) {
  const defaults = {
    name: directoryName,
    description: '',
    argumentHint: null,
    userInvocable: true,
    disableModelInvocation: false,
  };

  if (!content.startsWith('---')) {
    return { ...defaults, body: content.trim() };
  }

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return { ...defaults, body: content.trim() };
  }

  const frontmatterStr = content.slice(3, endIndex).trim();
  const body = content.slice(endIndex + 3).trim();

  try {
    const fm = YAML.parse(frontmatterStr);
    return {
      name: fm.name || directoryName,
      description: fm.description || '',
      argumentHint: fm['argument-hint'] || null,
      userInvocable: fm['user-invocable'] !== false,
      disableModelInvocation: fm['disable-model-invocation'] === true,
      body,
    };
  } catch (err) {
    console.warn('Failed to parse skill frontmatter:', err.message);
    return { ...defaults, body: content.trim() };
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
    await access(directory, constants.R_OK);
    const files = await readdir(directory);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const baseName = file.replace(/\.md$/, '');
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
    // Directory doesn't exist or isn't readable
  }
  return commands;
}

/**
 * Discover skills from a directory
 * Scans basePath/.claude/skills/SKILL.md
 */
async function readSkillEntry(skillsDir, entryName, source, namespace) {
  const skillMdPath = join(skillsDir, entryName, 'SKILL.md');
  try {
    const content = await readFile(skillMdPath, 'utf-8');
    const parsed = parseSkillFile(content, entryName);
    if (!parsed.userInvocable) return null;
    const name = namespace ? `${namespace}:${parsed.name}` : parsed.name;
    return {
      name,
      description: parsed.description,
      arguments: [],
      argumentHint: parsed.argumentHint,
      source,
      filePath: skillMdPath,
      isSkill: true,
      disableModelInvocation: parsed.disableModelInvocation,
    };
  } catch {
    // SKILL.md doesn't exist or isn't readable
    return null;
  }
}

async function discoverSkillsFromDir(basePath, source, namespace = null) {
  const skillsDir = join(basePath, SKILLS_DIR);
  const skills = [];
  try {
    await access(skillsDir, constants.R_OK);
    const entries = await readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skill = await readSkillEntry(skillsDir, entry.name, source, namespace);
      if (skill) skills.push(skill);
    }
  } catch {
    // Skills directory doesn't exist
  }
  return skills;
}

/**
 * Discover all commands and skills for a working directory from all sources.
 * Returns deduplicated list with skills taking precedence over commands.
 *
 * @param {string} workingDirectory - The project working directory
 * @returns {Promise<Array>} Array of command/skill objects
 */
export async function discoverAllCommands(workingDirectory) {
  const projectCommands = await discoverCommandsFromDir(
    join(workingDirectory, COMMANDS_DIR), 'project'
  );
  const userCommands = await discoverCommandsFromDir(
    join(homedir(), COMMANDS_DIR), 'user'
  );
  const pluginCommands = await discoverPluginCommands(workingDirectory, discoverCommandsFromDir);
  const marketplaceCommands = await discoverMarketplaceCommands(discoverCommandsFromDir);
  const projectSkills = await discoverSkillsFromDir(workingDirectory, 'project-skill');
  const userSkills = await discoverSkillsFromDir(homedir(), 'user-skill');
  const pluginSkills = await discoverPluginSkills(workingDirectory);
  const marketplaceSkills = await discoverMarketplaceSkills();

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
  for (const cmd of [...projectCommands, ...userCommands, ...pluginCommands, ...marketplaceCommands]) {
    if (!seen.has(cmd.name)) {
      seen.add(cmd.name);
      commands.push(cmd);
    }
  }

  return commands;
}
