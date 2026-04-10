import { Router } from 'express';
import { readFileSync, existsSync } from 'fs';
import { extname, resolve, normalize } from 'path';
import { sessions, messages, projects, commandRuns, sessionSummaries } from '../database.js';
import { getChanges, getChangesBranch } from '../services/diffService.js';
import * as gitService from '../services/gitService.js';
import { requireSession, requireSessionAndProject } from '../middleware/sessionLookup.js';
import { commandRunner } from '../services/commandRunner.js';

// Import sub-routers
import notesRouter from './sessions-notes.js';
import conversationsRouter from './sessions-conversations.js';
import commandsRouter from './sessions-commands.js';
import patchRouter from './sessions-patch.js';
import archiveRouter from './sessions-archive.js';
import lifecycleRouter from './sessions-lifecycle.js';
import streamingRouter from './sessions-streaming.js';
import messagesRouter from './sessions-messages.js';
import draftRouter from './sessions-draft.js';

const router = Router();

// Mount sub-routers
router.use('/', notesRouter);
router.use('/', conversationsRouter);
router.use('/', commandsRouter);
router.use('/', patchRouter);
router.use('/', archiveRouter);
router.use('/', lifecycleRouter);
router.use('/', streamingRouter);
router.use('/', messagesRouter);
router.use('/', draftRouter);

// TTL cache for files-count endpoint (60 second TTL)
const filesCountCache = new Map();
const FILES_COUNT_CACHE_TTL = 60_000; // 60 seconds

/**
 * Get cached files count or null if expired/missing
 * @param {string} sessionId
 * @returns {{ count: number } | null}
 */
function getCachedFilesCount(sessionId) {
  const cached = filesCountCache.get(sessionId);
  if (cached && (Date.now() - cached.timestamp) < FILES_COUNT_CACHE_TTL) {
    return { count: cached.count };
  }
  return null;
}

/**
 * Set files count in cache
 * @param {string} sessionId
 * @param {number} count
 */
function setCachedFilesCount(sessionId, count) {
  filesCountCache.set(sessionId, { count, timestamp: Date.now() });
}

/**
 * Invalidate files count cache for a session
 * @param {string} sessionId
 */
export function invalidateFilesCountCache(sessionId) {
  filesCountCache.delete(sessionId);
}

// GET /api/sessions - Get all active/waiting sessions across all projects
router.get('/', (req, res) => {
  const activeSessions = sessions.getActiveAndWaiting();
  res.json(activeSessions);
});

// GET /api/sessions/scheduled - Get all scheduled sessions (optionally filtered by project)
router.get('/scheduled', (req, res) => {
  const { projectId } = req.query;
  const scheduledSessions = sessions.getScheduledSessions(projectId || null);
  res.json(scheduledSessions);
});

// POST /api/sessions/summaries/batch - Get summaries for multiple sessions in one request
// Must be registered before /:id routes to avoid Express matching 'summaries' as an :id param
router.post('/summaries/batch', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array is required and must not be empty' });
  }

  const summaryList = sessionSummaries.getBySessionIds(ids);

  // Build a map of sessionId -> summary (or null if not found)
  const result = {};
  for (const id of ids) {
    result[id] = null;
  }
  for (const summary of summaryList) {
    result[summary.sessionId] = summary;
  }

  res.json(result);
});

