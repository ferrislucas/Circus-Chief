import { readFile, readdir, access, constants } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { parseCommandFile } from './commandParser.js';

/**
 * Check if a working directory matches a plugin's project path
 * Handles git worktrees which are subdirectories of the main repo
 * @param {string} workingDirectory - The current working directory (may be a worktree)
 * @param {string} projectPath - The plugin's configured project path
 * @returns {boolean} True if the directories match
 */
export function isMatchingProject(workingDirectory, projectPath) {
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
 * Discover commands from a directory
 * @param {string} directory - Directory to scan
 * @param {string} source - Source type ('project', 'user', or 'plugin')
 * @param {string} [namespace] - Optional namespace prefix for plugin commands
 * @returns {Promise<Array>} Array of command objects
 */
export async function discoverCommandsFromDir(directory, source, namespace = null) {
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
 * Discover commands from installed plugins
 * Reads ~/.claude/plugins/installed_plugins.json and scans each plugin's commands/ directory
 *
 * @param {string} workingDirectory - Project directory to filter plugins for
 * @returns {Promise<Array>} Array of plugin command objects
 */
export async function discoverPluginCommands(workingDirectory) {
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
