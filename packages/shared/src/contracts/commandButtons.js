import { z } from 'zod';

const OPTION_TOKEN_DASHES = /(^|\s)([-\u2010-\u2015\u2212]+)(?=[A-Za-z0-9-])/g;
const UNICODE_DASHES = /[\u2010-\u2015\u2212]/g;
const HAS_UNICODE_DASH = /[\u2010-\u2015\u2212]/;

export function normalizeCommandOptionDashes(command) {
  return command.replace(OPTION_TOKEN_DASHES, (match, prefix, dashes) => {
    if (!HAS_UNICODE_DASH.test(dashes)) {
      return match;
    }

    return `${prefix}${dashes.replace(UNICODE_DASHES, '-')}`;
  });
}

export const CreateCommandButtonRequest = z.object({
  label: z.string().min(1, 'Label is required'),
  command: z.string().min(1, 'Command is required').transform(normalizeCommandOptionDashes),
  sortOrder: z.number().int().optional().default(0),
  showOnList: z.boolean().optional().default(false),
});

export const UpdateCommandButtonRequest = z.object({
  label: z.string().min(1).optional(),
  command: z.string().min(1).transform(normalizeCommandOptionDashes).optional(),
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
