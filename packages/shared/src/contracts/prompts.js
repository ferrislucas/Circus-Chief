import { z } from 'zod';

export const PromptOption = z.object({ label: z.string(), description: z.string(), preview: z.string().optional() });
export const PromptQuestion = z.object({
  question: z.string().min(1), header: z.string().max(12).optional(),
  options: z.array(PromptOption).min(2).max(4), multiSelect: z.boolean(),
});
export const QuestionPromptResponse = z.union([
  z.object({
    action: z.literal('answer'),
    answers: z.record(z.string(), z.string().trim().min(1)).refine((answers) => Object.keys(answers).length > 0, {
      message: 'At least one answer is required',
    }),
    annotations: z.record(z.string(), z.unknown()).optional(), response: z.string().optional(), reason: z.string().optional(),
  }),
  z.object({
    action: z.literal('cancel'),
    annotations: z.record(z.string(), z.unknown()).optional(), response: z.string().optional(), reason: z.string().optional(),
  }),
]);
export const PermissionPromptResponse = z.object({
  action: z.enum(['allow', 'always_allow', 'deny', 'cancel']),
  reason: z.string().optional(),
  destination: z.enum(['session', 'projectSettings']).optional(),
});

export const PROMPT_ACTIONS_BY_KIND = Object.freeze({
  question: new Set(['answer', 'cancel']),
  permission: new Set(['allow', 'always_allow', 'deny', 'cancel']),
});
// Both response families deliberately share `cancel`; kind-specific validation
// happens against the parked prompt on the server, where its kind is known.
export const PromptResponse = z.union([
  QuestionPromptResponse, PermissionPromptResponse,
]);
