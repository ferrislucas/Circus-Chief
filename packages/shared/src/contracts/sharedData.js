import { z } from 'zod';

/** Version contract for the private, host-owned shared-data API. */
export const SHARED_DATA_API_VERSION = 1;

export const SharedDataErrorCode = z.enum([
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'CONFLICT',
  'UNSUPPORTED_VERSION',
  'TRANSPORT_ERROR',
  'TIMEOUT',
  'INTERNAL_ERROR',
]);

export const SharedDataErrorResponse = z.object({
  code: SharedDataErrorCode,
  message: z.string(),
  details: z.unknown().optional(),
});

export const SessionIdParams = z.object({ sessionId: z.string().min(1) });
export const ProjectIdParams = z.object({ projectId: z.string().min(1) });
export const ConversationIdParams = z.object({ conversationId: z.string().min(1) });

export const GetDueSessionsQuery = z.object({
  now: z.coerce.number().int().nonnegative(),
});

export const ClaimScheduledRequest = z.object({
  expectedScheduledAt: z.number().int().nonnegative(),
  claimedAt: z.number().int().nonnegative(),
});

// Session updates intentionally remain a small, transport-safe subset of the
// existing repository update surface. New runtime needs add fields here first.
export const UpdateSessionRequest = z.object({
  status: z.string().min(1).optional(),
  scheduledAt: z.number().int().nonnegative().nullable().optional(),
  pendingPrompt: z.string().nullable().optional(),
  pendingConversationId: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
}).strict();

export const CreateMessageRequest = z.object({
  sessionId: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  toolUse: z.unknown().nullable().optional(),
  conversationId: z.string().min(1).nullable().optional(),
  model: z.string().nullable().optional(),
});

export const UpdateAttachmentMessageRequest = z.object({ messageId: z.string().min(1) });

export const SharedDataVersionResponse = z.object({
  version: z.literal(SHARED_DATA_API_VERSION),
  capabilities: z.array(z.string()),
});
