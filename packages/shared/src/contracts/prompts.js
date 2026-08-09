import { z } from 'zod';

export const PromptAnnotation = z.object({
  notes: z.string().min(1).optional(),
  preview: z.string().min(1).optional(),
}).strict();
export const QuestionPromptResponse = z.union([
  z.object({
    action: z.literal('answer'),
    // Values remain structured until the Claude SDK boundary, where its
    // documented comma-delimited representation is constructed.
    answers: z.record(z.string(), z.array(z.string().min(1))).refine((answers) => Object.keys(answers).length > 0, {
      message: 'At least one answer is required',
    }),
    // Validate that custom input is meaningful without normalizing the value
    // the user entered. The raw string is passed through to the SDK.
    customAnswers: z.record(z.string(), z.string().refine((value) => value.trim().length > 0, {
      message: 'Custom answers cannot be blank',
    })).optional(),
    annotations: z.record(z.string(), PromptAnnotation).optional(), reason: z.string().optional(),
  }).refine((response) => (
    Object.values(response.answers).some((answer) => answer.length)
    || Object.values(response.customAnswers || {}).some((answer) => answer.trim())
  ), { message: 'At least one non-empty answer is required' }),
  z.object({
    action: z.literal('cancel'),
    annotations: z.record(z.string(), PromptAnnotation).optional(), reason: z.string().optional(),
  }),
]);
export const PermissionPromptResponse = z.object({
  action: z.enum(['allow', 'always_allow', 'deny']),
  reason: z.string().optional(),
  destination: z.enum(['session', 'projectSettings']).optional(),
});

export const PROMPT_ACTIONS_BY_KIND = Object.freeze({
  question: new Set(['answer', 'cancel']),
  permission: new Set(['allow', 'always_allow', 'deny']),
});
export const PromptResponse = z.union([
  QuestionPromptResponse, PermissionPromptResponse,
]);
