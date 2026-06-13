/**
 * Workspace API contracts (Zod schemas and JSDoc types).
 *
 * A workspace is a root session (parentSessionId IS NULL). The workspaceId is
 * identical to the root session's id — no separate DB table or new ids exist.
 * This file provides additive contracts for the /api/workspaces facade routes.
 */

import { z } from 'zod';

const SCHEDULED_AT_FORMAT_MESSAGE = 'scheduledAt must be a valid ISO 8601 date-time string with a timezone';
const ISO_8601_DATE_TIME_WITH_TIMEZONE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function hasValidDateParts(year, month, day) {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function isScheduledAtIsoString(value) {
  const match = ISO_8601_DATE_TIME_WITH_TIMEZONE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!hasValidDateParts(year, month, day)) return false;
  return Number.isFinite(Date.parse(value));
}

const ScheduledAtIsoString = z.string().refine(isScheduledAtIsoString, {
  message: SCHEDULED_AT_FORMAT_MESSAGE,
});

const WorkspaceSessionFields = z.object({
  prompt: z.string().min(1),
  name: z.string().optional(),
  mode: z.enum(['plan', 'standard', 'yolo']).optional(),
  thinkingEnabled: z.boolean().optional(),
  effortLevel: z.enum(['low', 'medium', 'high', 'max', 'auto']).optional(),
  model: z.string().optional(),
  providerId: z.string().nullable().optional(),
  gitBranch: z.string().optional(),
  gitMode: z.enum(['branch', 'worktree', 'current']).optional(),
  templateId: z.string().uuid().optional(),
  nextTemplateId: z.string().uuid().nullable().optional(),
  startImmediately: z.boolean().optional(),
  scheduledAt: ScheduledAtIsoString.optional(),
  autoRescheduleEnabled: z.boolean().optional(),
  rescheduleDelayMinutes: z.number().min(5).max(1440).optional(),
  rescheduleOnTokenLimit: z.boolean().optional(),
  rescheduleOnServiceError: z.boolean().optional(),
  maxRescheduleCount: z.number().min(1).max(100).nullable().optional(),
  maxTotalTokens: z.number().min(1000).nullable().optional(),
  rescheduleAtTokenCount: z.number().min(10000).nullable().optional(),
});

/**
 * POST /api/projects/:projectId/workspaces — create a new workspace (root session).
 * parentSessionId is always forced to null by the server and must not be sent.
 */
export const CreateWorkspaceRequest = WorkspaceSessionFields;

/**
 * POST /api/workspaces/:workspaceId/sessions — add a session to an existing workspace.
 * afterSessionId (optional): attach the new session after this session in the workspace tree.
 *   - If the session belongs to the workspace, it becomes the parent.
 *   - If omitted or outside the workspace, the workspace root is used as parent.
 */
export const CreateWorkspaceSessionRequest = WorkspaceSessionFields.extend({
  afterSessionId: z.string().uuid().optional(),
});

/**
 * @typedef {object} Workspace
 * @property {string} id - Workspace ID (= root session ID)
 * @property {string} projectId
 * @property {string} name
 * @property {string} status - Effective status of the root session
 * @property {number|null} nearestScheduledAt - Unix ms timestamp of the nearest scheduled session
 * @property {import('./sessions.js').Session[]} sessions - Descendant sessions (excludes root)
 */
