import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  appendCommandRunOutputResource,
  getCommandRunOutputResource,
  OUTPUT_BYTE_WINDOW,
  removeCommandRunOutputResource,
} from './commandRunOutputResource.js';

const roots = [];
const execFileAsync = promisify(execFile);
async function root() { const value = await mkdtemp(join(tmpdir(), 'circus-output-')); roots.push(value); return value; }
afterEach(async () => { await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true }))); });

describe('commandRunOutputResource', () => {
  it('writes ordered chunks to a workspace-relative transcript and reuses it', async () => {
    const workingDirectory = await root();
    const pages = new Map([[0, [{ sequence: 1, content: 'stdout\n' }, { sequence: 2, content: 'stderr\n' }]]]);
    const repository = { getHighWater: () => 2, readOutputPage: (_id, after) => ({ chunks: pages.get(after) || [] }) };
    const run = { id: 'run_123', status: 'error', output: '', outputHighWater: 2 };

    const descriptor = await getCommandRunOutputResource({ workingDirectory, run, repository });
    expect(descriptor).toMatchObject({ path: '.circus/runs/run_123/output.log', complete: true, byteLength: 14 });
    expect(await readFile(join(workingDirectory, descriptor.path), 'utf8')).toBe('stdout\nstderr\n');
    expect(await getCommandRunOutputResource({ workingDirectory, run, repository })).toMatchObject(descriptor);
  });

  it('creates a stable empty resource and appends new persisted chunks while running', async () => {
    const workingDirectory = await root();
    let highWater = 0;
    const chunks = [];
    const repository = { getHighWater: () => highWater, readOutputPage: (_id, after) => ({ chunks: chunks.filter((chunk) => chunk.sequence > after) }) };
    const run = { id: 'run_running', status: 'running', output: '', outputHighWater: 0 };
    const first = await getCommandRunOutputResource({ workingDirectory, run, repository });
    expect(first).toMatchObject({ complete: false, byteLength: 0 });
    chunks.push({ sequence: 1, content: 'new output\n' }); highWater = 1; run.outputHighWater = 1;
    const second = await getCommandRunOutputResource({ workingDirectory, run, repository });
    expect(second.path).toBe(first.path);
    expect(await readFile(join(workingDirectory, second.path), 'utf8')).toBe('new output\n');
  });

  it('reconciles output persisted between its historical snapshot and live registration', async () => {
    const workingDirectory = await root();
    const chunks = [{ sequence: 1, content: 'before handoff\n' }];
    const run = { id: 'handoff_gap', sessionId: 'session_1', status: 'running', legacyByteLength: 0, outputHighWater: 1 };
    let handoffAppend;
    let releaseHandoff;
    let signalSnapshotRead;
    const handoffBarrier = new Promise((resolve) => { releaseHandoff = resolve; });
    const snapshotRead = new Promise((resolve) => { signalSnapshotRead = resolve; });
    const repository = {
      getHighWater: () => chunks.at(-1)?.sequence || 0,
      readOutputPage: (_id, after) => ({ chunks: chunks.filter((chunk) => chunk.sequence > after) }),
      getOutputResourceMetadata: () => {
        if (!handoffAppend) {
          const handoffChunk = { sequence: 2, content: 'during handoff\n' };
          chunks.push(handoffChunk);
          run.outputHighWater = 2;
          handoffAppend = appendCommandRunOutputResource({ workingDirectory, runId: run.id, chunks: [handoffChunk] });
        }
        return run;
      },
    };

    const descriptorPromise = getCommandRunOutputResource({
      workingDirectory,
      run,
      repository,
      beforeLiveRegistration: () => {
        signalSnapshotRead();
        return handoffBarrier;
      },
    });
    await expect(Promise.race([
      snapshotRead.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 50)),
    ])).resolves.toBe(true);
    const laterChunk = { sequence: 3, content: 'after handoff\n' };
    chunks.push(laterChunk);
    run.outputHighWater = 3;
    const laterAppend = appendCommandRunOutputResource({ workingDirectory, runId: run.id, chunks: [laterChunk] });
    releaseHandoff();
    const descriptor = await descriptorPromise;
    await expect(handoffAppend).resolves.toBe(true);
    await expect(laterAppend).resolves.toBe(true);

    expect(await readFile(join(workingDirectory, descriptor.path), 'utf8')).toBe('before handoff\nduring handoff\nafter handoff\n');
  });

  it('finishes the handoff as complete when the run completes', async () => {
    const workingDirectory = await root();
    const chunks = [{ sequence: 1, content: 'before completion\n' }];
    const run = { id: 'handoff_complete', sessionId: 'session_1', status: 'running', legacyByteLength: 0, outputHighWater: 1 };
    const repository = {
      getHighWater: () => chunks.at(-1)?.sequence || 0,
      readOutputPage: (_id, after) => ({ chunks: chunks.filter((chunk) => chunk.sequence > after) }),
      getOutputResourceMetadata: () => run,
    };

    const descriptor = await getCommandRunOutputResource({
      workingDirectory,
      run,
      repository,
      beforeLiveRegistration: () => {
        chunks.push({ sequence: 2, content: 'at completion\n' });
        Object.assign(run, { status: 'success', outputHighWater: 2 });
      },
    });

    expect(descriptor).toMatchObject({ complete: true, status: 'success' });
    expect(await readFile(join(workingDirectory, descriptor.path), 'utf8')).toBe('before completion\nat completion\n');
    await expect(appendCommandRunOutputResource({
      workingDirectory, runId: run.id, chunks: [{ sequence: 3, content: 'must not resurrect\n' }],
    })).resolves.toBe(false);
  });

  it('does not expose or resurrect an artifact when the run is deleted during handoff', async () => {
    const workingDirectory = await root();
    let deleted = false;
    const run = { id: 'handoff_deleted', sessionId: 'session_1', status: 'running', legacyByteLength: 0, outputHighWater: 0 };
    const repository = {
      getHighWater: () => 0,
      readOutputPage: () => ({ chunks: [] }),
      getOutputResourceMetadata: () => (deleted ? null : run),
    };

    await expect(getCommandRunOutputResource({
      workingDirectory,
      run,
      repository,
      beforeLiveRegistration: () => { deleted = true; },
    })).rejects.toMatchObject({ notFound: true });
    await expect(appendCommandRunOutputResource({
      workingDirectory, runId: run.id, chunks: [{ sequence: 1, content: 'deleted\n' }],
    })).resolves.toBe(false);
  });

  it('reconciles a materialized transcript from persisted output after an append failure', async () => {
    const workingDirectory = await root();
    const chunks = [];
    const run = { id: 'append_failure', sessionId: 'session_1', status: 'running', legacyByteLength: 0, outputHighWater: 0 };
    const repository = {
      getHighWater: () => chunks.length,
      getOutputResourceMetadata: () => run,
      readOutputPage: (_id, after) => ({ chunks: chunks.filter((chunk) => chunk.sequence > after) }),
    };

    const descriptor = await getCommandRunOutputResource({ workingDirectory, run, repository });
    await rm(join(workingDirectory, '.circus', 'runs', run.id, 'output.log'));
    chunks.push({ sequence: 1, content: 'persisted despite append failure\n' });
    run.outputHighWater = 1;

    await expect(appendCommandRunOutputResource({
      workingDirectory,
      runId: run.id,
      chunks: [{ sequence: 1, content: 'persisted despite append failure\n' }],
    })).rejects.toThrow();

    await getCommandRunOutputResource({ workingDirectory, run, repository });
    expect(await readFile(join(workingDirectory, descriptor.path), 'utf8')).toBe('persisted despite append failure\n');
  });

  it('appends live chunks through bounded byte writes at and above 64 KiB', async () => {
    const workingDirectory = await root();
    const chunks = [];
    const run = { id: 'large_live_chunk', sessionId: 'session_1', status: 'running', legacyByteLength: 0, outputHighWater: 0 };
    const repository = {
      getHighWater: () => chunks.length,
      getOutputResourceMetadata: () => run,
      readOutputPage: (_id, after) => ({ chunks: chunks.filter((chunk) => chunk.sequence > after) }),
    };
    const descriptor = await getCommandRunOutputResource({ workingDirectory, run, repository });
    const exactWindow = Buffer.alloc(OUTPUT_BYTE_WINDOW, 0x61);
    const justOverWindow = Buffer.concat([Buffer.from('é'), Buffer.alloc(OUTPUT_BYTE_WINDOW, 0x62)]);
    const substantiallyLarge = Buffer.alloc(OUTPUT_BYTE_WINDOW * 8 + 17, 0x63);
    const subsequent = Buffer.from('still live\n');
    const appended = [exactWindow, justOverWindow, substantiallyLarge, subsequent].map((content, index) => ({ sequence: index + 1, content }));
    chunks.push(...appended);
    run.outputHighWater = appended.length;

    await expect(appendCommandRunOutputResource({ workingDirectory, runId: run.id, chunks: appended })).resolves.toBe(true);
    expect(await readFile(join(workingDirectory, descriptor.path))).toEqual(Buffer.concat([exactWindow, justOverWindow, substantiallyLarge, subsequent]));
    await expect(appendCommandRunOutputResource({
      workingDirectory, runId: run.id, chunks: [{ sequence: 5, content: Buffer.from('later output\n') }],
    })).resolves.toBe(true);
    expect(await readFile(join(workingDirectory, descriptor.path))).toEqual(Buffer.concat([
      exactWindow, justOverWindow, substantiallyLarge, subsequent, Buffer.from('later output\n'),
    ]));
  });

  it('surfaces a partial live-write failure and reconciles the artifact from persisted chunks', async () => {
    const workingDirectory = await root();
    const persisted = [{ sequence: 1, content: Buffer.from('first\n') }, { sequence: 2, content: Buffer.from('second\n') }];
    let visibleChunks = [];
    const run = { id: 'partial_live_failure', sessionId: 'session_1', status: 'running', legacyByteLength: 0, outputHighWater: 2 };
    const repository = {
      getHighWater: () => visibleChunks.length,
      getOutputResourceMetadata: () => run,
      readOutputPage: (_id, after) => ({ chunks: visibleChunks.filter((chunk) => chunk.sequence > after) }),
    };
    const descriptor = await getCommandRunOutputResource({ workingDirectory, run: { ...run, outputHighWater: 0 }, repository });
    const output = join(workingDirectory, descriptor.path);
    visibleChunks = persisted;
    const failingChunk = {
      sequence: 2,
      get content() {
        rmSync(output);
        return persisted[1].content;
      },
    };

    await expect(appendCommandRunOutputResource({
      workingDirectory, runId: run.id, chunks: [persisted[0], failingChunk],
    })).rejects.toThrow('append failed');
    await expect(appendCommandRunOutputResource({
      workingDirectory, runId: run.id, chunks: [{ sequence: 3, content: Buffer.from('stale\n') }],
    })).resolves.toBe(false);

    await getCommandRunOutputResource({ workingDirectory, run, repository });
    expect(await readFile(output)).toEqual(Buffer.concat(persisted.map((chunk) => chunk.content)));
  });

  it('reconstructs an oversized persisted chunk through bounded byte reads', async () => {
    const workingDirectory = await root();
    const byteWindow = OUTPUT_BYTE_WINDOW;
    const output = Buffer.from(`stdout: ${'\u00e9'.repeat(90_000)}\nstderr: done\n`);
    const reads = [];
    const repository = {
      getHighWater: () => 1,
      readOutputByteWindow: (_id, sequence, offset, limit) => {
        reads.push({ sequence, offset, limit });
        expect(limit).toBeLessThanOrEqual(byteWindow);
        if ((sequence >= 1 && offset === 0) || sequence > 1 || (sequence === 1 && offset >= output.length)) return null;
        return { sequence: 1, byteLength: output.length, content: output.subarray(offset, offset + limit) };
      },
    };

    const descriptor = await getCommandRunOutputResource({
      workingDirectory,
      run: { id: 'oversized_chunk', status: 'success', legacyByteLength: 0, outputHighWater: 1 },
      repository,
    });

    expect(reads).toHaveLength(Math.ceil(output.length / byteWindow) + 1);
    expect(await readFile(join(workingDirectory, descriptor.path))).toEqual(output);
  });

  it('preserves mixed UTF-8, empty, and stdout/stderr chunks while reconstructing byte windows', async () => {
    const workingDirectory = await root();
    const chunks = [
      { sequence: 1, content: Buffer.from('stdout: caf') },
      { sequence: 2, content: Buffer.from('\u00e9\n') },
      { sequence: 3, content: Buffer.alloc(0) },
      { sequence: 4, content: Buffer.from('stderr: \u96fb\u6c17\nstdout: fin\n') },
    ];
    const expected = Buffer.concat(chunks.map(({ content }) => content));
    const repository = {
      getHighWater: () => 4,
      readOutputByteWindow: (_id, sequence, offset, limit) => {
        const chunk = chunks.find((candidate) => candidate.sequence > sequence || (candidate.sequence === sequence && offset > 0 && offset < candidate.content.length));
        if (!chunk) return null;
        const start = chunk.sequence === sequence ? offset : 0;
        return { sequence: chunk.sequence, byteLength: chunk.content.length, content: chunk.content.subarray(start, start + limit) };
      },
    };

    const descriptor = await getCommandRunOutputResource({
      workingDirectory,
      run: { id: 'mixed_bytes', status: 'success', legacyByteLength: 0, outputHighWater: 4 },
      repository,
    });

    expect(descriptor.byteLength).toBe(expected.length);
    expect(await readFile(join(workingDirectory, descriptor.path))).toEqual(expected);
  });

  it('materializes full legacy output and rejects unsafe run IDs', async () => {
    const workingDirectory = await root();
    const legacy = 'é'.repeat(40_000);
    const bytes = Buffer.from(legacy);
    const repository = {
      getHighWater: () => 0,
      readOutputPage: () => ({ chunks: [] }),
      readLegacyOutputPage: (_id, offset, limit) => bytes.subarray(offset, offset + limit),
    };
    const descriptor = await getCommandRunOutputResource({ workingDirectory, run: { id: 'legacy_1', status: 'success', legacyByteLength: bytes.length, outputHighWater: 0 }, repository });
    expect(await readFile(join(workingDirectory, descriptor.path), 'utf8')).toBe(legacy);
    await expect(getCommandRunOutputResource({ workingDirectory, run: { id: '../escape', status: 'success', output: '', outputHighWater: 0 }, repository })).rejects.toThrow();
    await removeCommandRunOutputResource({ workingDirectory, runId: 'legacy_1' });
  });

  it('does not follow workspace-controlled Git indirection to mutate external metadata', async () => {
    const workingDirectory = await root();
    const externalGitDirectory = await root();
    const externalExclude = join(externalGitDirectory, '.git', 'info', 'exclude');
    await execFileAsync('git', ['init'], { cwd: externalGitDirectory });
    await writeFile(join(workingDirectory, '.git'), `gitdir: ${join(externalGitDirectory, '.git')}\n`);
    await writeFile(externalExclude, 'external rules\n');
    await chmod(externalExclude, 0o000);
    const repository = { getHighWater: () => 0, readOutputPage: () => ({ chunks: [] }) };
    await expect(getCommandRunOutputResource({
      workingDirectory, run: { id: 'git_run', status: 'success', output: '', outputHighWater: 0 }, repository,
    })).resolves.toMatchObject({ path: '.circus/runs/git_run/output.log' });
    await chmod(externalExclude, 0o600);
    expect(await readFile(externalExclude, 'utf8')).toBe('external rules\n');
  });

  it('creates an output resource without Git metadata mutation', async () => {
    const workingDirectory = await root();
    const repository = { getHighWater: () => 0, readOutputPage: () => ({ chunks: [] }) };
    const descriptor = await getCommandRunOutputResource({ workingDirectory, run: { id: 'no_git_run', status: 'success', legacyByteLength: 0, outputHighWater: 0 }, repository });
    expect(descriptor.path).toBe('.circus/runs/no_git_run/output.log');
    await expect(lstat(join(workingDirectory, '.git'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects symlinks inside the managed output tree', async () => {
    const workingDirectory = await root();
    const outside = await root();
    await symlink(outside, join(workingDirectory, '.circus'));
    const repository = { getHighWater: () => 0, readOutputPage: () => ({ chunks: [] }) };
    await expect(getCommandRunOutputResource({ workingDirectory, run: { id: 'safe_run', status: 'success', legacyByteLength: 0, outputHighWater: 0 }, repository })).rejects.toThrow();
    expect((await lstat(outside)).isDirectory()).toBe(true);
  });
});
