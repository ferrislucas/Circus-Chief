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
 * Error handler middleware for multer errors
 */
export function handleUploadError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files. Maximum is 10 files per request.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
}
