import { z } from 'zod';

export const CreateSessionRequest = z.object({
  prompt: z.string().min(1),
  name: z.string().optional(),
  mode: z.enum(['plan', 'standard', 'yolo']).optional(),
  thinkingEnabled: z.boolean().optional(),
  gitBranch: z.string().optional(),
});

export const UpdateSessionRequest = z.object({
  thinkingEnabled: z.boolean().optional(),
});

export const SendMessageRequest = z.object({
  content: z.string().min(1),
});

export const SessionResponse = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  status: z.enum(['starting', 'running', 'waiting', 'completed', 'error']),
  mode: z.enum(['plan', 'standard', 'yolo']),
  thinkingEnabled: z.boolean(),
  gitBranch: z.string().nullable(),
  gitWorktree: z.string().nullable(),
  prUrl: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
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
