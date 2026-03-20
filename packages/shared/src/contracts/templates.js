import { z } from 'zod';

export const CreateSessionTemplateRequest = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
  nextTemplateId: z.string().uuid().nullable().optional(),
  thinkingEnabled: z.boolean().nullable().optional(),
  gitBranch: z.string().nullable().optional(),
  gitMode: z.enum(['branch', 'worktree']).nullable().optional(),
  model: z.string().nullable().optional(),
  mode: z.enum(['plan', 'standard', 'yolo']).nullable().optional(),
  effortLevel: z.enum(['low', 'medium', 'high', 'max', 'auto']).nullable().optional(),
  targetLaneId: z.string().uuid().nullable().optional(), // Lane to place session in when created from this template
});

export const UpdateSessionTemplateRequest = z.object({
  name: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  nextTemplateId: z.string().uuid().nullable().optional(),
  thinkingEnabled: z.boolean().nullable().optional(),
  gitBranch: z.string().nullable().optional(),
  gitMode: z.enum(['branch', 'worktree']).nullable().optional(),
  model: z.string().nullable().optional(),
  mode: z.enum(['plan', 'standard', 'yolo']).nullable().optional(),
  effortLevel: z.enum(['low', 'medium', 'high', 'max', 'auto']).nullable().optional(),
  targetLaneId: z.string().uuid().nullable().optional(),
});

export const SessionTemplateResponse = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  name: z.string(),
  prompt: z.string(),
  nextTemplateId: z.string().uuid().nullable(),
  thinkingEnabled: z.boolean().nullable(),
  gitBranch: z.string().nullable(),
  gitMode: z.string().nullable(),
  model: z.string().nullable(),
  mode: z.string().nullable(),
  effortLevel: z.enum(['low', 'medium', 'high', 'max', 'auto']).nullable(),
  targetLaneId: z.string().uuid().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const SessionTemplateListResponse = z.array(SessionTemplateResponse);

export const AvailableTemplatesResponse = z.object({
  project: SessionTemplateListResponse,
  global: SessionTemplateListResponse,
});
