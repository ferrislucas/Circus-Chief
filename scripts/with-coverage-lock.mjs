#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

const [, , ...command] = process.argv;

if (command.length === 0) {
  console.error('Usage: node scripts/with-coverage-lock.mjs <command> [args...]');
  process.exit(2);
}

async function findRepoRoot(start) {
  let current = start;
  while (true) {
    const packagePath = join(current, 'package.json');
    if (existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
        if (pkg.name === 'circuschief-monorepo') {
          return current;
        }
      } catch {
        // Keep walking upward.
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error('Unable to locate circuschief-monorepo root');
    }
    current = parent;
  }
}

async function getPackageName(cwd) {
  const packagePath = join(cwd, 'package.json');
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  return pkg.name || cwd.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readLock(lockDir) {
  try {
    return JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock(lockDir) {
  await mkdir(dirname(lockDir), { recursive: true });

  while (true) {
    try {
      await mkdir(lockDir, { recursive: false });
      await writeFile(join(lockDir, 'owner.json'), JSON.stringify({
        pid: process.pid,
        command,
        startedAt: new Date().toISOString(),
      }, null, 2));
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;

      const owner = await readLock(lockDir);
      if (!owner || !isProcessAlive(owner.pid)) {
        await rm(lockDir, { recursive: true, force: true });
        continue;
      }

      console.error(`[coverage-lock] Waiting for coverage run owned by pid ${owner.pid}`);
      await sleep(5000);
    }
  }
}

const repoRoot = await findRepoRoot(process.cwd());
const packageName = await getPackageName(process.cwd());
const lockName = packageName.replace(/[^a-zA-Z0-9_.-]/g, '_');
const lockDir = join(repoRoot, '.coverage-locks', lockName);
let released = false;

async function releaseLock() {
  if (released) return;
  released = true;
  await rm(lockDir, { recursive: true, force: true });
}

await acquireLock(lockDir);

const child = spawn(command[0], command.slice(1), {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on('exit', async (code, signal) => {
  await releaseLock();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
