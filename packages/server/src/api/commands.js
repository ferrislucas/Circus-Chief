import { Router } from 'express';
import { getCommands, getCommand } from '../services/slashCommandService.js';

const router = Router();

/**
 * GET /api/commands
 * List all available slash commands for a directory
 * Query params:
 *   - directory: Working directory path (required)
 */
router.get('/', async (req, res) => {
  const directory = req.query.directory;

  if (!directory) {
    return res.status(400).json({ error: 'directory query parameter is required' });
  }

  try {
    const commands = await getCommands(String(directory));
    res.json({ commands });
  } catch (err) {
    console.error('Error listing commands:', err);
    res.status(500).json({ error: 'Failed to list commands' });
  }
});

/**
 * GET /api/commands/:name
 * Get a specific command by name
 * Query params:
 *   - directory: Working directory path (required)
 */
router.get('/:name', async (req, res) => {
  const { name } = req.params;
  const directory = req.query.directory;

  if (!directory) {
    return res.status(400).json({ error: 'directory query parameter is required' });
  }

  try {
    const command = await getCommand(String(directory), name);

    if (!command) {
      return res.status(404).json({ error: 'Command not found' });
    }

    res.json({ command });
  } catch (err) {
    console.error('Error getting command:', err);
    res.status(500).json({ error: 'Failed to get command' });
  }
});

export default router;
