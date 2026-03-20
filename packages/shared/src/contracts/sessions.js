import { z } from 'zod';

export const CreateSessionRequest = z.object({
  prompt: z.string().min(1),
  name: z.string().optional(),
  mode: z.enum(['plan', 'standard', 'yolo']).optional(),
  thinkingEnabled: z.boolean().optional(),
  effortLevel: z.enum(['low', 'medium', 'high', 'max', 'auto']).optional(),
  gitBranch: z.string().optional(),
  gitMode: z.enum(['branch', 'worktree']).optional(),
  templateId: z.string().uuid().optional(), // Template to apply on session creation
  nextTemplateId: z.string().uuid().nullable().optional(),
  // Scheduling fields
  scheduledAt: z.number().optional(), // Unix timestamp in ms
  autoRescheduleEnabled: z.boolean().optional(),
  rescheduleDelayMinutes: z.number().min(5).max(1440).optional(), // 5 min to 24 hours
  rescheduleOnTokenLimit: z.boolean().optional(),
  rescheduleOnServiceError: z.boolean().optional(),
  maxRescheduleCount: z.number().min(1).max(100).nullable().optional(),
  maxTotalTokens: z.number().min(1000).nullable().optional(),
  rescheduleAtTokenCount: z.number().min(10000).nullable().optional(), // e.g., 100k, 150k tokens
  // Kanban fields
  targetLaneId: z.string().uuid().nullable().optional(), // Lane to place session in when created
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
  // Kanban fields
  targetLaneId: z.string().uuid().nullable().optional(), // Lane to move to when turn ends
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
  targetLaneId: z.string().uuid().nullable(),
  laneTriggerDepth: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastActivityAt: z.number(),
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