// GET /api/sessions/:id - Get session details
// Includes latestCommandRuns (merged from DB completed runs + in-memory running commands)
router.get('/:id', requireSession, (req, res) => {
  // Add hasResponses flag to indicate if session has ever received assistant responses
  // This is used by the frontend to determine if a session is a draft
  const allMessages = messages.getBySessionId(req.params.id);
  const hasResponses = allMessages.some(msg => msg.role === 'assistant');

  // Get command run statuses (latest run per button for this session)
  // Completed runs from DB
  const dbRuns = commandRuns.getLatestRunsForSession(req.params.id);
  // Currently running commands from memory - filter all runs for this session
  const allRunning = commandRunner.getRunsBySession(req.params.id);
  const runningRuns = allRunning.filter(run => run.status === 'running');

  // Build map of buttonId -> run data
  // Running commands take precedence over completed ones (more current state)
  const runsByButton = {};

  // First add DB runs (completed)
  for (const run of dbRuns) {
    runsByButton[run.buttonId] = {
      buttonId: run.buttonId,
      status: run.status,
      exitCode: run.exitCode,
      runId: run.id,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      output: run.output || null,
    };
  }

  // Then overlay running commands (takes precedence)
  for (const run of runningRuns) {
    runsByButton[run.buttonId] = {
      buttonId: run.buttonId,
      status: 'running',
      exitCode: null,
      runId: run.runId,
      startedAt: run.startedAt,
    };
  }

  const latestCommandRuns = Object.values(runsByButton);

  res.json({ ...req.session_, hasResponses, latestCommandRuns });
});

// GET /api/sessions/:id/changes - Get git changes for session
// Query params:
//   compareMode: 'local' (default) or 'branch' - determines what to compare against
//   branch: branch ref to compare against (e.g., 'origin/main') - used when compareMode='branch'
router.get('/:id/changes', requireSessionAndProject, async (req, res) => {
  try {
    const { compareMode = 'local', branch } = req.query;

    let changes;
    if (compareMode === 'branch' && branch) {
      // Get changes compared to a specific branch
      changes = await getChangesBranch(req.workingDirectory, branch);
    } else {
      // Default: get local changes (staged, unstaged, untracked)
      changes = await getChanges(req.workingDirectory);
    }

    res.json(changes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Image MIME types for the file endpoint
const IMAGE_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

// GET /api/sessions/:id/file - Get a file from the session's working directory
// Used for displaying images in the diff viewer
router.get('/:id/file', requireSessionAndProject, (req, res) => {
  const { path: filePath } = req.query;
  if (!filePath) {
    return res.status(400).json({ error: 'path query parameter is required' });
  }

  // Security: ensure the requested path is within the working directory
  const fullPath = resolve(req.workingDirectory, filePath);
  const normalizedDir = normalize(req.workingDirectory);
  if (!fullPath.startsWith(normalizedDir)) {
    return res.status(403).json({ error: 'Access denied: path outside working directory' });
  }

  if (!existsSync(fullPath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    const ext = extname(fullPath).toLowerCase();
    const mimeType = IMAGE_MIME_TYPES[ext];

    if (!mimeType) {
      return res.status(400).json({ error: 'Only image files are supported' });
    }

    const fileBuffer = readFileSync(fullPath);
    const base64 = fileBuffer.toString('base64');

    res.json({
      data: base64,
      mimeType,
      filename: filePath,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sessions/:id/default-branch - Get the default branch for branch comparison
router.get('/:id/default-branch', requireSessionAndProject, async (req, res) => {
  try {
    const branch = await gitService.getOriginDefaultBranch(req.workingDirectory);
    res.json({ branch });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sessions/:id/files-count - Get count of modified files
// Uses a 60-second TTL cache to avoid expensive git operations on every request
router.get('/:id/files-count', requireSession, async (req, res) => {
  // Check cache first
  const cached = getCachedFilesCount(req.params.id);
  if (cached) {
    return res.json(cached);
  }

  const project = projects.getById(req.session_.projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Use gitWorktree if set, otherwise use the project's working directory
  const directory = req.session_.gitWorktree || project.workingDirectory;

  try {
    // Get the default branch to compare against
    const defaultBranch = await gitService.getOriginDefaultBranch(directory);
    const count = await gitService.getModifiedFilesCount(directory, defaultBranch);

    // Cache the result
    setCachedFilesCount(req.params.id, count);

    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: error.message, count: 0 });
  }
});

// PATCH /:id and PATCH /:id/pending-prompt are handled by sessions-patch.js sub-router

export default router;
