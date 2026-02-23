import { readFile, readdir, access, constants } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { parseSkillFile } from './commandParser.js';
import { isMatchingProject } from './commandDiscovery.js';

const SKILLS_DIR = '.claude/skills';

// Discover skills from a directory
// Scans basePath/.claude/skills/*/SKILL.md
export async function discoverSkillsFromDir(basePath, source, namespace = null) {
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
 * Discover skills from installed plugins
 * Reads ~/.claude/plugins/installed_plugins.json and scans each plugin's skills/ directory
 *
 * @param {string} workingDirectory - Project directory to filter plugins for
 * @returns {Promise<Array>} Array of plugin skill objects
 */
export async function discoverPluginSkills(workingDirectory) {
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

      // Scan skills directory inside plugin
      const pluginSkillsDir = join(relevantInstall.installPath, 'skills');

      try {
        await access(pluginSkillsDir, constants.R_OK);
        const entries = await readdir(pluginSkillsDir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const skillMdPath = join(pluginSkillsDir, entry.name, 'SKILL.md');

          try {
            const content = await readFile(skillMdPath, 'utf-8');
            const parsed = parseSkillFile(content, entry.name);

            if (!parsed.userInvocable) continue;

            skills.push({
              name: `${namespace}:${parsed.name}`,
              description: parsed.description,
              arguments: [],
              argumentHint: parsed.argumentHint,
              source: 'plugin-skill',
              filePath: skillMdPath,
              isSkill: true,
              disableModelInvocation: parsed.disableModelInvocation,
            });
          } catch {
            // SKILL.md doesn't exist in this directory
          }
        }
      } catch {
        // Plugin has no skills directory
      }
    }
  } catch {
    // No installed plugins or file doesn't exist
  }

  return skills;
}
