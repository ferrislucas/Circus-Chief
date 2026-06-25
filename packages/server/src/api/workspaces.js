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

const ERR_PROJECT_NOT_FOUND = 'Project not found';
const ERR_WORKSPACE_NOT_FOUND = 'Workspace not found';

const projectWorkspacesRouter = Router();
const workspacesRouter = Router();

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
 * Resolve the parent attach point for a session being added to a workspace.
 *
 * Forgiving behaviour (by design): if afterSessionId is provided but does not
 * resolve to a session within this workspace (unknown ID or a session that
 * belongs to a different workspace), the new session silently attaches at the
 * workspace root. Clients that need strict validation should verify the ID
 * themselves before calling this endpoint.
 *
 * @param {object} workspace - The resolved workspace root session.
 * @param {string|undefined} afterSessionId - Optional UUID of the preceding session.
 * @returns {string} The parent session ID to use.
 */
function resolveParentAttachPoint(workspace, afterSessionId) {
  if (!afterSessionId) return workspace.id;
  const afterSession = sessions.getById(afterSessionId);
  if (!afterSession) return workspace.id;
  const afterRoot = sessions.getRootSessionId(afterSession.id) || afterSession.id;
  return afterRoot === workspace.id ? afterSession.id : workspace.id;
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

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/workspaces — list workspaces (root sessions)
//
// Response shapes:
//   Without `limit` query param → bare array of root session rows.
//   With `limit` query param    → { workspaces: [...], pagination: { total, limit, offset, hasMore } }
// ---------------------------------------------------------------------------
projectWorkspacesRouter.get('/:projectId/workspaces', (req, res) => {
  const project = projects.getById(req.params.projectId);
  if (!project) {
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
  }

  const { archived, starred, limit, offset } = req.query;
  let archivedFilter = null;
  if (archived === 'true') archivedFilter = true;
  else if (archived === 'false') archivedFilter = false;

  let starredFilter = null;
  if (starred === 'true') starredFilter = true;
  else if (starred === 'false') starredFilter = false;

  const parsedLimit = limit ? parseInt(limit, 10) : null;
  const parsedOffset = offset ? parseInt(offset, 10) : 0;

  const workspaces = sessions.getRootsByProjectId(req.params.projectId, {
    archived: archivedFilter,
    starred: starredFilter,
    limit: parsedLimit,
    offset: parsedOffset,
  });

  if (parsedLimit !== null) {
    const total = sessions.getRootsCountByProjectId(req.params.projectId, {
      archived: archivedFilter,
      starred: starredFilter,
    });
    return res.json({
      workspaces,
      pagination: {
        total,
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: parsedOffset + workspaces.length < total,
      },
    });
  }

  return res.json(workspaces);
});

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
// GET /api/workspaces/:workspaceId — workspace detail with its session tree
// ---------------------------------------------------------------------------
workspacesRouter.get('/:workspaceId', (req, res) => {
  const resolved = resolveWorkspace(res, req.params.workspaceId);
  if (!resolved) return;

  const { workspace } = resolved;
  const descendantIds = sessions.getAllDescendantIds(workspace.id);
  const descendants = descendantIds.length > 0 ? sessions.getByIds(descendantIds) : [];

  return res.json({
    ...workspace,
    sessions: descendants,
  });
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

    const parentSessionId = resolveParentAttachPoint(workspace, req.body.afterSessionId);
    const body = { ...req.body, parentSessionId, afterSessionId: undefined };

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
