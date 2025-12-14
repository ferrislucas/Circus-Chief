import { Router } from 'express';
import { readdir } from 'fs/promises';
import { homedir } from 'os';
import { resolve, dirname, normalize } from 'path';

const router = Router();

/**
 * GET /api/filesystem/browse - Browse directory contents
 * Query params:
 *   - path: Directory path to browse (defaults to home directory)
 * Returns only directories, sorted alphabetically
 */
router.get('/browse', async (req, res) => {
  try {
    // Use provided path or default to home directory
    const requestedPath = req.query.path ? String(req.query.path) : homedir();
    const normalizedPath = normalize(resolve(requestedPath));

    // Get parent directory (null if at root)
    const parent = normalizedPath === '/' ? null : dirname(normalizedPath);

    let entries = [];
    let error = null;

    try {
      const dirents = await readdir(normalizedPath, { withFileTypes: true });

      // Filter to only directories and sort alphabetically
      entries = dirents
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => ({
          name: dirent.name,
          type: 'directory',
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      // Handle permission errors or non-existent directories gracefully
      if (err.code === 'EACCES') {
        error = 'Permission denied';
      } else if (err.code === 'ENOENT') {
        error = 'Directory not found';
      } else if (err.code === 'ENOTDIR') {
        error = 'Not a directory';
      } else {
        error = 'Unable to read directory';
      }
    }

    res.json({
      path: normalizedPath,
      parent,
      entries,
      error,
    });
  } catch (err) {
    console.error('Filesystem browse error:', err);
    res.status(500).json({ error: 'Failed to browse directory' });
  }
});

export default router;
