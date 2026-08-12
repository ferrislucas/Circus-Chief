/**
 * Workspace facade routers — /api/projects/:projectId/workspaces and /api/workspaces/:workspaceId
 *
 * A "workspace" is an existing root session (parentSessionId IS NULL). The workspace ID
 * equals the root session's ID — no new DB table or migration is required.
 *
 * These routes expose two unambiguous verbs for agent use:
 *   - Create / schedule a workspace  → POST /api/projects/:projectId/workspaces
 *   - Add / schedule a session       → POST /api/workspaces/:workspaceId/sessions
 *
 * Two separate Router instances are exported so that api/index.js can mount each
 * at the right prefix without creating phantom cross-routes:
 *   - projectWorkspacesRouter → mounted at /api/projects
 *   - workspacesRouter        → mounted at /api/workspaces
 */

import { Router } from 'express';
import { sessions, projects } from '../database.js';
import { determineInitialStatus } from './projects-session-helpers.js';
import { resolveAgentTypeFromModel } from '../services/sessionProvider.js';
import {
  validateAndPrepareSessionConfig,
  createSessionRow,
  startSessionOrFail,
} from './projects-session-create.js';
import {
  CreateWorkspaceRequest,
  CreateWorkspaceSessionRequest,
} from '@circuschief/shared/contracts/workspaces';
import { hasPendingPrompt } from '../services/promptStore.js';

const withPendingAgentInput = (session) => ({ ...session, pendingAgentInput: hasPendingPrompt(session.id) });

const ERR_PROJECT_NOT_FOUND = 'Project not found';
const ERR_WORKSPACE_NOT_FOUND = 'Workspace not found';

const projectWorkspacesRouter = Router();
const workspacesRouter = Router();

// These timings are intentionally response headers rather than a metrics sink:
// they are production-safe, immediately visible in browser waterfalls, and keep
// the list/detail contract measurable without recording user content.
function sendWorkspaceJson(res, payload, startedAt) {
  const serializeStartedAt = performance.now();
  const body = JSON.stringify(payload);
  const serializationMs = performance.now() - serializeStartedAt;
  const totalMs = performance.now() - startedAt;
  res.set({
    'Server-Timing': `workspace;dur=${totalMs.toFixed(1)}, serialize;dur=${serializationMs.toFixed(1)}`,
    'X-Response-Bytes': String(Buffer.byteLength(body)),
  });
  return res.type('application/json').send(body);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a workspace: look up the session, walk to its root, verify it belongs
 * to the given project. Returns { workspace, project } or sends an error response.
 *
 * Accepts either a root session ID or any child session ID (child IDs are
 * normalised to their root — forgiving, not an error).
 */
function resolveWorkspace(res, rawWorkspaceId, expectedProjectId = null) {
  const anySession = sessions.getById(rawWorkspaceId);
  if (!anySession) {
    res.status(404).json({ error: ERR_WORKSPACE_NOT_FOUND });
    return null;
  }

  const rootId = sessions.getRootSessionId(anySession.id) || anySession.id;
  const workspace = sessions.getById(rootId);
  if (!workspace) {
    res.status(404).json({ error: ERR_WORKSPACE_NOT_FOUND });
    return null;
  }

  if (expectedProjectId && workspace.projectId !== expectedProjectId) {
    res.status(400).json({ error: 'Workspace does not belong to this project' });
    return null;
  }

  const project = projects.getById(workspace.projectId);
  if (!project) {
    res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
    return null;
  }

  return { workspace, project };
}

/**
 * Validate the required parentSessionId for a session being added to a workspace.
 *
 * Strict behaviour (by design): parentSessionId must reference a session that
 * exists and belongs to this workspace (the root or one of its descendants).
 * An unknown parent or a parent from a different workspace is rejected — the
 * server never silently falls back to attaching the session at the workspace
 * root.
 *
 * @param {object} workspace - The resolved workspace root session.
 * @param {string} parentSessionId - Required UUID of the direct parent session.
 * @returns {{ parentSessionId: string }|{ error: string, status: number }}
 */
function validateWorkspaceParent(workspace, parentSessionId) {
  const parentSession = sessions.getById(parentSessionId);
  if (!parentSession) {
    return { error: 'Parent session not found', status: 404 };
  }
  const parentRoot = sessions.getRootSessionId(parentSession.id) || parentSession.id;
  if (parentRoot !== workspace.id) {
    return { error: 'Parent session does not belong to this workspace', status: 400 };
  }
  return { parentSessionId: parentSession.id };
}

/**
 * Handle a session-creation error: mark the session errored (if persisted) and
 * respond 500. Shared by both create handlers.
 */
function handleCreateError(res, session, error, label) {
  console.error(label, error);
  if (session?.id) {
    try {
      sessions.update(session.id, { status: 'error', error: error.message });
    } catch (updateError) {
      console.error('Failed to mark session as errored:', updateError);
    }
  }
  return res.status(500).json({ error: error.message || 'Internal server error' });
}

function parseBooleanFilter(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function hasValidWorkspaceCardFilters(status, scheduled) {
  return ['running', 'idle', undefined].includes(status)
    && ['true', 'false', undefined].includes(scheduled);
}

function decodeWorkspaceCursor(value) {
  if (!value || typeof value !== 'string' || value.length > 512) return value ? null : null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 5
      || ![0, 1].includes(parsed[0]) || !parsed.slice(1, 4).every(Number.isFinite)
      || typeof parsed[4] !== 'string' || !parsed[4]) return null;
    return { starred: parsed[0], activityOrder: parsed[1], updatedAt: parsed[2], createdAt: parsed[3], id: parsed[4] };
  } catch { return null; }
}

