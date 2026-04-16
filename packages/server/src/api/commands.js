import { Router } from 'express';
import { sessions, projects } from '../database.js';
import * as slashCommandService from '../services/slashCommandService.js';
import { continueSession } from '../services/sessionManager.js';

const router = Router();

/**
 * GET /api/commands
 * List all available slash commands for a directory
 *
 * Discovers commands from:
 * - Project .claude/commands/ folder
 * - User ~/.claude/commands/ folder
 * - Installed plugins
 * - Built-in Claude Code commands
 *
 * Query params:
 *   - directory: Working directory to discover commands from (required)
 */
router.get('/', async (req, res) => {
  const { directory } = req.query;

  if (!directory) {
    return res.status(400).json({ error: 'directory query parameter is required' });
  }

  try {
    const commands = await slashCommandService.getCommands(directory);
    res.json(commands);
  } catch (err) {
    console.error('Error getting commands:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/commands/:name
 * Get a single command's details
 *
 * Query params:
 *   - directory: Working directory to discover commands from (required)
 */
router.get('/:name', async (req, res) => {
  const { directory } = req.query;
  const { name } = req.params;

  if (!directory) {
    return res.status(400).json({ error: 'directory query parameter is required' });
  }

  try {
    const command = await slashCommandService.getCommand(directory, name);

    if (!command) {
      return res.status(404).json({ error: `Command not found: ${name}` });
    }

    res.json(command);
  } catch (err) {
    console.error('Error getting command:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/commands/:name/execute
 * Execute a slash command in a session
 *
 * Body:
 *   - sessionId: Session to execute command in (required)
 *   - args: Object with argument values keyed by argument name (optional)
 */
/**
 * Handle execution of a skill invocation (skill body -> system prompt, args -> user message).
 * Returns the response payload, or null if the command is not a skill.
 */
async function handleSkillExecution({ workingDirectory, name, args, sessionId, project }) {
  const skillInvocation = await slashCommandService.buildSkillInvocation(
    workingDirectory, name, args
  );

  if (!skillInvocation) return null;

  const skillSystemPrompt = slashCommandService.buildSkillSystemPrompt(
    project.systemPrompt || null, skillInvocation
  );
  const userMessage = slashCommandService.buildSkillUserMessage(skillInvocation);

  continueSession(sessionId, userMessage, workingDirectory, {
    systemPrompt: skillSystemPrompt,
  }).catch(err => {
    console.error('Error executing skill:', err);
  });

  return { success: true, command: name, message: userMessage };
}

/**
 * Handle execution of a non-skill slash command.
 * Returns the response payload.
 */
async function handleCommandExecution({ workingDirectory, name, args, sessionId, project }) {
  const commandString = await slashCommandService.buildCommandString(
    workingDirectory, name, args
  );

  continueSession(sessionId, commandString, workingDirectory, {
    systemPrompt: project.systemPrompt || null,
  }).catch(err => {
    console.error('Error executing command:', err);
  });

  return { success: true, command: name, message: commandString };
}

router.post('/:name/execute', async (req, res) => {
  const { name } = req.params;
  const { sessionId, args = {} } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  // Get the session
  const session = sessions.getById(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Get the project to find the working directory
  const project = projects.getById(session.projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Determine working directory (may be a worktree)
  const workingDirectory = session.gitWorktree || project.workingDirectory;

  // The session must be in a state that accepts messages (waiting, stopped, error)
    const validStatuses = ['waiting', 'stopped', 'error'];
    if (!validStatuses.includes(session.status)) {
      return res.status(400).json({
        error: `Session is not ready for commands. Current status: ${session.status}`,
      });
    }

  try {
    // Check if this is a skill — skills need special handling
    const skillResult = await handleSkillExecution({ workingDirectory, name, args, sessionId, project });
    if (skillResult) {
      return res.json(skillResult);
    }

    // Non-skill command
    const cmdResult = await handleCommandExecution({ workingDirectory, name, args, sessionId, project });
    res.json(cmdResult);
  } catch (err) {
    console.error('Error executing command:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
