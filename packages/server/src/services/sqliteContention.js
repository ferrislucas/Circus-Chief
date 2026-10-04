import { ApiError } from '../errors/ApiError.js';

export const SQLITE_CONTENTION_RETRY_LIMIT = 3;
export const SQLITE_CONTENTION_RETRY_DELAY_MS = 5;

export function isSqliteContentionError(error) {
  return error?.code === 'SQLITE_BUSY' || error?.code === 'SQLITE_LOCKED';
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Retry a complete SQLite atomic unit, never merely its final write. */
export async function retrySqliteContention(operation) {
  for (let attempt = 0; attempt <= SQLITE_CONTENTION_RETRY_LIMIT; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (!isSqliteContentionError(error)) throw error;
      if (attempt === SQLITE_CONTENTION_RETRY_LIMIT) {
        throw new ApiError('Lane routing is temporarily busy; please retry', {
          status: 503, code: 'KANBAN_ROUTE_RETRYABLE',
        });
      }
      await delay(SQLITE_CONTENTION_RETRY_DELAY_MS * (attempt + 1));
    }
  }
}
