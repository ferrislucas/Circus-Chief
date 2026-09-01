import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCommandRunOutputResource, removeCommandRunOutputResource } from './commandRunOutputResource.js';

const roots = [];
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

  it('materializes full legacy output and rejects unsafe run IDs', async () => {
    const workingDirectory = await root();
    const legacy = 'é'.repeat(40_000);
    const repository = { getHighWater: () => 0, readOutputPage: () => ({ chunks: [] }) };
    const descriptor = await getCommandRunOutputResource({ workingDirectory, run: { id: 'legacy_1', status: 'success', output: legacy, outputHighWater: 0 }, repository });
    expect(await readFile(join(workingDirectory, descriptor.path), 'utf8')).toBe(legacy);
    await expect(getCommandRunOutputResource({ workingDirectory, run: { id: '../escape', status: 'success', output: '', outputHighWater: 0 }, repository })).rejects.toThrow();
    await removeCommandRunOutputResource({ workingDirectory, runId: 'legacy_1' });
  });

  it('uses the local git exclude file without changing a tracked gitignore', async () => {
    const workingDirectory = await root();
    await mkdir(join(workingDirectory, '.git', 'info'), { recursive: true });
    const repository = { getHighWater: () => 0, readOutputPage: () => ({ chunks: [] }) };
    await getCommandRunOutputResource({ workingDirectory, run: { id: 'git_run', status: 'success', output: '', outputHighWater: 0 }, repository });
    expect(await readFile(join(workingDirectory, '.git', 'info', 'exclude'), 'utf8')).toContain('.circus/runs/');
  });
});
