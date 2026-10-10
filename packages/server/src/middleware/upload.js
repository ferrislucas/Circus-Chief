import multer from 'multer';

// ── Rejected-upload drain policy ────────────────────────────────────────────
//
// These bounds apply only AFTER an upload has already been rejected. They are
// deliberately distinct from the accepted-upload limit (10MB below):
//
// - IDLE TIMEOUT — how long the drain may sit without consuming a single
//   byte. Every consumed chunk resets it, so a finite, actively progressing
//   rejected request always reaches EOF and receives its 4xx; a stalled one
//   is terminated promptly.
//
// - HARD LIFETIME — the absolute ceiling on one rejected request's drain,
//   however fast it progresses. Bounds a deliberately abusive client that
//   streams forever just to hold the connection open.
//
// - TOTAL BYTES — the discard ceiling for requests whose length is not
//   declared (chunked) or declared beyond the policy. A declared
//   Content-Length within policy marks the request as finite, so the byte
//   ceiling is not applied to it (the declared length itself bounds the
//   body). It is never the only safeguard — idle and lifetime always apply.
const DEFAULT_DRAIN_POLICY = Object.freeze({
  idleTimeoutMs: 2000,
  maxLifetimeMs: 30 * 1000,
  maxTotalBytes: 64 * 1024 * 1024,
});

function readPolicyNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Resolve the drain policy, allowing ops to tune the bounds via environment. */
export function getRejectedUploadDrainPolicy() {
  return {
    idleTimeoutMs: readPolicyNumber(
      process.env.REJECTED_UPLOAD_DRAIN_IDLE_TIMEOUT_MS, DEFAULT_DRAIN_POLICY.idleTimeoutMs),
    maxLifetimeMs: readPolicyNumber(
      process.env.REJECTED_UPLOAD_DRAIN_MAX_LIFETIME_MS, DEFAULT_DRAIN_POLICY.maxLifetimeMs),
    maxTotalBytes: readPolicyNumber(
      process.env.REJECTED_UPLOAD_DRAIN_MAX_TOTAL_BYTES, DEFAULT_DRAIN_POLICY.maxTotalBytes),
  };
}

const rejectedUploadDrains = new WeakSet();

/**
 * Allowed MIME types for file uploads
 */
const ALLOWED_MIME_TYPES = [
  // Images
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  // Text files
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'text/css',
  'text/javascript',
  'text/xml',
  // Application types
  'application/json',
  'application/pdf',
  'application/javascript',
  'application/xml',
  'application/x-yaml',
  'application/x-sh',
];

/**
 * File filter for multer - allows common file types
 */
function fileFilter(_req, file, cb) {
  // Allow if MIME type is in allowed list or starts with 'text/'
  if (ALLOWED_MIME_TYPES.includes(file.mimetype) || file.mimetype.startsWith('text/')) {
    cb(null, true);
  } else {
    beginBoundedRejectedUploadDrain(_req);
    cb(new Error(`File type ${file.mimetype} not allowed`), false);
  }
}

/**
 * Bound the tail of a request after rejecting its file, with progress-aware
 * limits.
 *
 * Multer waits for the request to end before it forwards a file-filter error
 * to Express. Draining that tail lets a legitimate rejected upload — even a
 * large or slow one — reach EOF so the client deterministically receives its
 * 4xx response, while three bounds keep the drain from being exploited:
 *
 *   - idle timeout: resets on every consumed chunk; a stalled request is
 *     terminated after the idle window, not held open forever;
 *   - hard lifetime: the whole drain ends at this ceiling no matter how fast
 *     the client streams;
 *   - total-byte ceiling: applies only when the request's length is undeclared
 *     (chunked) or declared beyond the policy — a declared Content-Length
 *     within policy marks the request finite, and the declared length itself
 *     bounds it.
 *
 * Exactly one terminal action wins: a normal EOF settles the drain and lets
 * the error handler respond; any limit terminates the request/socket. Every
 * exit path removes its own listeners and timers, and no rejected payload is
 * buffered — bytes are counted and discarded.
 */
