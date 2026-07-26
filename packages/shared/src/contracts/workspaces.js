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
 * parentSessionId (required, UUID): the direct parent for the new session.
 *   - Must reference a session that belongs to this workspace (the workspace root
 *     or any of its descendants). Callers that want a direct child of the
 *     workspace pass the workspace root ID explicitly.
 *   - Missing, unknown, or cross-workspace values are rejected by the server —
 *     there is no fallback to the workspace root.
 *
 * This field replaces the former optional, forgiving `afterSessionId` field.
 * `afterSessionId` is not a compatibility alias: submitting it (even alongside
 * a valid `parentSessionId`) is rejected outright, since there is no
 * compatibility window for this cutover (see the FRD's recommended decisions).
 *
 * `afterSessionId` must be declared here (rather than left undeclared) so it
 * survives Zod's default "strip unknown keys" parsing behavior and is still
 * present in the object the `.refine()` below inspects. An undeclared key
 * would be silently stripped before the refinement ever ran, making the
 * rejection a no-op.
 */
export const CreateWorkspaceSessionRequest = WorkspaceSessionFields.extend({
  parentSessionId: z.string().uuid(),
  afterSessionId: z.any().optional(),
}).refine((body) => !('afterSessionId' in body), {
  message: 'afterSessionId is no longer supported; use parentSessionId',
  path: ['afterSessionId'],
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