function encodeWorkspaceCursor(card) {
  return Buffer.from(JSON.stringify([
    card.starred ? 1 : 0,
    card.lastActivityAt ?? card.updatedAt ?? card.createdAt,
    card.updatedAt,
    card.createdAt,
    card.id,
  ])).toString('base64url');
}

function parseWorkspaceCardOptions({ archived, starred, limit, cursor, status, scheduled }) {
  const parsedLimit = Number.parseInt(limit, 10);
  const parsedCursor = decodeWorkspaceCursor(cursor);
  const valid = Number.isInteger(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 50
    && (cursor === undefined || parsedCursor !== null)
    && hasValidWorkspaceCardFilters(status, scheduled);
  if (!valid) return null;
  return {
    archived: archived === 'true',
    starred: parseBooleanFilter(starred),
    status: status || null,
    scheduled: parseBooleanFilter(scheduled),
    limit: parsedLimit,
    cursor: parsedCursor,
  };
}

function sendWorkspaceCards(res, projectId, query, startedAt) {
  const options = parseWorkspaceCardOptions(query);
  if (!options) return res.status(400).json({ error: 'Invalid workspace card pagination or filters' });
  const pagePlusOne = sessions.getWorkspaceCards(projectId, { ...options, limit: options.limit + 1 });
  return sendWorkspaceJson(res, {
    workspaces: pagePlusOne.slice(0, options.limit),
    pagination: {
      limit: options.limit,
      hasMore: pagePlusOne.length > options.limit,
      nextCursor: pagePlusOne.length > options.limit ? encodeWorkspaceCursor(pagePlusOne[options.limit - 1]) : null,
    },
  }, startedAt);
}

function listProjectWorkspaces(req, res) {
  const startedAt = performance.now();
  const project = projects.getById(req.params.projectId);
  if (!project) return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });

  const { archived, starred, limit, offset, view } = req.query;
  if (view === 'cards') return sendWorkspaceCards(res, req.params.projectId, req.query, startedAt);

  const archivedFilter = archived === 'true' ? true : archived === 'false' ? false : null;
  const starredFilter = starred === 'true' ? true : starred === 'false' ? false : null;
  const parsedLimit = limit ? parseInt(limit, 10) : null;
  const parsedOffset = offset ? parseInt(offset, 10) : 0;
  const workspaces = sessions.getRootsByProjectId(req.params.projectId, {
    archived: archivedFilter, starred: starredFilter, limit: parsedLimit, offset: parsedOffset,
  });
  if (parsedLimit === null) return res.json(workspaces.map(withPendingAgentInput));

  const total = sessions.getRootsCountByProjectId(req.params.projectId, {
    archived: archivedFilter, starred: starredFilter,
  });
  return res.json({
    workspaces: workspaces.map(withPendingAgentInput),
    pagination: { total, limit: parsedLimit, offset: parsedOffset, hasMore: parsedOffset + workspaces.length < total },
  });
}

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/workspaces — list workspaces (root sessions)
//
// Response shapes:
//   Without `limit` query param → bare array of root session rows.
//   With `limit` query param    → { workspaces: [...], pagination: { total, limit, offset, hasMore } }
// ---------------------------------------------------------------------------
projectWorkspacesRouter.get('/:projectId/workspaces', listProjectWorkspaces);

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/workspaces — create a new workspace
// ---------------------------------------------------------------------------
projectWorkspacesRouter.post('/:projectId/workspaces', async (req, res) => {
  let session = null;
  try {
    const validation = CreateWorkspaceRequest.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues[0]?.message || 'Invalid request body' });
    }

    const project = projects.getById(req.params.projectId);
    if (!project) {
      return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
    }

    // Force parentSessionId to null — this is always a root (workspace)
    const body = { ...req.body, parentSessionId: null };

    const prepared = await validateAndPrepareSessionConfig(body, req.files, req.params.projectId, project);
    if (prepared.error) {
      return res.status(prepared.status).json({ error: prepared.error });
    }

    const { config, nextTemplateId } = prepared;
    config.agentType = resolveAgentTypeFromModel(config.model);
    const initialStatus = determineInitialStatus(config);
    session = createSessionRow(req.params.projectId, config, nextTemplateId, initialStatus);
    return await startSessionOrFail(req, res, { session, config, project, projectId: req.params.projectId });
  } catch (error) {
    return handleCreateError(res, session, error, 'Workspace creation error:');
  }
});