export function beginBoundedRejectedUploadDrain(req) {
  if (rejectedUploadDrains.has(req)) return;
  rejectedUploadDrains.add(req);

  const policy = getRejectedUploadDrainPolicy();
  const declaredContentLength = Number(req.headers?.['content-length']);
  const hasFiniteDeclaredLength =
    Number.isFinite(declaredContentLength) && declaredContentLength >= 0;
  // A declared length beyond the ceiling is declared abuse: treat the request
  // like an unbounded stream (byte ceiling applies).
  const isFiniteByDeclaration =
    hasFiniteDeclaredLength && declaredContentLength <= policy.maxTotalBytes;

  let settled = false;
  let drainedBytes = 0;
  let idleTimer = null;
  let lifetimeTimer = null;

  const cleanup = () => {
    rejectedUploadDrains.delete(req);
    clearTimeout(idleTimer);
    clearTimeout(lifetimeTimer);
    req.removeListener('data', onData);
    req.removeListener('end', settle);
    req.removeListener('aborted', settle);
    req.removeListener('close', settle);
    req.removeListener('error', settle);
  };

  const settle = () => {
    if (settled) return;
    settled = true;
    cleanup();
  };

  const terminate = () => {
    if (settled) return;
    settle();
    if (!req.destroyed) req.destroy();
    if (req.socket && !req.socket.destroyed) req.socket.destroy();
  };

  const armIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(terminate, policy.idleTimeoutMs);
    idleTimer.unref?.();
  };

  const onData = (chunk) => {
    drainedBytes += chunk.length;
    // Progress: reset the idle window, then apply the byte ceiling for
    // streams whose length was not declared within policy.
    armIdleTimer();
    if (!isFiniteByDeclaration && drainedBytes > policy.maxTotalBytes) terminate();
  };

  lifetimeTimer = setTimeout(terminate, policy.maxLifetimeMs);
  lifetimeTimer.unref?.();
  armIdleTimer();

  req.on('data', onData);
  req.once('end', settle);
  req.once('aborted', settle);
  req.once('close', settle);
  req.once('error', settle);
}

const memoryStorage = multer.memoryStorage();

const boundedMemoryStorage = {
  _handleFile(req, file, callback) {
    // Multer exposes file-size rejection through the stream's limit event
    // before it forwards the eventual LIMIT_FILE_SIZE error to Express.
    file.stream.once('limit', () => beginBoundedRejectedUploadDrain(req));
    memoryStorage._handleFile(req, file, callback);
  },
  _removeFile(req, file, callback) {
    memoryStorage._removeFile(req, file, callback);
  },
};

/**
 * Multer configuration for file uploads
 * - Uses memory storage (files are stored in memory as Buffer)
 * - 10MB max file size
 * - Max 10 files per request
 * - Rejects numeric form-field array indexes above 0 to prevent sparse-array DoS
 */
export const upload = multer({
  storage: boundedMemoryStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 10, // Max 10 files per request
    fieldArrayIndexLimit: 0, // No request fields require indexed arrays
  },
  fileFilter,
});

/**
 * Send a 4xx response for an upload error after draining any unread request body.
 *
 * When multer's fileFilter (or a size/count limit) rejects an upload, multer stops
 * consuming the request stream. If we send the response while the client is still
 * uploading the multipart body, Node resets the socket rather than reusing it,
 * which surfaces on the client as a flaky `ECONNRESET` — and occasionally a
 * garbled/incorrect status — mid-upload. This is timing-sensitive and worsens
 * under load (e.g. coverage instrumentation), so it can slip past the test retry.
 *
 * Draining the remaining body and only then responding lets the connection close
 * cleanly, making the rejection path deterministic.
 */
function respondWithUploadError(req, res, status, body) {
  const finish = () => {
    if (res.headersSent) return;
    res.status(status).json(body);
  };

  // Already fully received (or nothing left to read) — respond immediately.
  if (req.complete) {
    finish();
    return;
  }

  // Swallow errors from the aborted/reset stream; respond once drained or ended.
  req.on('error', finish);
  req.on('end', finish);
  req.unpipe?.();
  req.resume();
}

/**
 * Error handler middleware for multer errors
 */
export function handleUploadError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return respondWithUploadError(req, res, 400, { error: 'File too large. Maximum size is 10MB.' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return respondWithUploadError(req, res, 400, { error: 'Too many files. Maximum is 10 files per request.' });
    }
    return respondWithUploadError(req, res, 400, { error: err.message });
  }
  if (err) {
    return respondWithUploadError(req, res, 400, { error: err.message });
  }
  next();
}

/**
 * Wrapper that makes multer skip processing for non-multipart requests
 * This allows the same route to handle both JSON and multipart/form-data requests
 */
export function uploadMiddleware(fieldName, maxCount) {
  return (req, res, next) => {
    // Check if the request is multipart/form-data
    const contentType = req.get('content-type');

    if (!contentType || !contentType.startsWith('multipart/form-data')) {
      // Not a multipart request, skip multer processing
      req.files = [];
      return next();
    }

    // Multipart request, use multer to process
    upload.array(fieldName, maxCount)(req, res, next);
  };
}
