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
import { sendWorkspaceJson, sendWorkspaceCards, decorateWorkspaceCard } from './workspace-cards.js';

const withPendingAgentInput = (session) => ({
  ...session,
  pendingAgentInput: hasPendingPrompt(session.id),
});

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
  const workspaces = sessions
    .getRootsByProjectId(req.params.projectId, {
      archived: archivedFilter,
      starred: starredFilter,
      limit: parsedLimit,
      offset: parsedOffset,
    })
    .map(withPendingAgentInput);
  if (parsedLimit === null) return res.json(workspaces);

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

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/workspaces — list workspaces (root sessions)
//
// Response shapes:
//   With `view=cards`           → cursor-paginated cards (limit 1-500, default 50; cursor base64url ≤512 chars)
//                                  with filters status={running,idle}, archived/starred/scheduled={true,false}
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
      return res
        .status(400)
        .json({ error: validation.error.issues[0]?.message || 'Invalid request body' });
    }

    const project = projects.getById(req.params.projectId);
    if (!project) {
      return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
    }

    // Force parentSessionId to null — this is always a root (workspace)
    const body = { ...req.body, parentSessionId: null };

    const prepared = await validateAndPrepareSessionConfig(
      body,
      req.files,
      req.params.projectId,
      project
    );
    if (prepared.error) {
      return res.status(prepared.status).json({ error: prepared.error });
    }

    const { config, nextTemplateId } = prepared;
    config.agentType = resolveAgentTypeFromModel(config.model);
    const initialStatus = determineInitialStatus(config);
    session = createSessionRow(req.params.projectId, config, nextTemplateId, initialStatus);
    return await startSessionOrFail(req, res, {
      session,
      config,
      project,
      projectId: req.params.projectId,
    });
  } catch (error) {
    return handleCreateError(res, session, error, 'Workspace creation error:');
  }
});

// ---------------------------------------------------------------------------
// GET /api/workspaces/:workspaceId — legacy workspace detail with its session tree
// ---------------------------------------------------------------------------
workspacesRouter.get('/:workspaceId', (req, res) => {
  const startedAt = performance.now();
  const resolved = resolveWorkspace(res, req.params.workspaceId);
  if (!resolved) return;

  const { workspace } = resolved;
  const descendantIds = sessions.getAllDescendantIds(workspace.id);
  const descendants = descendantIds.length > 0 ? sessions.getByIds(descendantIds) : [];
  // This endpoint is used by external API consumers, so retain its full session
  // row contract. The compact member projection lives at /members.
  return sendWorkspaceJson(
    res,
    {
      ...withPendingAgentInput(workspace),
      sessions: descendants.map(withPendingAgentInput),
    },
    startedAt
  );
});

// Bounded reconciliation endpoint for project realtime events. Unlike the list
// query, this only walks the requested workspace tree.
workspacesRouter.get('/:workspaceId/card', (req, res) => {
  const startedAt = performance.now();
  const resolved = resolveWorkspace(res, req.params.workspaceId);
  if (!resolved) return;
  const card = sessions.getWorkspaceCard(resolved.project.id, resolved.workspace.id);
  if (!card) return res.status(404).json({ error: ERR_WORKSPACE_NOT_FOUND });
  return sendWorkspaceJson(res, decorateWorkspaceCard(card, resolved.project.id), startedAt);
});

// ---------------------------------------------------------------------------
// POST /api/workspaces/:workspaceId/sessions — add a session to a workspace
// ---------------------------------------------------------------------------
workspacesRouter.post('/:workspaceId/sessions', async (req, res) => {
  let session = null;
  try {
    const validation = CreateWorkspaceSessionRequest.safeParse(req.body);
    if (!validation.success) {
      return res
        .status(400)
        .json({ error: validation.error.issues[0]?.message || 'Invalid request body' });
    }

    const resolved = resolveWorkspace(res, req.params.workspaceId);
    if (!resolved) return;

    const { workspace, project } = resolved;

    const parentValidation = validateWorkspaceParent(workspace, req.body.parentSessionId);
    if (parentValidation.error) {
      return res.status(parentValidation.status).json({ error: parentValidation.error });
    }

    const body = { ...req.body, parentSessionId: parentValidation.parentSessionId };

    const prepared = await validateAndPrepareSessionConfig(
      body,
      req.files,
      workspace.projectId,
      project
    );
    if (prepared.error) {
      return res.status(prepared.status).json({ error: prepared.error });
    }

    const { config, nextTemplateId } = prepared;
    config.agentType = resolveAgentTypeFromModel(config.model);
    const initialStatus = determineInitialStatus(config);
    session = createSessionRow(workspace.projectId, config, nextTemplateId, initialStatus);
    return await startSessionOrFail(req, res, {
      session,
      config,
      project,
      projectId: workspace.projectId,
    });
  } catch (error) {
    return handleCreateError(res, session, error, 'Workspace session creation error:');
  }
});

export { projectWorkspacesRouter, workspacesRouter };
