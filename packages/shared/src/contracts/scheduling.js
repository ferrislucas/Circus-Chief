/**
 * Shared scheduling validation helpers.
 * Imported by both sessions.js and workspaces.js to avoid duplication.
 */

import { z } from 'zod';

const SCHEDULED_AT_FORMAT_MESSAGE = 'scheduledAt must be a valid ISO 8601 date-time string with a timezone';
const ISO_8601_DATE_TIME_WITH_TIMEZONE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function hasValidDateParts(year, month, day) {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function isScheduledAtIsoString(value) {
  const match = ISO_8601_DATE_TIME_WITH_TIMEZONE.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!hasValidDateParts(year, month, day)) return false;

  return Number.isFinite(Date.parse(value));
}

export const ScheduledAtIsoString = z.string().refine(isScheduledAtIsoString, {
  message: SCHEDULED_AT_FORMAT_MESSAGE,
});
