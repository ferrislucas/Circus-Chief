import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

import { readFileSync } from 'fs';
import { parseCliOptions } from './cli.js';

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it('returns default port when no arguments provided', () => {
    const result = parseCliOptions(['node', 'cli.js']);
    expect(result).toEqual({ port: 5000, disableAnalytics: false });
  });

  it('parses custom port with -p flag', () => {
    const result = parseCliOptions(['node', 'cli.js', '-p', '8080']);
    expect(result).toEqual({ port: 8080, disableAnalytics: false });
  });

  it('parses custom port with --port flag', () => {
    const result = parseCliOptions(['node', 'cli.js', '--port', '3000']);
    expect(result).toEqual({ port: 3000, disableAnalytics: false });
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
    expect(result).toEqual({ port: 1, disableAnalytics: false });
  });

  it('accepts maximum valid port (65535)', () => {
    const result = parseCliOptions(['node', 'cli.js', '-p', '65535']);
    expect(result).toEqual({ port: 65535, disableAnalytics: false });
  });

  describe('PORT environment variable', () => {
    it('respects PORT env var when no CLI flag is given', () => {
      process.env.PORT = '8080';
      const result = parseCliOptions(['node', 'cli.js']);
      expect(result).toEqual({ port: 8080, disableAnalytics: false });
    });

    it('CLI --port flag takes precedence over PORT env var', () => {
      process.env.PORT = '8080';
      const result = parseCliOptions(['node', 'cli.js', '--port', '3000']);
      expect(result).toEqual({ port: 3000, disableAnalytics: false });
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
      expect(result).toEqual({ port: 8080, disableAnalytics: true });
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
