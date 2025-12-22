import { z } from 'zod';

export const CreateCanvasItemRequest = z.object({
  type: z.enum(['image', 'markdown', 'text', 'json', 'pdf']),
  content: z.string().optional(),
  data: z.string().optional(),
  mimeType: z.string().optional(),
  filename: z.string().optional(),
  label: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

export const CanvasItemResponse = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid().nullable(),
  type: z.enum(['image', 'markdown', 'text', 'json', 'pdf']),
  content: z.string().nullable(),
  data: z.string().nullable(),
  mimeType: z.string().nullable(),
  filename: z.string().nullable(),
  label: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  createdAt: z.number(),
});

export const CanvasListResponse = z.array(CanvasItemResponse);
