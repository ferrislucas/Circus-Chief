/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const currentDir = dirname(fileURLToPath(import.meta.url));

describe('session overlay CSS defaults', () => {
  it('main css defines the session overlay top chrome inset default', () => {
    const mainCssSource = readFileSync(
      resolve(currentDir, '..', 'assets', 'main.css'),
      'utf8'
    );

    expect(mainCssSource).toMatch(/--session-overlay-top-chrome-inset:\s*0px/);
  });
});
