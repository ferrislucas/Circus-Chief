import multer from 'multer';

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
    cb(new Error(`File type ${file.mimetype} not allowed`), false);
  }
}

/**
 * Multer configuration for file uploads
 * - Uses memory storage (files are stored in memory as Buffer)
 * - 10MB max file size
 * - Max 10 files per request
 */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 10, // Max 10 files per request
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
