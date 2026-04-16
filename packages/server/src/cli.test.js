import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseCliOptions } from './cli.js';

describe('parseCliOptions', () => {
  let exitSpy;
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns default port when no arguments provided', () => {
    const result = parseCliOptions(['node', 'cli.js']);
    expect(result).toEqual({ port: 5000 });
  });

  it('parses custom port with -p flag', () => {
    const result = parseCliOptions(['node', 'cli.js', '-p', '8080']);
    expect(result).toEqual({ port: 8080 });
  });

  it('parses custom port with --port flag', () => {
    const result = parseCliOptions(['node', 'cli.js', '--port', '3000']);
    expect(result).toEqual({ port: 3000 });
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
    // parseArgs with strict mode treats -1 as an unknown flag
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

  it('exits with error for unknown flag', () => {
    expect(() => parseCliOptions(['node', 'cli.js', '--foo'])).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Usage:')
    );
  });

  it('accepts minimum valid port (1)', () => {
    const result = parseCliOptions(['node', 'cli.js', '-p', '1']);
    expect(result).toEqual({ port: 1 });
  });

  it('accepts maximum valid port (65535)', () => {
    const result = parseCliOptions(['node', 'cli.js', '-p', '65535']);
    expect(result).toEqual({ port: 65535 });
  });
});
