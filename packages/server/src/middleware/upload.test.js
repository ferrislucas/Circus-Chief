import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import net from 'net';
import request from 'supertest';
import { upload, handleUploadError } from './upload.js';

describe('Upload Middleware', () => {
  let app;

  // Create a test endpoint that uses the upload middleware
  function createTestApp() {
    const testApp = express();

    testApp.post('/upload', upload.array('files', 10), handleUploadError, (req, res) => {
      res.json({
        files: (req.files || []).map((f) => ({
          filename: f.originalname,
          mimetype: f.mimetype,
          size: f.size,
        })),
      });
    });

    return testApp;
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
        // Retry up to 2 times on transient EPIPE errors under heavy concurrent load
        it(`accepts ${type} files`, { retry: 2 }, async () => {
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

  describe('Field Array Index Limits', () => {
    it('rejects numeric form-field indexes above zero', async () => {
      const response = await request(app)
        .post('/upload')
        .field('metadata[999999999]', 'value')
        .expect(400);

      expect(response.body.error).toBe('Field name array index too large');
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

    describe('Rejected request draining', () => {
      // Policy overrides so the abuse bounds are testable without waiting for
      // the production-size values. Read by the drain at request time.
      const IDLE_MS = '300';
      const LIFETIME_MS = '1500';
      const TOTAL_BYTES = String(1024 * 1024);

      beforeEach(() => {
        process.env.REJECTED_UPLOAD_DRAIN_IDLE_TIMEOUT_MS = IDLE_MS;
        process.env.REJECTED_UPLOAD_DRAIN_MAX_LIFETIME_MS = LIFETIME_MS;
        process.env.REJECTED_UPLOAD_DRAIN_MAX_TOTAL_BYTES = TOTAL_BYTES;
      });

      afterEach(() => {
        delete process.env.REJECTED_UPLOAD_DRAIN_IDLE_TIMEOUT_MS;
        delete process.env.REJECTED_UPLOAD_DRAIN_MAX_LIFETIME_MS;
        delete process.env.REJECTED_UPLOAD_DRAIN_MAX_TOTAL_BYTES;
      });

      async function listen() {
        const server = http.createServer(app);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address();
        return { server, port };
      }

      async function connect(port) {
        const socket = net.connect(port, '127.0.0.1');
        await new Promise((resolve, reject) => {
          socket.once('connect', resolve);
          socket.once('error', reject);
        });
        return socket;
      }

      function rejectedPartHeader(boundary) {
        return [
          `--${boundary}`,
          'Content-Disposition: form-data; name="files"; filename="malware.exe"',
          'Content-Type: application/x-msdownload',
          '',
          '',
        ].join('\r\n');
      }

      async function openIncompleteRejectedUpload() {
        const { server, port } = await listen();
        const socket = await connect(port);
        const boundary = 'upload-drain-boundary';

        socket.write([
          'POST /upload HTTP/1.1',
          'Host: 127.0.0.1',
          `Content-Type: multipart/form-data; boundary=${boundary}`,
          'Transfer-Encoding: chunked',
          '',
          '',
        ].join('\r\n'));

        const writeChunk = (body) => {
          socket.write(`${Buffer.byteLength(body).toString(16)}\r\n${body}\r\n`);
        };

        writeChunk(rejectedPartHeader(boundary));
        // Busboy emits the file event only after the first body byte.
        writeChunk('x');

        return { server, socket, writeChunk };
      }

      async function closeWithin(socket, timeoutMs) {
        return new Promise((resolve) => {
          const timer = setTimeout(() => resolve(false), timeoutMs);
          socket.once('close', () => {
            clearTimeout(timer);
            resolve(true);
          });
        });
      }

      /** Collect everything the server sends until the socket closes. */
      async function readUntilClose(socket, timeoutMs = 8000) {
        const chunks = [];
        const result = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ timedOut: true, text: Buffer.concat(chunks).toString() }), timeoutMs);
          socket.on('data', (chunk) => chunks.push(chunk));
          socket.once('close', () => {
            clearTimeout(timer);
            resolve({ timedOut: false, text: Buffer.concat(chunks).toString() });
          });
        });
        return result;
      }

      async function closeServer(server, socket) {
        socket.destroy();
        await new Promise((resolve) => server.close(resolve));
      }

      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      it('responds 400 to a finite rejected upload whose remaining body exceeds the old 2 MiB ceiling', { timeout: 10000 }, async () => {
        // Declared length within policy marks the request finite, so the byte
        // ceiling is not what ends this request — EOF is.
        process.env.REJECTED_UPLOAD_DRAIN_MAX_TOTAL_BYTES = String(8 * 1024 * 1024);
        const { server, port } = await listen();
        const socket = await connect(port);
        const boundary = 'drain-finite-boundary';
        // A 3 MiB executable: rejected by MIME filter, but a legitimate finite
        // request — the client must receive its 400, not a reset.
        const body = Buffer.concat([
          Buffer.from(`${rejectedPartHeader(boundary)}\r\n`),
          Buffer.alloc(3 * 1024 * 1024, 0x78),
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);

        socket.write([
          'POST /upload HTTP/1.1',
          'Host: 127.0.0.1',
          `Content-Type: multipart/form-data; boundary=${boundary}`,
          `Content-Length: ${body.length}`,
          'Connection: close',
          '',
          '',
        ].join('\r\n'));
        socket.write(body);

        try {
          const { text } = await readUntilClose(socket);
          expect(text).toContain('HTTP/1.1 400');
          expect(text).toContain('not allowed');
        } finally {
          await closeServer(server, socket);
        }
      });

      it('responds 400 to a slowly progressing rejected upload that outlasts the old fixed drain window', { timeout: 10000 }, async () => {
        const { server, port } = await listen();
        const socket = await connect(port);
        const boundary = 'drain-slow-boundary';

        socket.write([
          'POST /upload HTTP/1.1',
          'Host: 127.0.0.1',
          `Content-Type: multipart/form-data; boundary=${boundary}`,
          'Transfer-Encoding: chunked',
          'Connection: close',
          '',
          '',
        ].join('\r\n'));

        const writeChunk = (body) => {
          socket.write(`${Buffer.byteLength(body).toString(16)}\r\n${body}\r\n`);
        };
        writeChunk(rejectedPartHeader(boundary));

        // Drip body bytes for ~900ms total — far beyond the old 250 ms
        // cutoff, but continuously progressing.
        for (let i = 0; i < 9; i++) {
          writeChunk('x'.repeat(64 * 1024));
          await sleep(100);
        }
        writeChunk(`\r\n--${boundary}--\r\n`);
        socket.write('0\r\n\r\n');

        try {
          const { text } = await readUntilClose(socket);
          expect(text).toContain('HTTP/1.1 400');
          expect(text).toContain('not allowed');
        } finally {
          await closeServer(server, socket);
        }
      });

      it('responds 400 for a rejected over-limit file whose body is still progressing', { timeout: 10000 }, async () => {
        // Ceiling above the declared body: this request is finite by
        // declaration, so it drains to EOF and receives its 400.
        process.env.REJECTED_UPLOAD_DRAIN_MAX_TOTAL_BYTES = String(16 * 1024 * 1024);
        const { server, port } = await listen();
        const socket = await connect(port);
        const boundary = 'drain-size-boundary';
        // text/plain passes the MIME filter but exceeds the 10MB file limit —
        // the size-rejection drain entry point.
        const bigContent = Buffer.alloc(11 * 1024 * 1024, 0x78);
        const body = Buffer.concat([
          Buffer.from([
            `--${boundary}`,
            'Content-Disposition: form-data; name="files"; filename="big.txt"',
            'Content-Type: text/plain',
            '',
            '',
          ].join('\r\n')),
          bigContent,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);

        socket.write([
          'POST /upload HTTP/1.1',
          'Host: 127.0.0.1',
          `Content-Type: multipart/form-data; boundary=${boundary}`,
          `Content-Length: ${body.length}`,
          'Connection: close',
          '',
          '',
        ].join('\r\n'));
        socket.write(body);

        try {
          const { text } = await readUntilClose(socket);
          expect(text).toContain('HTTP/1.1 400');
          expect(text).toContain('File too large');
        } finally {
          await closeServer(server, socket);
        }
      });

      it('terminates a rejected upload that stops making progress within the idle window', { timeout: 10000 }, async () => {
        const { server, socket } = await openIncompleteRejectedUpload();

        try {
          // The client stalls after the first body byte: the idle-progress
          // timeout (300ms under test) must bound the connection well within
          // the hard lifetime.
          expect(await closeWithin(socket, 2000)).toBe(true);
        } finally {
          await closeServer(server, socket);
        }
      });

      it('terminates a continuously progressing never-ending rejected upload at the hard lifetime bound', { timeout: 10000 }, async () => {
        const { server, port } = await listen();
        const socket = await connect(port);
        const boundary = 'drain-unbounded-boundary';

        socket.write([
          'POST /upload HTTP/1.1',
          'Host: 127.0.0.1',
          `Content-Type: multipart/form-data; boundary=${boundary}`,
          'Transfer-Encoding: chunked',
          '',
          '',
        ].join('\r\n'));

        const writeChunk = (body) => {
          socket.write(`${Buffer.byteLength(body).toString(16)}\r\n${body}\r\n`);
        };
        writeChunk(rejectedPartHeader(boundary));
        writeChunk('x');

        // Keep bytes flowing so only the hard lifetime (1.5s under test) can
        // end this — progress alone must never keep an abusive request open.
        const drip = setInterval(() => writeChunk('x'.repeat(64 * 1024)), 100);

        try {
          expect(await closeWithin(socket, 5000)).toBe(true);
        } finally {
          clearInterval(drip);
          await closeServer(server, socket);
        }
      });

      it('stops consuming a rejected upload after its total-byte safety ceiling', { timeout: 10000 }, async () => {
        const { server, socket, writeChunk } = await openIncompleteRejectedUpload();

        try {
          // The 1 MiB test ceiling is exceeded by a single large chunk on a
          // chunked (undeclared-length) request.
          writeChunk('x'.repeat(3 * 1024 * 1024));
          expect(await closeWithin(socket, 2000)).toBe(true);
        } finally {
          await closeServer(server, socket);
        }
      });
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
