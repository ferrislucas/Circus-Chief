import { z } from 'zod';

export const CreateProjectRequest = z.object({
  name: z.string().min(1),
  workingDirectory: z.string().min(1),
});

export const UpdateProjectRequest = z.object({
  name: z.string().min(1).optional(),
  workingDirectory: z.string().min(1).optional(),
});

export const ProjectResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  workingDirectory: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const ProjectListResponse = z.array(ProjectResponse);
