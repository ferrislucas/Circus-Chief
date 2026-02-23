import { readFile } from 'fs/promises';
import { parseCommandFile } from './commandParser.js';

/**
 * Build the command string to send to Claude
 * For built-in commands: "/help", "/compact"
 * For custom commands: "/<name> <args...>" with body content
 *
 * @param {Object} command - The resolved command object
 * @param {string|null} body - The command body content (null for builtins)
 * @param {string} name - Command name
 * @param {Object} args - Argument values keyed by argument name
 * @returns {string} The command string to send
 */
export function buildCommandStringFromParts(command, body, name, args = {}) {
  // For built-in commands, just return the slash command
  if (command.source === 'builtin') {
    return `/${name}`;
  }

  // For skills, use different argument substitution
  if (command.isSkill) {
    if (!body) return `/${name}`;

    // Skills use $ARGUMENTS for all args, $0, $1, etc. for positional
    const rawArgs = args._raw || '';
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

  // Build argument string for commands
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

/**
 * Get command body content by reading the file and parsing it
 * @param {Object} command - The resolved command object
 * @param {string} name - Command name (for error messages)
 * @returns {Promise<string|null>} Command body or null
 */
export async function readCommandBody(command, name) {
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
