import { afterEach, describe, expect, it } from 'vitest';
import { lstat, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
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

  it('uses the local git exclude file without changing a tracked gitignore', async () => {
    const workingDirectory = await root();
    await execFileAsync('git', ['init'], { cwd: workingDirectory });
    const repository = { getHighWater: () => 0, readOutputPage: () => ({ chunks: [] }) };
    await getCommandRunOutputResource({ workingDirectory, run: { id: 'git_run', status: 'success', output: '', outputHighWater: 0 }, repository });
    expect(await readFile(join(workingDirectory, '.git', 'info', 'exclude'), 'utf8')).toContain('.circus/runs/');
  });

  it('uses the common Git exclude file for a linked worktree', async () => {
    const repositoryRoot = await root();
    const workingDirectory = await root();
    await execFileAsync('git', ['init'], { cwd: repositoryRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repositoryRoot });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repositoryRoot });
    await execFileAsync('git', ['commit', '--allow-empty', '-m', 'initial'], { cwd: repositoryRoot });
    await rm(workingDirectory, { recursive: true });
    await execFileAsync('git', ['worktree', 'add', workingDirectory, '-b', 'linked-test'], { cwd: repositoryRoot });
    const repository = { getHighWater: () => 0, readOutputPage: () => ({ chunks: [] }) };
    await getCommandRunOutputResource({ workingDirectory, run: { id: 'linked_run', status: 'success', legacyByteLength: 0, outputHighWater: 0 }, repository });
    const { stdout } = await execFileAsync('git', ['check-ignore', '.circus/runs/linked_run/output.log'], { cwd: workingDirectory });
    expect(stdout.trim()).toBe('.circus/runs/linked_run/output.log');
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
