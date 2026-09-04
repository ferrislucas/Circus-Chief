import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { resolveGitExcludePath } from './gitService.js';
import { COMMAND_RUN_OUTPUT_BYTE_WINDOW } from '../db/CommandRunRepository.js';

const locks = new Map();
const materializedArtifacts = new Map();
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
export const OUTPUT_BYTE_WINDOW = COMMAND_RUN_OUTPUT_BYTE_WINDOW;

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

function artifactKey(root, runId) {
  return `${root}\0${runId}`;
}

async function normalDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new CommandOutputResourceError();
}

async function readNormalFile(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new CommandOutputResourceError();
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

async function registerGitExclude(root) {
  try {
    const resolved = await resolveGitExcludePath(root);
    if (!resolved) return;
    const common = await realpath(resolved.commonDirectory);
    const exclude = resolve(resolved.excludePath);
    if (!within(common, exclude)) throw new CommandOutputResourceError();
    await mkdir(dirname(exclude), { recursive: true, mode: 0o700 });
    const parent = await realpath(dirname(exclude));
    if (!within(common, parent)) throw new CommandOutputResourceError();
    const current = await readNormalFile(exclude);
    if (!current.split(/\r?\n/).includes('.circus/runs/')) {
      const handle = await open(exclude, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
      try {
        await handle.writeFile(`${current && !current.endsWith('\n') ? '\n' : ''}.circus/runs/\n`, 'utf8');
      } finally {
        await handle.close();
      }
    }
  } catch (error) {
    if (error instanceof CommandOutputResourceError) throw error;
    throw new CommandOutputResourceError();
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

async function appendData(output, data) {
  const handle = await open(output, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
  try { await handle.writeFile(data); } finally { await handle.close(); }
}

/** Writes one bounded byte slice; memory use is O(OUTPUT_BYTE_WINDOW). */
async function appendBoundedWindow(output, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content || '');
  if (bytes.length > OUTPUT_BYTE_WINDOW) throw new CommandOutputResourceError('Command output byte window exceeded');
  if (bytes.length) await appendData(output, bytes);
  return bytes.length;
}

async function writeLegacy(output, run, repository) {
  for (let offset = 0; offset < run.legacyByteLength; offset += OUTPUT_BYTE_WINDOW) {
    const page = repository.readLegacyOutputPage(run.id, offset, OUTPUT_BYTE_WINDOW);
    if (!page.length) break;
    const copied = await appendBoundedWindow(output, page);
    if (copied < OUTPUT_BYTE_WINDOW) break;
  }
}

async function appendChunks(output, chunks) {
  for (const chunk of chunks) await appendBoundedWindow(output, chunk.content);
}

async function copyChunkWindows(output, runId, repository, initialSequence = 0) {
  // Compatibility for narrow test doubles. Production repositories use the
  // byte-window reader below and never expose a full chunk to this service.
  if (!repository.readOutputByteWindow) return copyChunkRows(output, runId, repository, initialSequence);

  let sequence = initialSequence;
  let offset = 0;
  for (;;) {
    const chunk = repository.readOutputByteWindow(runId, sequence, offset, OUTPUT_BYTE_WINDOW);
    if (!chunk) return sequence;
    const copied = await appendBoundedWindow(output, chunk.content);
    const byteLength = Number(chunk.byteLength);
    if (!Number.isInteger(byteLength) || byteLength < offset + copied) {
      throw new CommandOutputResourceError('Invalid command output byte window');
    }
    if (offset + copied < byteLength) {
      if (!copied) throw new CommandOutputResourceError('Empty command output byte window');
      offset += copied;
    } else {
      sequence = chunk.sequence;
      offset = 0;
    }
  }
}

async function copyChunkRows(output, runId, repository, initialSequence) {
  let sequence = initialSequence;
  let chunks;
  do {
    ({ chunks } = repository.readOutputPage(runId, sequence, 100));
    if (chunks.length) {
      await appendChunks(output, chunks);
      sequence = chunks.at(-1).sequence;
    }
  } while (chunks.length === 100);
  return sequence;
}

async function rebuild(paths, run, repository) {
  const temporary = `${paths.output}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, '', { mode: 0o600, flag: 'wx' });
    let sequence = 0;
    if (run.legacyByteLength && !run.outputHighWater) {
      await writeLegacy(temporary, run, repository);
      sequence = 1;
    } else {
      sequence = await copyChunkWindows(temporary, run.id, repository);
    }
    await rename(temporary, paths.output);
    const info = await outputStat(paths.output);
    await writeState(paths.state, { sequence, size: info.size, legacy: Boolean(run.legacyByteLength && !run.outputHighWater) });
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
  const sequence = await copyChunkWindows(paths.output, run.id, repository, state.sequence);
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
      let currentRun = run;
      if (repository.getOutputResourceMetadata) {
        const current = repository.getOutputResourceMetadata(run.id);
        if (!current || current.sessionId !== run.sessionId) {
          await rm(paths.runDirectory, { recursive: true, force: true });
          const error = new CommandOutputResourceError();
          error.notFound = true;
          throw error;
        }
        currentRun = current;
      }
      const info = await outputStat(paths.output);
      const key = artifactKey(paths.root, run.id);
      if (currentRun.status === 'running') materializedArtifacts.set(key, paths);
      else materializedArtifacts.delete(key);
      return {
        runId: run.id,
        status: currentRun.status,
        contentType: 'text/plain; charset=utf-8',
        byteLength: info.size,
        complete: currentRun.status !== 'running',
        updatedAt: Math.floor(info.mtimeMs),
        path: `.circus/runs/${run.id}/output.log`,
      };
    } catch (error) {
      materializedArtifacts.delete(artifactKey(paths.root, run.id));
      if (error instanceof CommandOutputResourceError) throw error;
      throw new CommandOutputResourceError();
    }
  });
}

/**
 * Append newly persisted command output to an already-materialized resource.
 * Database persistence is authoritative: failures leave the resource marked
 * stale so a later descriptor request rebuilds it from the repository.
 */
export async function appendCommandRunOutputResource({ workingDirectory, runId, chunks }) {
  if (!RUN_ID.test(runId)) throw new CommandOutputResourceError();
  let root;
  try {
    root = await realpath(workingDirectory);
  } catch {
    throw new CommandOutputResourceError();
  }
  const paths = materializedArtifacts.get(artifactKey(root, runId));
  if (!paths || !chunks?.length) return false;

  return synchronized(paths.output, async () => {
    try {
      const state = await readState(paths.state);
      const output = await outputStat(paths.output);
      const expectedSequence = (state?.sequence || 0) + 1;
      if (!state || !output || state.legacy || chunks[0].sequence !== expectedSequence) {
        throw new CommandOutputResourceError('Command output resource is stale');
      }
      await appendChunks(paths.output, chunks);
      const info = await outputStat(paths.output);
      await writeState(paths.state, { sequence: chunks.at(-1).sequence, size: info.size, legacy: false });
      return true;
    } catch (error) {
      materializedArtifacts.delete(artifactKey(root, runId));
      if (error instanceof CommandOutputResourceError) throw error;
      throw new CommandOutputResourceError('Command output resource append failed');
    }
  });
}

/** Release the live registration after every command terminal path. */
export async function closeCommandRunOutputResource({ workingDirectory, runId }) {
  if (!RUN_ID.test(runId)) return;
  let root;
  try {
    root = await realpath(workingDirectory);
  } catch {
    return;
  }
  const key = artifactKey(root, runId);
  const paths = materializedArtifacts.get(key);
  if (!paths) return;
  await synchronized(paths.output, async () => { materializedArtifacts.delete(key); });
}

export const commandRunOutputResourceService = {
  append: appendCommandRunOutputResource,
  close: closeCommandRunOutputResource,
};

export async function removeCommandRunOutputResource({ workingDirectory, runId }) {
  if (!RUN_ID.test(runId)) throw new CommandOutputResourceError();
  const root = await realpath(workingDirectory);
  materializedArtifacts.delete(artifactKey(root, runId));
  const runDirectory = resolve(root, '.circus', 'runs', runId);
  if (!within(root, runDirectory)) throw new CommandOutputResourceError();
  // Validate every existing component without creating anything during cleanup.
  for (const path of [resolve(root, '.circus'), resolve(root, '.circus', 'runs'), runDirectory]) {
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new CommandOutputResourceError();
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
  await rm(runDirectory, { recursive: true, force: true });
}
