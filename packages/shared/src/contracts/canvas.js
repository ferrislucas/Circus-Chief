import { z } from 'zod';

export const CreateCanvasItemRequest = z.object({
  filePath: z.string(),
});

export const CanvasItemResponse = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid().nullable(),
  type: z.enum(['image', 'markdown', 'text', 'json', 'pdf', 'code']),
  content: z.string().nullable(),
  data: z.string().nullable(),
  mimeType: z.string().nullable(),
  filename: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const CanvasListResponse = z.array(CanvasItemResponse);
