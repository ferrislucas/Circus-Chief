import { readFile, readdir, access, constants } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { parseSkillFile } from './slashCommandDiscovery.js';

/**
 * Check if a working directory matches a plugin's project path
 * Handles git worktrees which are subdirectories of the main repo
 */
function isMatchingProject(workingDirectory, projectPath) {
  if (workingDirectory === projectPath) return true;
  if (workingDirectory.startsWith(`${projectPath}/.worktrees/`)) return true;
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
export async function scanSkillsDirectory(skillsDir, namespace) {
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
 * @param {string} pluginsDir - Path to plugins directory
 * @param {Function} discoverCommandsFromDir - Function to discover commands from a directory
 */
export async function scanPluginsDirForCommands(pluginsDir, discoverCommandsFromDir) {
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
 * Discover commands from installed plugins
 * @param {string} workingDirectory - The project working directory
 * @param {Function} discoverCommandsFromDir - Function to discover commands from a directory
 */
export async function discoverPluginCommands(workingDirectory, discoverCommandsFromDir) {
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
 * Discover skills from installed plugins
 */
export async function discoverPluginSkills(workingDirectory) {
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
export async function discoverMarketplaceSkills() {
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
 * @param {Function} discoverCommandsFromDir - Function to discover commands from a directory
 */
export async function discoverMarketplaceCommands(discoverCommandsFromDir) {
  const marketplaces = await readKnownMarketplaces();
  if (!marketplaces) return [];
  const commands = [];
  for (const [_marketplaceId, marketplace] of Object.entries(marketplaces)) {
    const basePath = marketplace.installLocation;
    if (!basePath) continue;
    for (const subdir of ['plugins', 'external_plugins']) {
      const pluginsDir = join(basePath, subdir);
      const subdirCommands = await scanPluginsDirForCommands(pluginsDir, discoverCommandsFromDir);
      commands.push(...subdirCommands);
    }
  }
  return commands;
}
