/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Regression guard: verifies that .toast-container has a higher z-index
 * than .overlay-backdrop so toasts always render above the session chat overlay.
 *
 * Uses the node environment to read source files directly since ?raw imports
 * on .css files are not supported in the jsdom test environment.
 */
describe('Toast z-index regression guard', () => {
  it('.toast-container z-index is greater than .overlay-backdrop z-index', () => {
    const mainCssSource = readFileSync(
      resolve(__dirname, '..', 'assets', 'main.css'),
      'utf8',
    );
    const sessionChatOverlaySource = readFileSync(
      resolve(__dirname, 'SessionChatOverlay.vue'),
      'utf8',
    );

    // Extract the z-index from the .toast-container rule in main.css
    const toastMatch = mainCssSource.match(
      /\.toast-container\s*\{[\s\S]*?z-index:\s*(\d+)/,
    );
    expect(toastMatch).toBeTruthy();
    const toastZ = Number(toastMatch[1]);

    // Extract the z-index from the .overlay-backdrop rule in SessionChatOverlay.vue
    const overlayMatch = sessionChatOverlaySource.match(
      /\.overlay-backdrop\s*\{[\s\S]*?z-index:\s*(\d+)/,
    );
    expect(overlayMatch).toBeTruthy();
    const overlayZ = Number(overlayMatch[1]);

    // Toast layer must be strictly above the overlay backdrop
    expect(toastZ).toBeGreaterThan(overlayZ);
  });
});
