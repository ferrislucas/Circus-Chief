import { z } from 'zod';

export const CreateCommandButtonRequest = z.object({
  label: z.string().min(1, 'Label is required'),
  command: z.string().min(1, 'Command is required'),
  sortOrder: z.number().int().optional().default(0),
  showOnList: z.boolean().optional().default(false),
});

export const UpdateCommandButtonRequest = z.object({
  label: z.string().min(1).optional(),
  command: z.string().min(1).optional(),
  sortOrder: z.number().int().optional(),
  showOnList: z.boolean().optional(),
}).refine(obj => Object.keys(obj).length > 0, 'At least one field must be provided for update');

export const CommandButtonResponse = z.object({
  id: z.string(),
  projectId: z.string(),
  label: z.string(),
  command: z.string(),
  sortOrder: z.number().int(),
  showOnList: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const CommandButtonListResponse = z.array(CommandButtonResponse);

export const CommandRunResponse = z.object({
  runId: z.string(),
  buttonId: z.string(),
  status: z.enum(['running', 'success', 'error', 'killed']),
  exitCode: z.number().int().nullable(),
  output: z.string().optional(),
});
