/**
 * Simple logger that respects NODE_ENV
 * Suppresses debug logs during testing
 */

export const logger = {
  log: (...args) => {
    if (process.env.NODE_ENV !== 'test') {
      console.log(...args);
    }
  },
  error: (...args) => {
    console.error(...args);
  },
  warn: (...args) => {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(...args);
    }
  },
};

export default logger;
