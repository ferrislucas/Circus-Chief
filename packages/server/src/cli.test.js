import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

import { readFileSync } from 'fs';
import { describeBindHost, parseCliOptions } from './cli.js';

describe('parseCliOptions', () => {
  let exitSpy;
  let logSpy;
  let errorSpy;
  const originalEnv = process.env;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env = { ...originalEnv };
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.CIRCUSCHIEF_HOST;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it('returns default port when no arguments provided', () => {
    const result = parseCliOptions(['node', 'cli.js']);
    expect(result).toEqual({ port: 5000, host: '127.0.0.1', disableAnalytics: false, sslCert: null, sslKey: null, selfSigned: false, tlsDir: null });
  });

  it('parses custom port with -p flag', () => {
    const result = parseCliOptions(['node', 'cli.js', '-p', '8080']);
    expect(result).toEqual({ port: 8080, host: '127.0.0.1', disableAnalytics: false, sslCert: null, sslKey: null, selfSigned: false, tlsDir: null });
  });

  it('parses custom port with --port flag', () => {
    const result = parseCliOptions(['node', 'cli.js', '--port', '3000']);
    expect(result).toEqual({ port: 3000, host: '127.0.0.1', disableAnalytics: false, sslCert: null, sslKey: null, selfSigned: false, tlsDir: null });
  });

  it('exits with error for non-numeric port', () => {
    expect(() => parseCliOptions(['node', 'cli.js', '-p', 'abc'])).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid port')
    );
  });

  it('exits with error for out-of-range port (high)', () => {
    expect(() => parseCliOptions(['node', 'cli.js', '-p', '99999'])).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid port')
    );
  });

  it('exits with error for port zero', () => {
    expect(() => parseCliOptions(['node', 'cli.js', '-p', '0'])).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid port')
    );
  });

  it('exits with error for negative port', () => {
    // parseArgs with strict: true treats -1 as an unknown flag
    expect(() => parseCliOptions(['node', 'cli.js', '-p', '-1'])).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('shows help and exits with --help flag', () => {
    expect(() => parseCliOptions(['node', 'cli.js', '--help'])).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Usage:')
    );
  });

  it('shows help and exits with -h flag', () => {
    expect(() => parseCliOptions(['node', 'cli.js', '-h'])).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Usage:')
    );
  });

  it('shows version and exits with --version flag', () => {
    expect(() => parseCliOptions(['node', 'cli.js', '--version'])).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\d+\.\d+\.\d+/)
    );
  });

  it('shows version and exits with -V flag', () => {
    expect(() => parseCliOptions(['node', 'cli.js', '-V'])).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\d+\.\d+\.\d+/)
    );
  });

  it('exits with error for unknown flag', () => {
    expect(() => parseCliOptions(['node', 'cli.js', '--foo'])).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Usage:')
    );
  });

  it('accepts minimum valid port (1)', () => {
    const result = parseCliOptions(['node', 'cli.js', '-p', '1']);
    expect(result).toEqual({ port: 1, host: '127.0.0.1', disableAnalytics: false, sslCert: null, sslKey: null, selfSigned: false, tlsDir: null });
  });

  it('accepts maximum valid port (65535)', () => {
    const result = parseCliOptions(['node', 'cli.js', '-p', '65535']);
    expect(result).toEqual({ port: 65535, host: '127.0.0.1', disableAnalytics: false, sslCert: null, sslKey: null, selfSigned: false, tlsDir: null });
  });

  describe('PORT environment variable', () => {
    it('respects PORT env var when no CLI flag is given', () => {
      process.env.PORT = '8080';
      const result = parseCliOptions(['node', 'cli.js']);
      expect(result).toEqual({ port: 8080, host: '127.0.0.1', disableAnalytics: false, sslCert: null, sslKey: null, selfSigned: false, tlsDir: null });
    });

    it('CLI --port flag takes precedence over PORT env var', () => {
      process.env.PORT = '8080';
      const result = parseCliOptions(['node', 'cli.js', '--port', '3000']);
      expect(result).toEqual({ port: 3000, host: '127.0.0.1', disableAnalytics: false, sslCert: null, sslKey: null, selfSigned: false, tlsDir: null });
    });

    it('exits with error for invalid PORT env var', () => {
      process.env.PORT = 'not-a-port';
      expect(() => parseCliOptions(['node', 'cli.js'])).toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid port')
      );
    });
  });

  describe('--no-analytics flag', () => {
    it('returns disableAnalytics false by default', () => {
      const result = parseCliOptions(['node', 'cli.js']);
      expect(result.disableAnalytics).toBe(false);
    });

    it('returns disableAnalytics true with --no-analytics flag', () => {
      const result = parseCliOptions(['node', 'cli.js', '--no-analytics']);
      expect(result.disableAnalytics).toBe(true);
    });

    it('can combine --no-analytics with --port', () => {
      const result = parseCliOptions(['node', 'cli.js', '-p', '8080', '--no-analytics']);
      expect(result).toEqual({ port: 8080, host: '127.0.0.1', disableAnalytics: true, sslCert: null, sslKey: null, selfSigned: false, tlsDir: null });
    });
  });

  describe('--host flag', () => {
    it.each([
      ['--host', '0.0.0.0'],
      ['-H', '0.0.0.0'],
    ])('parses %s', (flag, host) => {
      const result = parseCliOptions(['node', 'cli.js', flag, host]);
      expect(result.host).toBe(host);
    });

    it.each(['::', '::1', '192.168.1.50', 'myhost.local'])(
      'passes through %s unchanged',
      (host) => {
        expect(parseCliOptions(['node', 'cli.js', '--host', host]).host).toBe(host);
      }
    );

    it('trims whitespace', () => {
      expect(parseCliOptions(['node', 'cli.js', '--host', '  ::1  ']).host).toBe('::1');
    });

    it.each(['', '   '])('rejects an empty host', (host) => {
      expect(() => parseCliOptions(['node', 'cli.js', '--host', host])).toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid host'));
    });

    it('combines with the other options', () => {
      expect(parseCliOptions(['node', 'cli.js', '-p', '8080', '-H', '0.0.0.0', '--no-analytics']))
        .toEqual({ port: 8080, host: '0.0.0.0', disableAnalytics: true, sslCert: null, sslKey: null, selfSigned: false, tlsDir: null });
    });

    it('includes host configuration in help text', () => {
      expect(() => parseCliOptions(['node', 'cli.js', '--help'])).toThrow('process.exit');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('--host'));
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('CIRCUSCHIEF_HOST'));
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('HOST'));
    });
  });

  describe('host environment variables (unsupported)', () => {
    it.each(['CIRCUSCHIEF_HOST', 'HOST'])('ignores %s when no CLI flag is given', (name) => {
      process.env[name] = '0.0.0.0';
      expect(parseCliOptions(['node', 'cli.js']).host).toBe('127.0.0.1');
    });

    it.each(['CIRCUSCHIEF_HOST', 'HOST'])('ignores %s even when set to a loopback address', (name) => {
      process.env[name] = '::1';
      expect(parseCliOptions(['node', 'cli.js']).host).toBe('127.0.0.1');
    });

    it('--host works alongside ambient host env vars', () => {
      process.env.CIRCUSCHIEF_HOST = '192.168.1.50';
      process.env.HOST = 'myhost.local';
      expect(parseCliOptions(['node', 'cli.js', '--host', '0.0.0.0']).host).toBe('0.0.0.0');
    });
  });

  describe('TLS flags', () => {
    it('defaults to no TLS', () => {
      const result = parseCliOptions(['node', 'cli.js']);
      expect(result).toEqual(expect.objectContaining({ sslCert: null, sslKey: null, selfSigned: false, tlsDir: null }));
    });

    it('parses --ssl-cert with --ssl-key', () => {
      const result = parseCliOptions(['node', 'cli.js', '--ssl-cert', './cert.pem', '--ssl-key', './key.pem']);
      expect(result.sslCert).toBe('./cert.pem');
      expect(result.sslKey).toBe('./key.pem');
      expect(result.selfSigned).toBe(false);
    });

    it('parses --self-signed', () => {
      const result = parseCliOptions(['node', 'cli.js', '--self-signed']);
      expect(result.selfSigned).toBe(true);
    });

    it('parses --tls-dir alongside --self-signed', () => {
      const result = parseCliOptions(['node', 'cli.js', '--self-signed', '--tls-dir', '/tmp/tls']);
      expect(result).toEqual(expect.objectContaining({ selfSigned: true, tlsDir: '/tmp/tls' }));
    });

    it.each([
      ['--ssl-cert', './cert.pem'],
      ['--ssl-key', './key.pem'],
    ])('exits with error when only %s is given', (flag, value) => {
      expect(() => parseCliOptions(['node', 'cli.js', flag, value])).toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('must be supplied together'));
    });

    it.each([
      [['--ssl-cert', './cert.pem', '--ssl-key', './key.pem']],
      [['--ssl-cert', './cert.pem']],
      [['--ssl-key', './key.pem']],
    ])('exits with error when --self-signed is combined with %s', (tlsArgs) => {
      expect(() => parseCliOptions(['node', 'cli.js', '--self-signed', ...tlsArgs])).toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Pick one'));
    });

    it('documents TLS flags in help text', () => {
      expect(() => parseCliOptions(['node', 'cli.js', '--help'])).toThrow('process.exit');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('--ssl-cert'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('--ssl-key'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('--self-signed'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('--tls-dir'));
    });
  });

  describe('describeBindHost', () => {
    it.each([
      ['127.0.0.1', { urlHost: '127.0.0.1', wildcard: false }],
      ['192.168.1.50', { urlHost: '192.168.1.50', wildcard: false }],
      ['myhost.local', { urlHost: 'myhost.local', wildcard: false }],
      ['::1', { urlHost: '[::1]', wildcard: false }],
      ['fd00::1', { urlHost: '[fd00::1]', wildcard: false }],
      ['0.0.0.0', { urlHost: 'localhost', wildcard: true }],
      ['::', { urlHost: 'localhost', wildcard: true }],
      ['0', { urlHost: 'localhost', wildcard: true }],
      ['::ffff:0.0.0.0', { urlHost: 'localhost', wildcard: true }],
    ])('describes %s', (host, expected) => {
      expect(describeBindHost(host)).toEqual(expected);
    });
  });

  describe('getVersion fallback', () => {
    it('returns "unknown" when package.json is unreadable', () => {
      readFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      expect(() => parseCliOptions(['node', 'cli.js', '--version'])).toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(0);
      expect(logSpy).toHaveBeenCalledWith('unknown');

      readFileSync.mockRestore();
    });
  });
});
