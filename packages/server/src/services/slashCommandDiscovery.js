import { readFile, readdir, access, constants } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import YAML from 'yaml';

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
        if (!parsed.userInvocable) continue;
        const name = namespace ? `${namespace}:${parsed.name}` : parsed.name;
        skills.push({
          name,
          description: parsed.description,
          arguments: [],
          argumentHint: parsed.argumentHint,
          source,
          filePath: skillMdPath,
          isSkill: true,
          disableModelInvocation: parsed.disableModelInvocation,
        });
      } catch {
        // SKILL.md doesn't exist or isn't readable
      }
    }
  } catch {
    // Skills directory doesn't exist
  }
  return skills;
}

/**
 * Check if a working directory matches a plugin's project path
 * Handles git worktrees which are subdirectories of the main repo
 */
function isMatchingProject(workingDirectory, projectPath) {
  if (workingDirectory === projectPath) return true;
  if (workingDirectory.startsWith(projectPath + '/.worktrees/')) return true;
  const worktreeMarker = '/.worktrees/';
  const worktreeIndex = workingDirectory.indexOf(worktreeMarker);
  if (worktreeIndex !== -1) {
    const mainRepoPath = workingDirectory.substring(0, worktreeIndex);
    if (mainRepoPath === projectPath) return true;
  }
  return false;
}

/**
 * Find the relevant plugin installation for a given working directory
 */
function findRelevantInstall(installations, workingDirectory) {
  return installations.find(
    install => install.scope === 'global' || isMatchingProject(workingDirectory, install.projectPath)
  );
}

/**
 * Read and parse the installed_plugins.json file
 * @returns {Promise<Object|null>} Parsed plugins object or null
 */
async function readInstalledPlugins() {
  try {
    const path = join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
    const content = await readFile(path, 'utf-8');
    const data = JSON.parse(content);
    return data.plugins || null;
  } catch {
    return null;
  }
}

/**
 * Discover commands from installed plugins
 */
async function discoverPluginCommands(workingDirectory) {
  const plugins = await readInstalledPlugins();
  if (!plugins) return [];
  const commands = [];
  for (const [pluginId, installations] of Object.entries(plugins)) {
    const relevantInstall = findRelevantInstall(installations, workingDirectory);
    if (!relevantInstall) continue;
    const namespace = pluginId.split('@')[0];
    const pluginCommandsDir = join(relevantInstall.installPath, 'commands');
    const pluginCommands = await discoverCommandsFromDir(pluginCommandsDir, 'plugin', namespace);
    commands.push(...pluginCommands);
  }
  return commands;
}

/**
 * Parse a single SKILL.md file and return skill object if valid
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
 * Scan a plugins directory for commands
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
 * Read and parse the known_marketplaces.json file
 * @returns {Promise<Object|null>} Parsed marketplaces object or null
 */
async function readKnownMarketplaces() {
  try {
    const path = join(homedir(), '.claude', 'plugins', 'known_marketplaces.json');
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Discover skills from installed plugins
 */
async function discoverPluginSkills(workingDirectory) {
  const plugins = await readInstalledPlugins();
  if (!plugins) return [];
  const skills = [];
  for (const [pluginId, installations] of Object.entries(plugins)) {
    const relevantInstall = findRelevantInstall(installations, workingDirectory);
    if (!relevantInstall) continue;
    const namespace = pluginId.split('@')[0];
    const pluginSkillsDir = join(relevantInstall.installPath, 'skills');
    const pluginSkills = await scanSkillsDirectory(pluginSkillsDir, namespace);
    skills.push(...pluginSkills);
  }
  return skills;
}

/**
 * Discover skills from marketplace plugins
 */
async function discoverMarketplaceSkills() {
  const marketplaces = await readKnownMarketplaces();
  if (!marketplaces) return [];
  const skills = [];
  for (const [_marketplaceId, marketplace] of Object.entries(marketplaces)) {
    const basePath = marketplace.installLocation;
    if (!basePath) continue;
    for (const subdir of ['plugins', 'external_plugins']) {
      const pluginsDir = join(basePath, subdir);
      const subdirSkills = await scanPluginsDirForSkills(pluginsDir);
      skills.push(...subdirSkills);
    }
  }
  return skills;
}

/**
 * Discover commands from marketplace plugins
 */
async function discoverMarketplaceCommands() {
  const marketplaces = await readKnownMarketplaces();
  if (!marketplaces) return [];
  const commands = [];
  for (const [_marketplaceId, marketplace] of Object.entries(marketplaces)) {
    const basePath = marketplace.installLocation;
    if (!basePath) continue;
    for (const subdir of ['plugins', 'external_plugins']) {
      const pluginsDir = join(basePath, subdir);
      const subdirCommands = await scanPluginsDirForCommands(pluginsDir);
      commands.push(...subdirCommands);
    }
  }
  return commands;
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
  const pluginCommands = await discoverPluginCommands(workingDirectory);
  const marketplaceCommands = await discoverMarketplaceCommands();
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