// ---------------------------------------------------------------------------
// GET /api/workspaces/:workspaceId — workspace detail shell with its session tree
// ---------------------------------------------------------------------------
workspacesRouter.get('/:workspaceId', (req, res) => {
  const startedAt = performance.now();
  const resolved = resolveWorkspace(res, req.params.workspaceId);
  if (!resolved) return;

  const { workspace } = resolved;
  const members = sessions.getWorkspaceMembers(workspace.id).map(withPendingAgentInput);
  const root = members.find(member => member.id === workspace.id);
  // Keep the root fields and `sessions` alias during the compatibility window;
  // both now use the compact allowlisted projection rather than raw rows.
  return sendWorkspaceJson(res, {
    ...root,
    sessions: members.filter(member => member.id !== workspace.id),
    workspace: root,
    members,
  }, startedAt);
});

// GET /api/workspaces/:workspaceId/members — cacheable lightweight tree only.
workspacesRouter.get('/:workspaceId/members', (req, res) => {
  const resolved = resolveWorkspace(res, req.params.workspaceId);
  if (!resolved) return;
  const members = sessions.getWorkspaceMembers(resolved.workspace.id).map(withPendingAgentInput);
  return res.json({ workspaceId: resolved.workspace.id, members });
});

// ---------------------------------------------------------------------------
// POST /api/workspaces/:workspaceId/sessions — add a session to a workspace
// ---------------------------------------------------------------------------
workspacesRouter.post('/:workspaceId/sessions', async (req, res) => {
  let session = null;
  try {
    const validation = CreateWorkspaceSessionRequest.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues[0]?.message || 'Invalid request body' });
    }

    const resolved = resolveWorkspace(res, req.params.workspaceId);
    if (!resolved) return;

    const { workspace, project } = resolved;

    const parentValidation = validateWorkspaceParent(workspace, req.body.parentSessionId);
    if (parentValidation.error) {
      return res.status(parentValidation.status).json({ error: parentValidation.error });
    }

    const body = { ...req.body, parentSessionId: parentValidation.parentSessionId };

    const prepared = await validateAndPrepareSessionConfig(body, req.files, workspace.projectId, project);
    if (prepared.error) {
      return res.status(prepared.status).json({ error: prepared.error });
    }

    const { config, nextTemplateId } = prepared;
    config.agentType = resolveAgentTypeFromModel(config.model);
    const initialStatus = determineInitialStatus(config);
    session = createSessionRow(workspace.projectId, config, nextTemplateId, initialStatus);
    return await startSessionOrFail(req, res, { session, config, project, projectId: workspace.projectId });
  } catch (error) {
    return handleCreateError(res, session, error, 'Workspace session creation error:');
  }
});

export { projectWorkspacesRouter, workspacesRouter };
