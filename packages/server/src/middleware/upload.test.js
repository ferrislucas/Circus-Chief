import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { upload, handleUploadError } from './upload.js';

describe('Upload Middleware', () => {
  let app;

  // Create a test endpoint that uses the upload middleware
  function createTestApp() {
    const app = express();

    app.post('/upload', upload.array('files', 10), handleUploadError, (req, res) => {
      res.json({
        files: (req.files || []).map((f) => ({
          filename: f.originalname,
          mimetype: f.mimetype,
          size: f.size,
        })),
      });
    });

    return app;
  }

  beforeEach(() => {
    app = createTestApp();
  });

  describe('File Type Validation', () => {
    describe('Allowed types', () => {
      const allowedTypes = [
        { type: 'text/plain', ext: 'txt' },
        { type: 'text/markdown', ext: 'md' },
        { type: 'text/csv', ext: 'csv' },
        { type: 'text/html', ext: 'html' },
        { type: 'text/css', ext: 'css' },
        { type: 'text/javascript', ext: 'js' },
        { type: 'text/xml', ext: 'xml' },
        { type: 'application/json', ext: 'json' },
        { type: 'application/pdf', ext: 'pdf' },
        { type: 'application/javascript', ext: 'js' },
        { type: 'application/xml', ext: 'xml' },
        { type: 'application/x-yaml', ext: 'yaml' },
        { type: 'application/x-sh', ext: 'sh' },
        { type: 'image/png', ext: 'png' },
        { type: 'image/jpeg', ext: 'jpg' },
        { type: 'image/gif', ext: 'gif' },
        { type: 'image/webp', ext: 'webp' },
        { type: 'image/svg+xml', ext: 'svg' },
      ];

      allowedTypes.forEach(({ type, ext }) => {
        it(`accepts ${type} files`, async () => {
          const response = await request(app)
            .post('/upload')
            .attach('files', Buffer.from('test content'), {
              filename: `test.${ext}`,
              contentType: type,
            })
            .expect(200);

          expect(response.body.files).toHaveLength(1);
          expect(response.body.files[0].mimetype).toBe(type);
        });
      });

      it('accepts any text/* MIME type', async () => {
        const response = await request(app)
          .post('/upload')
          .attach('files', Buffer.from('test'), {
            filename: 'custom.xyz',
            contentType: 'text/x-custom-type',
          })
          .expect(200);

        expect(response.body.files).toHaveLength(1);
        expect(response.body.files[0].mimetype).toBe('text/x-custom-type');
      });
    });

    describe('Rejected types', () => {
      const rejectedTypes = [
        { type: 'application/x-msdownload', ext: 'exe', desc: 'executable' },
        { type: 'application/octet-stream', ext: 'bin', desc: 'binary' },
        { type: 'application/zip', ext: 'zip', desc: 'archive' },
        { type: 'video/mp4', ext: 'mp4', desc: 'video' },
        { type: 'audio/mpeg', ext: 'mp3', desc: 'audio' },
      ];

      rejectedTypes.forEach(({ type, ext, desc }) => {
        it(`rejects ${desc} files (${type})`, async () => {
          const response = await request(app)
            .post('/upload')
            .attach('files', Buffer.from('test'), {
              filename: `test.${ext}`,
              contentType: type,
            })
            .expect(400);

          expect(response.body.error).toContain('not allowed');
        });
      });
    });
  });

  describe('File Size Limits', () => {
    it('accepts files under 10MB', async () => {
      // Create a 1KB file
      const content = Buffer.alloc(1024, 'x');

      const response = await request(app)
        .post('/upload')
        .attach('files', content, {
          filename: 'small.txt',
          contentType: 'text/plain',
        })
        .expect(200);

      expect(response.body.files).toHaveLength(1);
      expect(response.body.files[0].size).toBe(1024);
    });

    it('rejects files over 10MB', async () => {
      // Create an 11MB file
      const content = Buffer.alloc(11 * 1024 * 1024, 'x');

      const response = await request(app)
        .post('/upload')
        .attach('files', content, {
          filename: 'large.txt',
          contentType: 'text/plain',
        })
        .expect(400);

      expect(response.body.error).toContain('File too large');
      expect(response.body.error).toContain('10MB');
    });
  });

  describe('File Count Limits', () => {
    it('accepts up to 10 files', async () => {
      let req = request(app).post('/upload');

      // Attach 10 files
      for (let i = 0; i < 10; i++) {
        req = req.attach('files', Buffer.from(`content ${i}`), {
          filename: `file${i}.txt`,
          contentType: 'text/plain',
        });
      }

      const response = await req.expect(200);
      expect(response.body.files).toHaveLength(10);
    });

    it('rejects more than 10 files', async () => {
      let req = request(app).post('/upload');

      // Try to attach 11 files
      for (let i = 0; i < 11; i++) {
        req = req.attach('files', Buffer.from(`content ${i}`), {
          filename: `file${i}.txt`,
          contentType: 'text/plain',
        });
      }

      const response = await req.expect(400);
      expect(response.body.error).toContain('Too many files');
    });
  });

  describe('Memory Storage', () => {
    it('stores file content in memory buffer', async () => {
      const content = 'Hello, World!';

      // Create custom endpoint to verify buffer
      const testApp = express();
      testApp.post('/test', upload.array('files', 10), (req, res) => {
        const file = req.files[0];
        res.json({
          hasBuffer: Buffer.isBuffer(file.buffer),
          bufferContent: file.buffer.toString(),
        });
      });

      const response = await request(testApp)
        .post('/test')
        .attach('files', Buffer.from(content), {
          filename: 'test.txt',
          contentType: 'text/plain',
        })
        .expect(200);

      expect(response.body.hasBuffer).toBe(true);
      expect(response.body.bufferContent).toBe(content);
    });
  });

  describe('Error Handler', () => {
    it('handles Multer file size errors', async () => {
      // This is already tested in "rejects files over 10MB"
      const content = Buffer.alloc(11 * 1024 * 1024, 'x');

      const response = await request(app)
        .post('/upload')
        .attach('files', content, {
          filename: 'large.txt',
          contentType: 'text/plain',
        })
        .expect(400);

      expect(response.body.error).toContain('10MB');
    });

    it('handles file type errors', async () => {
      const response = await request(app)
        .post('/upload')
        .attach('files', Buffer.from('test'), {
          filename: 'test.exe',
          contentType: 'application/x-msdownload',
        })
        .expect(400);

      expect(response.body.error).toContain('not allowed');
    });

    it('passes through when no error', async () => {
      const response = await request(app)
        .post('/upload')
        .attach('files', Buffer.from('valid'), {
          filename: 'valid.txt',
          contentType: 'text/plain',
        })
        .expect(200);

      expect(response.body.files).toHaveLength(1);
    });
  });

  describe('No Files', () => {
    it('handles request with no files', async () => {
      const response = await request(app).post('/upload').expect(200);

      expect(response.body.files).toEqual([]);
    });
  });

  describe('Multiple File Metadata', () => {
    it('preserves original filename', async () => {
      const response = await request(app)
        .post('/upload')
        .attach('files', Buffer.from('content'), {
          filename: 'my-special-file.txt',
          contentType: 'text/plain',
        })
        .expect(200);

      expect(response.body.files[0].filename).toBe('my-special-file.txt');
    });

    it('preserves MIME type', async () => {
      const response = await request(app)
        .post('/upload')
        .attach('files', Buffer.from('{}'), {
          filename: 'data.json',
          contentType: 'application/json',
        })
        .expect(200);

      expect(response.body.files[0].mimetype).toBe('application/json');
    });

    it('calculates correct file size', async () => {
      const content = 'Hello, World!'; // 13 bytes

      const response = await request(app)
        .post('/upload')
        .attach('files', Buffer.from(content), {
          filename: 'test.txt',
          contentType: 'text/plain',
        })
        .expect(200);

      expect(response.body.files[0].size).toBe(13);
    });
  });
});
