import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandButtons, commandRuns, projects, sessions } from '../database.js';
import { getCommandRunOutputResource } from './commandRunOutputResource.js';
import {
  MAX_COMMAND_RUN_OUTPUT_CLEANUP_ATTEMPTS,
  processCommandRunOutputCleanup,
} from './commandRunOutputCleanup.js';

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('command run output cleanup', () => {
  it('durably enqueues deletion and removes a materialized artifact', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'circus-cleanup-'));
    roots.push(workingDirectory);
    const project = projects.create('Cleanup', workingDirectory);
    const session = sessions.create(project.id, 'Cleanup', 'test');
    const button = commandButtons.create({ projectId: project.id, label: 'test', command: 'true' });
    commandRuns.create({ id: 'cleanup-run', sessionId: session.id, buttonId: button.id });
    commandRuns.appendOutput('cleanup-run', 'retained output');
    commandRuns.complete('cleanup-run', 0);
    const run = commandRuns.getOutputResourceMetadata('cleanup-run');
    const descriptor = await getCommandRunOutputResource({ workingDirectory, run, repository: commandRuns });
    expect(await readFile(join(workingDirectory, descriptor.path), 'utf8')).toBe('retained output');

    commandRuns.deleteById('cleanup-run');
    expect(commandRuns.getById('cleanup-run')).toBeNull();
    expect(commandRuns.db.prepare('SELECT run_id FROM command_run_output_cleanup WHERE run_id = ?').get('cleanup-run')).toBeTruthy();
    await processCommandRunOutputCleanup();
    expect(commandRuns.db.prepare('SELECT run_id FROM command_run_output_cleanup WHERE run_id = ?').get('cleanup-run')).toBeUndefined();
  });

  it('keeps failed cleanup durable for retry while the run remains unauthorized', async () => {
    const missing = join(tmpdir(), `missing-circus-${Date.now()}`);
    commandRuns.db.prepare(`INSERT INTO command_run_output_cleanup
      (run_id, working_directory) VALUES (?, ?)`).run('retry-run', missing);
    await processCommandRunOutputCleanup();
    const task = commandRuns.db.prepare('SELECT attempts, last_error FROM command_run_output_cleanup WHERE run_id = ?').get('retry-run');
    expect(task.attempts).toBe(1);
    expect(task.last_error).toBeTruthy();
    expect(commandRuns.getById('retry-run')).toBeNull();
  });

  it('exhausts permanently failing cleanup once and never claims it again', async () => {
    const missing = join(tmpdir(), `missing-circus-exhausted-${Date.now()}`);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    commandRuns.db.prepare(`INSERT INTO command_run_output_cleanup
      (run_id, working_directory) VALUES (?, ?)`).run('exhausted-run', missing);

    try {
      for (let attempt = 1; attempt <= MAX_COMMAND_RUN_OUTPUT_CLEANUP_ATTEMPTS; attempt += 1) {
        expect(await processCommandRunOutputCleanup()).toBe(1);
        const task = commandRuns.db.prepare(`SELECT attempts, exhausted_at, last_error
          FROM command_run_output_cleanup WHERE run_id = ?`).get('exhausted-run');
        expect(task.attempts).toBe(attempt);
        expect(task.last_error).toBeTruthy();
        if (attempt < MAX_COMMAND_RUN_OUTPUT_CLEANUP_ATTEMPTS) {
          expect(task.exhausted_at).toBeNull();
          commandRuns.db.prepare('UPDATE command_run_output_cleanup SET next_attempt_at = 0 WHERE run_id = ?')
            .run('exhausted-run');
        } else {
          expect(task.exhausted_at).toEqual(expect.any(Number));
        }
      }

      commandRuns.db.prepare('UPDATE command_run_output_cleanup SET next_attempt_at = 0 WHERE run_id = ?')
        .run('exhausted-run');
      expect(await processCommandRunOutputCleanup()).toBe(0);
      expect(commandRuns.db.prepare('SELECT attempts FROM command_run_output_cleanup WHERE run_id = ?')
        .get('exhausted-run').attempts).toBe(MAX_COMMAND_RUN_OUTPUT_CLEANUP_ATTEMPTS);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith('[Command output cleanup] exhausted', expect.objectContaining({
        runId: 'exhausted-run', attempts: MAX_COMMAND_RUN_OUTPUT_CLEANUP_ATTEMPTS, lastError: expect.any(String),
      }));
    } finally {
      log.mockRestore();
    }
  });

  it('retries a recoverable cleanup failure and completes when deletion becomes possible', async () => {
    const workingDirectory = join(tmpdir(), `circus-cleanup-recovery-${Date.now()}`);
    roots.push(workingDirectory);
    commandRuns.db.prepare(`INSERT INTO command_run_output_cleanup
      (run_id, working_directory) VALUES (?, ?)`).run('recovered-run', workingDirectory);

    await processCommandRunOutputCleanup();
    expect(commandRuns.db.prepare('SELECT attempts FROM command_run_output_cleanup WHERE run_id = ?')
      .get('recovered-run').attempts).toBe(1);

    await mkdir(workingDirectory);
    commandRuns.db.prepare('UPDATE command_run_output_cleanup SET next_attempt_at = 0 WHERE run_id = ?')
      .run('recovered-run');
    await processCommandRunOutputCleanup();

    expect(commandRuns.db.prepare('SELECT run_id FROM command_run_output_cleanup WHERE run_id = ?')
      .get('recovered-run')).toBeUndefined();
  });

  it('captures artifact identity before session cascade deletion', () => {
    const project = projects.create('Cascade cleanup', '/tmp/cascade-cleanup');
    const session = sessions.create(project.id, 'Cascade cleanup', 'test');
    const button = commandButtons.create({ projectId: project.id, label: 'test', command: 'true' });
    commandRuns.create({ id: 'cascade-run', sessionId: session.id, buttonId: button.id });

    sessions.delete(session.id);

    expect(commandRuns.getById('cascade-run')).toBeNull();
    expect(commandRuns.db.prepare(`SELECT working_directory FROM command_run_output_cleanup
      WHERE run_id = ?`).get('cascade-run')).toEqual({ working_directory: '/tmp/cascade-cleanup' });
  });
});
