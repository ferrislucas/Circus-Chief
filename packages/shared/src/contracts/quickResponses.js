import { z } from 'zod';

export const CreateQuickResponseRequest = z.object({
  label: z.string().min(1, 'Label is required').max(50, 'Label must be 50 characters or less'),
  content: z.string().min(1, 'Content is required').max(10000, 'Content must be 10000 characters or less'),
  autoSubmit: z.boolean().optional().default(false),
  category: z.string().max(50).nullable().optional(),
  sortOrder: z.number().int().min(0).optional().default(0),
  isGlobal: z.boolean().optional().default(false),
});

export const UpdateQuickResponseRequest = z.object({
  label: z.string().min(1).max(50).optional(),
  content: z.string().min(1).max(10000).optional(),
  autoSubmit: z.boolean().optional(),
  category: z.string().max(50).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
}).refine((obj) => Object.keys(obj).length > 0, 'At least one field must be provided for update');

export const QuickResponseResponse = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  label: z.string(),
  content: z.string(),
  autoSubmit: z.boolean(),
  category: z.string().nullable(),
  sortOrder: z.number().int(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const QuickResponseListResponse = z.array(QuickResponseResponse);

export const QuickResponsesForProjectResponse = z.object({
  project: QuickResponseListResponse,
  global: QuickResponseListResponse,
});

export const ReorderQuickResponsesRequest = z.array(
  z.object({
    id: z.string(),
    sortOrder: z.number().int().min(0),
  })
);
