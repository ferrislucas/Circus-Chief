/**
 * Workspace API contracts (Zod schemas and JSDoc types).
 *
 * A workspace is a root session (parentSessionId IS NULL). The workspaceId is
 * identical to the root session's id — no separate DB table or new ids exist.
 * This file provides additive contracts for the /api/workspaces facade routes.
 */

import { z } from 'zod';
import { CreateSessionRequest } from './sessions.js';
import { CommandRunResponse } from './commandButtons.js';

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
  afterSessionId: z.unknown().optional(),
}).refine((body) => !('afterSessionId' in body), {
  message: 'afterSessionId is no longer supported; use parentSessionId',
  path: ['afterSessionId'],
});

/** A Kanban placement attached to a workspace list card. */
export const WorkspaceCardKanbanResponse = z.object({
  cardId: z.string().uuid(),
  laneId: z.string().uuid(),
  laneName: z.string(),
});

/**
 * The lightweight command-run indicator included in a workspace list card.
 * This deliberately excludes command output while retaining enough metadata
 * for the list to render the run state and resume output polling if needed.
 */
export const WorkspaceCardCommandRunResponse = CommandRunResponse.extend({
  startedAt: z.number(),
  completedAt: z.number().nullable().optional(),
  hasOutput: z.boolean().optional(),
  outputHighWater: z.number().int().nonnegative().optional(),
});

/**
 * Server-computed card returned by GET /api/projects/:projectId/workspaces?view=cards.
 * It is intentionally a compact read model rather than a SessionResponse.
 */
export const WorkspaceCardResponse = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  status: z.enum(['starting', 'running', 'waiting', 'stopped', 'completed', 'error', 'scheduled']),
  starred: z.boolean(),
  archived: z.boolean(),
  prUrl: z.string().nullable(),
  gitWorktree: z.string().nullable(),
  scheduledAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastActivityAt: z.number().nullable(),
  runningCount: z.number().int().nonnegative(),
  runningSessionIds: z.array(z.string().uuid()),
  scheduledCount: z.number().int().nonnegative(),
  waitingCount: z.number().int().nonnegative(),
  descendantCount: z.number().int().nonnegative(),
  nearestScheduledAt: z.number().nullable(),
  summaryPreview: z.string().nullable(),
  prState: z.string().nullable(),
  hasMergeConflicts: z.boolean().nullable(),
  ciStatus: z.string().nullable(),
  kanban: WorkspaceCardKanbanResponse.nullable(),
  // Session ids of this workspace's tree, in unspecified order. Lets the client resolve
  // a member session's realtime events to the owning card for local patching.
  memberIds: z.array(z.string().uuid()),
  pendingAgentInput: z.boolean(),
  latestCommandRuns: z.array(WorkspaceCardCommandRunResponse),
});

/** Paginated workspace-card list response, including authoritative status facets. */
export const WorkspaceCardListResponse = z.object({
  workspaces: z.array(WorkspaceCardResponse),
  facets: z.object({
    running: z.number().int().nonnegative(),
    idle: z.number().int().nonnegative(),
    waiting: z.number().int().nonnegative(),
  }),
  pagination: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    nextCursor: z.string().nullable().optional(),
    hasMore: z.boolean(),
  }),
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
