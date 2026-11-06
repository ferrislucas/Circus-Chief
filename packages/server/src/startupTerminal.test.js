import { execFile } from 'child_process';
import { promisify } from 'util';
import { describe, it, expect } from 'vitest';

const run = promisify(execFile);

describe.skipIf(process.platform === 'win32')('startup interruption in a terminal', () => {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    it(`cleans up a stalled login shell after ${signal}`, async () => {
      const { stdout } = await run('python3', ['test/login-shell-terminal.py', signal], { timeout: 40000 });
      expect(stdout).toContain(`${signal}: exit 0`);
    }, 45000);
  }
});
