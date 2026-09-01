import { appendFile, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const locks = new Map();
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const PAGE_SIZE = 100;

export class CommandOutputResourceError extends Error {
  constructor(message = 'Command output resource could not be materialized') {
    super(message);
    this.name = 'CommandOutputResourceError';
  }
}

function within(root, target) {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !rel.includes('../'));
}

async function normalDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new CommandOutputResourceError();
}

async function registerGitExclude(root) {
  try {
    const dotGit = join(root, '.git');
    const info = await lstat(dotGit);
    let gitDirectory = dotGit;
    if (!info.isDirectory()) {
      const pointer = await readFile(dotGit, 'utf8');
      const match = /^gitdir:\s*(.+)\s*$/m.exec(pointer);
      if (!match) return;
      gitDirectory = resolve(root, match[1]);
    }
    const exclude = join(gitDirectory, 'info', 'exclude');
    await mkdir(dirname(exclude), { recursive: true, mode: 0o700 });
    let current = '';
    try { current = await readFile(exclude, 'utf8'); } catch { /* New repository metadata. */ }
    if (!current.split(/\r?\n/).includes('.circus/runs/')) {
      await appendFile(exclude, `${current && !current.endsWith('\n') ? '\n' : ''}.circus/runs/\n`, { encoding: 'utf8', mode: 0o600 });
    }
  } catch (error) {
    // A non-git workspace remains supported. Git metadata is deliberately best
    // effort so an unrelated permission issue cannot prevent transcript access.
    if (error?.code !== 'ENOENT') console.error('Unable to register Circus output git exclude:', error);
  }
}

async function pathsFor(workingDirectory, runId) {
  if (!RUN_ID.test(runId)) throw new CommandOutputResourceError();
  let root;
  try {
    root = await realpath(workingDirectory);
    const circus = resolve(root, '.circus');
    const runs = resolve(circus, 'runs');
    const runDirectory = resolve(runs, runId);
    if (![circus, runs, runDirectory].every((item) => within(root, item))) throw new CommandOutputResourceError();
    await normalDirectory(circus);
    await normalDirectory(runs);
    await normalDirectory(runDirectory);
    await registerGitExclude(root);
    return { root, runDirectory, output: resolve(runDirectory, 'output.log'), state: resolve(runDirectory, 'output.state.json') };
  } catch (error) {
    if (error instanceof CommandOutputResourceError) throw error;
    throw new CommandOutputResourceError();
  }
}

async function readState(path) {
  try {
    const state = JSON.parse(await readFile(path, 'utf8'));
    if (Number.isInteger(state.sequence) && state.sequence >= 0 && Number.isInteger(state.size) && state.size >= 0) return state;
  } catch { /* A missing/corrupt state is safely rebuilt. */ }
  return null;
}

async function writeState(path, state) {
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(state), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await rename(temp, path);
}

async function outputStat(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new CommandOutputResourceError();
    return info;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeLegacy(output, legacy) {
  // Buffer slices avoid cutting a UTF-8 character in half while keeping writes bounded.
  const data = Buffer.from(legacy, 'utf8');
  for (let offset = 0; offset < data.length; offset += 64 * 1024) {
    await appendFile(output, data.subarray(offset, offset + 64 * 1024));
  }
}

async function appendChunks(output, chunks) {
  for (const chunk of chunks) await appendFile(output, chunk.content, { encoding: 'utf8' });
}

async function copyChunkPages(output, runId, repository, initialSequence = 0) {
  let sequence = initialSequence;
  let chunks;
  do {
    ({ chunks } = repository.readOutputPage(runId, sequence, PAGE_SIZE));
    if (chunks.length) {
      await appendChunks(output, chunks);
      sequence = chunks.at(-1).sequence;
    }
  } while (chunks.length === PAGE_SIZE);
  return sequence;
}

async function rebuild(paths, run, repository) {
  const temporary = `${paths.output}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, '', { mode: 0o600, flag: 'wx' });
    let sequence = 0;
    if (run.output && !run.outputHighWater) {
      await writeLegacy(temporary, run.output);
      sequence = 1;
    } else {
      sequence = await copyChunkPages(temporary, run.id, repository);
    }
    await rename(temporary, paths.output);
    const info = await outputStat(paths.output);
    await writeState(paths.state, { sequence, size: info.size, legacy: Boolean(run.output && !run.outputHighWater) });
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function materialize(paths, run, repository) {
  const state = await readState(paths.state);
  let outputInfo = await outputStat(paths.output);
  if (!state || !outputInfo || state.size !== outputInfo.size || (state.legacy && run.outputHighWater)) {
    await rebuild(paths, run, repository);
    return;
  }
  if (state.legacy || !run.outputHighWater) return;
  const highWater = repository.getHighWater(run.id);
  if (state.sequence > highWater) return rebuild(paths, run, repository);
  const sequence = await copyChunkPages(paths.output, run.id, repository, state.sequence);
  outputInfo = await outputStat(paths.output);
  await writeState(paths.state, { sequence, size: outputInfo.size, legacy: false });
}

function synchronized(key, operation) {
  const previous = locks.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  locks.set(key, next);
  return next.finally(() => { if (locks.get(key) === next) locks.delete(key); });
}

export async function getCommandRunOutputResource({ workingDirectory, run, repository }) {
  const paths = await pathsFor(workingDirectory, run.id);
  return synchronized(paths.output, async () => {
    try {
      await materialize(paths, run, repository);
      const info = await outputStat(paths.output);
      return {
        runId: run.id,
        status: run.status,
        contentType: 'text/plain; charset=utf-8',
        byteLength: info.size,
        complete: run.status !== 'running',
        updatedAt: Math.floor(info.mtimeMs),
        path: `.circus/runs/${run.id}/output.log`,
      };
    } catch (error) {
      if (error instanceof CommandOutputResourceError) throw error;
      throw new CommandOutputResourceError();
    }
  });
}

export async function removeCommandRunOutputResource({ workingDirectory, runId }) {
  const paths = await pathsFor(workingDirectory, runId);
  await rm(paths.runDirectory, { recursive: true, force: true });
}
