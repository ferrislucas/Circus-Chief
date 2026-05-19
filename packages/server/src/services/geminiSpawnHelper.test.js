import { describe, it, expect } from 'vitest';
import { createGeminiSpawner } from './geminiSpawnHelper.js';

describe('geminiSpawnHelper', () => {
  describe('createGeminiSpawner', () => {
    it('returns a function', () => {
      const spawner = createGeminiSpawner();
      expect(typeof spawner).toBe('function');
    });

    it('sets Gemini workspace trust and preserves caller environment variables', async () => {
      const spawner = createGeminiSpawner();
      const child = spawner({
        command: 'node',
        args: ['-e', 'process.stdout.write(JSON.stringify({ trust: process.env.GEMINI_CLI_TRUST_WORKSPACE, custom: process.env.CUSTOM_VAR }))'],
        cwd: process.cwd(),
        env: { CUSTOM_VAR: 'custom-value' },
        signal: new AbortController().signal,
      });

      const chunks = [];
      child.stdout.on('data', (chunk) => chunks.push(chunk));

      const exitCode = await new Promise((resolve, reject) => {
        child.on('exit', resolve);
        child.on('error', reject);
      });

      expect(exitCode).toBe(0);
      expect(JSON.parse(Buffer.concat(chunks).toString('utf-8'))).toEqual({
        trust: 'true',
        custom: 'custom-value',
      });
    });
  });
});
