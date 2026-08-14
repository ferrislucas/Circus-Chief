/** A safe, client-facing error with a stable machine-readable code. */
export class ApiError extends Error {
  constructor(message, { status = 400, code = 'VALIDATION_ERROR', field = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export function isApiError(error) {
  return error instanceof ApiError;
}
