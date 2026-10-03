import { describe, it, expect, beforeEach } from 'vitest';
import { accessSync, constants } from 'node:fs';
import { mkdtemp, writeFile, chmod, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearMuseCliVersionCache, isMuseCliCompatible, parseMuseSemver, readMuseCliVersion } from './museCliVersion.js';

describe('parseMuseSemver', () => {
  it('parses plain and suffixed versions', () => {
    expect(parseMuseSemver('1.4.2')).toEqual({ major: 1, minor: 4, patch: 2 });
    expect(parseMuseSemver('1.4.0-R3401.1')).toEqual({ major: 1, minor: 4, patch: 0 });
    expect(parseMuseSemver('2.0.0-beta.1')).toEqual({ major: 2, minor: 0, patch: 0 });
  });

  it('returns null for missing or unparseable versions', () => {
    expect(parseMuseSemver(null)).toBeNull();
    expect(parseMuseSemver('')).toBeNull();
    expect(parseMuseSemver('latest')).toBeNull();
  });
});

describe('isMuseCliCompatible (finding #3)', () => {
  it('accepts an exact match', () => {
    expect(isMuseCliCompatible('1.4.2', '1.4.2')).toEqual({ compatible: true, drift: 'match' });
  });

  it('accepts minor and patch drift under the same major', () => {
    expect(isMuseCliCompatible('1.5.0', '1.4.2')).toEqual({ compatible: true, drift: 'minor-drift' });
    expect(isMuseCliCompatible('1.4.1', '1.4.2')).toEqual({ compatible: true, drift: 'minor-drift' });
    expect(isMuseCliCompatible('1.3.9', '1.4.2')).toEqual({ compatible: true, drift: 'minor-drift' });
  });

  it('rejects major jumps', () => {
    expect(isMuseCliCompatible('2.0.0', '1.4.2')).toEqual({ compatible: false, drift: 'major-mismatch' });
    expect(isMuseCliCompatible('0.9.9', '1.4.2')).toEqual({ compatible: false, drift: 'major-mismatch' });
  });

  it('rejects unknown versions', () => {
    expect(isMuseCliCompatible(null, '1.4.2')).toEqual({ compatible: false, drift: 'unknown' });
    expect(isMuseCliCompatible('bogus', '1.4.2')).toEqual({ compatible: false, drift: 'unknown' });
  });
});

/**
 * Finding #1: the preflight must resolve the `muse` launcher against the
 * *derived host env* (the PATH the parity gate validated and the real
 * `muse serve` spawn receives), not the server process PATH. A bare-name
 * launcher must be resolved to an absolute executable path before it is
 * stat'ed, exec'ed, or cached.
 */
describe('readMuseCliVersion (finding #1)', () => {
  let binDir;
  let musePath;
  let execCalls;

  beforeEach(async () => {
    clearMuseCliVersionCache();
    binDir = await mkdtemp(join(tmpdir(), 'muse-cli-version-'));
    musePath = join(binDir, 'muse');
    await writeFile(musePath, '#!/bin/sh\necho "muse 1.4.2"\n');
    await chmod(musePath, 0o755);
    accessSync(musePath, constants.X_OK); // sanity: resolvable on this host
    execCalls = [];
  });

  function fakeExec() {
    return async (file, args, options) => {
      execCalls.push({ file, args, options });
      return { stdout: 'muse 1.4.2\n' };
    };
  }

  it('forwards the supplied env to the version exec', async () => {
    const env = { PATH: '/usr/bin:/bin', HOME: '/Users/dev' };
    const version = await readMuseCliVersion(musePath, { execFile: fakeExec(), env });
    expect(version).toBe('1.4.2');
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].options.env).toBe(env);
  });

  it('resolves a bare launcher to an absolute path via findExecutableOnPath(env, museBin)', async () => {
    const env = { PATH: `${binDir}:/usr/bin:/bin` };
    const version = await readMuseCliVersion('muse', { execFile: fakeExec(), env });
    expect(version).toBe('1.4.2');
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].file).toBe(musePath);
  });

  it('caches by resolved absolute path so an unchanged binary execs once for the bare launcher config', async () => {
    const env = { PATH: `${binDir}:/usr/bin:/bin` };
    const exec = fakeExec();
    await readMuseCliVersion('muse', { execFile: exec, env });
    await readMuseCliVersion('muse', { execFile: exec, env });
    expect(execCalls).toHaveLength(1);
  });

  it('re-execs after the resolved binary changes on disk', async () => {
    const env = { PATH: `${binDir}:/usr/bin:/bin` };
    const exec = fakeExec();
    await readMuseCliVersion('muse', { execFile: exec, env });
    // Simulate a CLI upgrade: touch the binary's mtime past the cached one.
    const later = new Date(Date.now() + 5000);
    await utimes(musePath, later, later);
    await readMuseCliVersion('muse', { execFile: exec, env });
    expect(execCalls).toHaveLength(2);
  });
});
