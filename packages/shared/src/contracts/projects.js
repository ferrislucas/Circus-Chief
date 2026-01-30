import { z } from 'zod';

export const CreateProjectRequest = z.object({
  name: z.string().min(1),
  workingDirectory: z.string().min(1),
  systemPrompt: z.string().nullable().optional(),
  onSessionCreated: z.string().nullable().optional(),
  onSessionDeleted: z.string().nullable().optional(),
  prPollInterval: z.number().int().min(10000).optional(), // Min 10 seconds
  disableSessionSummaries: z.boolean().optional(),
  disableConversationSummaries: z.boolean().optional(),
  repoUrl: z.string().url().nullable().optional(),
  sessionTitlePrompt: z.string().nullable().optional(),
});

export const UpdateProjectRequest = z.object({
  name: z.string().min(1).optional(),
  workingDirectory: z.string().min(1).optional(),
  systemPrompt: z.string().nullable().optional(),
  onSessionCreated: z.string().nullable().optional(),
  onSessionDeleted: z.string().nullable().optional(),
  prPollInterval: z.number().int().min(10000).optional(), // Min 10 seconds
  disableSessionSummaries: z.boolean().optional(),
  disableConversationSummaries: z.boolean().optional(),
  repoUrl: z.string().url().nullable().optional(),
  sessionTitlePrompt: z.string().nullable().optional(),
});

export const ProjectResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  workingDirectory: z.string(),
  systemPrompt: z.string().nullable(),
  onSessionCreated: z.string().nullable(),
  onSessionDeleted: z.string().nullable(),
  prPollInterval: z.number().int(),
  disableSessionSummaries: z.boolean(),
  disableConversationSummaries: z.boolean(),
  repoUrl: z.string().url().nullable().optional(),
  sessionTitlePrompt: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const ProjectListResponse = z.array(ProjectResponse);

export const ProjectSessionDefaultsRequest = z.object({
  mode: z.enum(['plan', 'standard', 'yolo']).nullable().optional(),
  thinkingEnabled: z.boolean().nullable().optional(),
  startImmediately: z.boolean().nullable().optional(),
  gitMode: z.enum(['branch', 'worktree']).nullable().optional(),
  gitBranch: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
});

export const ProjectSessionDefaultsResponse = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  mode: z.enum(['plan', 'standard', 'yolo']).nullable(),
  thinkingEnabled: z.boolean().nullable(),
  startImmediately: z.boolean().nullable(),
  gitMode: z.enum(['branch', 'worktree']).nullable(),
  gitBranch: z.string().nullable(),
  model: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
