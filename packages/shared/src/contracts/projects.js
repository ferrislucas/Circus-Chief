import { z } from 'zod';

export const CreateProjectRequest = z.object({
  name: z.string().min(1),
  workingDirectory: z.string().min(1),
  systemPrompt: z.string().optional(),
  onSessionCreated: z.string().nullable().optional(),
  onSessionDeleted: z.string().nullable().optional(),
  prPollInterval: z.number().int().min(10000).optional(), // Min 10 seconds
  disableSessionSummaries: z.boolean().optional(),
  disableConversationSummaries: z.boolean().optional(),
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
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const ProjectListResponse = z.array(ProjectResponse);
