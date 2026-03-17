import { readFile } from 'fs/promises';
import {
  parseCommandFile as _parseCommandFile,
  parseSkillFile as _parseSkillFile,
  discoverAllCommands,
} from './slashCommandDiscovery.js';

// Re-export parsing functions so existing consumers continue to work
export const parseCommandFile = _parseCommandFile;
export const parseSkillFile = _parseSkillFile;

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
  return discoverAllCommands(workingDirectory);
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
    return buildSkillCommandString(workingDirectory, name, args);
  }

  // Build argument string for commands
  const argParts = buildArgParts(command, args);

  // Get command body (the actual prompt content)
  const body = await getCommandBody(workingDirectory, name);

  // If there's a body, we need to send it as context
  // The body may contain $ARGUMENTS placeholder for arg substitution
  if (body) {
    return substituteCommandArgs(body, command, args, argParts);
  }

  // Build the full command
  let commandString = `/${name}`;
  if (argParts.length > 0) {
    commandString += ` ${argParts.join(' ')}`;
  }
  return commandString;
}

/**
 * Build argument parts array from command definition and provided args
 */
function buildArgParts(command, args) {
  const argParts = [];
  for (const argDef of command.arguments) {
    const value = args[argDef.name];
    if (value !== undefined && value !== '') {
      if (typeof value === 'string' && value.includes(' ')) {
        argParts.push(`"${value}"`);
      } else {
        argParts.push(String(value));
      }
    }
  }
  return argParts;
}

/**
 * Substitute argument placeholders in command body
 */
function substituteCommandArgs(body, command, args, argParts) {
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

  return processedBody;
}

/**
 * Process $ARGUMENTS and positional args in a skill body
 */
function substituteSkillArgs(body, rawArgs) {
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

/**
 * Build a command string for a skill invocation
 */
async function buildSkillCommandString(workingDirectory, name, args) {
  const body = await getCommandBody(workingDirectory, name);
  if (!body) return `/${name}`;
  const rawArgs = args._raw || '';
  return substituteSkillArgs(body, rawArgs);
}

/**
 * Build a structured skill invocation, separating skill content (for system prompt)
 * from user arguments (for user message).
 *
 * Returns null if the command is not a skill or not found.
 *
 * @param {string} workingDirectory - The project working directory
 * @param {string} name - Skill name
 * @param {Object} args - Arguments object, with _raw for the raw argument string
 * @returns {Promise<{skillContent: string, userMessage: string|null, skillName: string}|null>}
 */
export async function buildSkillInvocation(workingDirectory, name, args = {}) {
  const command = await getCommand(workingDirectory, name);
  if (!command || !command.isSkill) return null;

  const body = await getCommandBody(workingDirectory, name);
  if (!body) return null;

  const rawArgs = args._raw || '';

  return {
    skillContent: substituteSkillArgs(body, rawArgs),
    userMessage: rawArgs.trim() || null,
    skillName: name,
  };
}

/**
 * Build a system prompt that includes skill content as context.
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
 * Returns null if the prompt is not a recognized skill/command.
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

  // Try skill first -- skills take precedence over commands
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
    // Skill lookup failed -- fall through
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
    // Command not found -- fall through
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
