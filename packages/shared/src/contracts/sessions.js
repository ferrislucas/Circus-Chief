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

export const CreateSessionRequest = z.object({
  prompt: z.string().min(1),
  name: z.string().optional(),
  mode: z.enum(['plan', 'standard', 'yolo']).optional(),
  thinkingEnabled: z.boolean().optional(),
  effortLevel: z.enum(['low', 'medium', 'high', 'max', 'auto']).optional(),
  gitBranch: z.string().optional(),
  gitMode: z.enum(['branch', 'worktree', 'current']).optional(),
  templateId: z.string().uuid().optional(), // Template to apply on session creation
  nextTemplateId: z.string().uuid().nullable().optional(),
  // Scheduling fields
  scheduledAt: ScheduledAtIsoString.optional(),
  autoRescheduleEnabled: z.boolean().optional(),
  rescheduleDelayMinutes: z.number().min(5).max(1440).optional(), // 5 min to 24 hours
  rescheduleOnTokenLimit: z.boolean().optional(),
  rescheduleOnServiceError: z.boolean().optional(),
  maxRescheduleCount: z.number().min(1).max(100).nullable().optional(),
  maxTotalTokens: z.number().min(1000).nullable().optional(),
  rescheduleAtTokenCount: z.number().min(10000).nullable().optional(), // e.g., 100k, 150k tokens
});

export const UpdateSessionRequest = z.object({
  name: z.string().min(1).optional(),
  manuallyNamed: z.boolean().optional(),
  thinkingEnabled: z.boolean().optional(),
  effortLevel: z.enum(['low', 'medium', 'high', 'max', 'auto']).nullable().optional(),
  status: z.enum(['starting', 'running', 'waiting', 'error', 'stopped', 'scheduled']).optional(),
  mode: z.enum(['plan', 'standard', 'yolo']).optional(),
  model: z.string().nullable().optional(),
  pendingModel: z.string().nullable().optional(),
  providerId: z.string().uuid().nullable().optional(),
  nextTemplateId: z.string().uuid().nullable().optional(),
  // PR URL - GitHub PR URL (e.g., https://github.com/owner/repo/pull/123) or null to clear
  prUrl: z.string().url().regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/).nullable().optional(),
  // Scheduling fields
  scheduledAt: z.number().nullable().optional(), // Unix timestamp in ms
  autoRescheduleEnabled: z.boolean().optional(),
  rescheduleDelayMinutes: z.number().min(5).max(1440).optional(), // 5 min to 24 hours
  rescheduleOnTokenLimit: z.boolean().optional(),
  rescheduleOnServiceError: z.boolean().optional(),
  maxRescheduleCount: z.number().min(1).max(100).nullable().optional(),
  maxTotalTokens: z.number().min(1000).nullable().optional(),
  rescheduleCount: z.number().optional(), // For resetting
  rescheduleAtTokenCount: z.number().min(10000).nullable().optional(),
});

export const SendMessageRequest = z.object({
  content: z.string().min(1),
});

export const SessionResponse = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  status: z.enum(['starting', 'running', 'waiting', 'stopped', 'completed', 'error', 'scheduled']),
  mode: z.enum(['plan', 'standard', 'yolo']),
  model: z.string().nullable(),
  thinkingEnabled: z.boolean(),
  effortLevel: z.enum(['low', 'medium', 'high', 'max', 'auto']).nullable(),
  gitBranch: z.string().nullable(),
  gitWorktree: z.string().nullable(),
  prUrl: z.string().nullable(),
  prUrlAutoLinkDisabled: z.boolean(),
  manuallyNamed: z.boolean(),
  error: z.string().nullable(),
  nextTemplateId: z.string().uuid().nullable(),
  parentSessionId: z.string().uuid().nullable(),
  // Scheduling fields
  scheduledAt: z.number().nullable(),
  rescheduleDelayMinutes: z.number(),
  autoRescheduleEnabled: z.boolean(),
  rescheduleOnTokenLimit: z.boolean(),
  rescheduleOnServiceError: z.boolean(),
  maxRescheduleCount: z.number().nullable(),
  maxTotalTokens: z.number().nullable(),
  rescheduleCount: z.number(),
  rescheduleAtTokenCount: z.number().nullable(),
  // Kanban fields
  laneTriggerDepth: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastActivityAt: z.number().nullable(),
});

export const SessionListResponse = z.array(SessionResponse);

export const AttachmentResponse = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid().nullable(),
  sessionId: z.string().uuid(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
  storageType: z.enum(['base64', 'file_path', 'project_file']).optional(),
  createdAt: z.number(),
});

export const ConversationMessageResponse = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  toolUse: z.array(z.any()).nullable(),
  attachments: z.array(AttachmentResponse).optional(),
  timestamp: z.number(),
});

export const ConversationListResponse = z.array(ConversationMessageResponse);
