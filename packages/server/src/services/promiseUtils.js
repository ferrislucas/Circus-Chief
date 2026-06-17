/**
 * Utility for promise timeouts and related helpers.
 */

/**
 * Error thrown when a promise does not settle within the given timeout.
 * Tagged with `code: 'PROMISE_TIMEOUT'` so callers can branch on it.
 */
export class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
    this.code = 'PROMISE_TIMEOUT';
  }
}

/**
 * Race a promise against a timeout.
 *
 * @param {Promise<T>} promise - The promise to race.
 * @param {number} ms - Timeout in milliseconds.
 * @param {string} [message] - Rejection message on timeout.
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms, message = `Operation timed out after ${ms}ms`) {
  let timerId;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      reject(new TimeoutError(message));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timerId);
  });
}
