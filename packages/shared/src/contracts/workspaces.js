/**
 * Workspace API contracts (Zod schemas and JSDoc types).
 *
 * A workspace is a root session (parentSessionId IS NULL). The workspaceId is
 * identical to the root session's id — no separate DB table or new ids exist.
 * This file provides additive contracts for the /api/workspaces facade routes.
 */

import { z } from 'zod';
import { CreateSessionRequest } from './sessions.js';

// Derive WorkspaceSessionFields from CreateSessionRequest to avoid duplicating
// the full field list (prompt, name, mode, thinkingEnabled, effortLevel,
// gitBranch, gitMode, templateId, nextTemplateId, and all scheduling fields).
// Only the three workspace-specific fields are added here.
const WorkspaceSessionFields = CreateSessionRequest.extend({
  model: z.string().optional(),
  providerId: z.string().nullable().optional(),
  startImmediately: z.boolean().optional(),
});

/**
 * POST /api/projects/:projectId/workspaces — create a new workspace (root session).
 * parentSessionId is always forced to null by the server and must not be sent.
 */
export const CreateWorkspaceRequest = WorkspaceSessionFields;

/**
 * POST /api/workspaces/:workspaceId/sessions — add a session to an existing workspace.
 *
 * afterSessionId (optional, UUID): attach the new session after this session in the
 * workspace tree.
 *   - If the session belongs to this workspace, it becomes the direct parent.
 *   - If omitted, unknown, or from a different workspace, the workspace root is used
 *     as the parent (forgiving — never an error).
 */
export const CreateWorkspaceSessionRequest = WorkspaceSessionFields.extend({
  afterSessionId: z.string().uuid().optional(),
});

/**
 * Shape returned by GET /api/projects/:projectId/workspaces (list item).
 * Each entry is the raw root session row — no descendant sessions included.
 *
 * @typedef {object} WorkspaceListItem
 * @property {string} id - Workspace ID (= root session ID)
 * @property {string} projectId
 * @property {string} name
 * @property {string} status - Status of the root session
 */

/**
 * Shape returned by GET /api/workspaces/:workspaceId (detail).
 * Includes the root session row plus its descendant sessions.
 *
 * @typedef {object} WorkspaceDetail
 * @property {string} id - Workspace ID (= root session ID)
 * @property {string} projectId
 * @property {string} name
 * @property {string} status - Status of the root session
 * @property {object[]} sessions - Descendant sessions (excludes the root itself)
 */
