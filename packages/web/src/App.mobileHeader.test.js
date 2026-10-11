/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readAppVue() {
  return readFileSync(resolve(__dirname, 'App.vue'), 'utf8');
}

/**
 * Regression guard: on narrow phone viewports the header row contains the
 * logo plus CPU / memory / disk indicators, the connection-status dot, the
 * provider battery trigger, and the settings link. With no slack left, the
 * appearance of the connection dot (only rendered when disconnected)
 * overflows the row and `.system-indicators` (flex-shrink + overflow hidden)
 * clips the last indicator — the disk indicator ends up squished.
 *
 * Hiding the `.logo-text` wordmark on small screens (the logo image remains)
 * frees ~130px so every indicator fits with room to spare.
 */
describe('App mobile header regression guard', () => {
  it('hides .logo-text inside a small-screen media query', () => {
    const source = readAppVue();

    // The small-screen media block must contain a rule hiding the wordmark.
    // Scoped to the media query so the desktop header keeps its branding.
    expect(source).toMatch(
      /@media\s*\(\s*max-width:\s*480px\s*\)[\s\S]*?\.logo-text\s*\{[\s\S]*?display:\s*none/,
    );
  });
});
