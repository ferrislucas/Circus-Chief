/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readMainCss() {
  return readFileSync(resolve(__dirname, '..', 'assets', 'main.css'), 'utf8');
}

function getRule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\s*\\{[\\s\\S]*?\\}`));
  expect(match, `${selector} should exist`).toBeTruthy();
  return match[0];
}

describe('Touch action CSS regression guard', () => {
  it('does not force touch-action manipulation on the root document', () => {
    const htmlRule = getRule(readMainCss(), 'html');

    expect(htmlRule).not.toMatch(/touch-action:\s*manipulation/);
  });

  it('keeps textarea out of touch-action manipulation selectors', () => {
    const source = readMainCss();
    const manipulationRules = source.match(/[^{}]+\{[^{}]*touch-action:\s*manipulation[^{}]*\}/g) || [];

    expect(manipulationRules.length).toBeGreaterThan(0);
    for (const rule of manipulationRules) {
      const selector = rule.slice(0, rule.indexOf('{'));
      expect(selector).not.toMatch(/\btextarea\b/);
    }
  });

  it('explicitly restores native touch behavior for editable controls', () => {
    const source = readMainCss();
    const autoRules = source.match(/[^{}]+\{[^{}]*touch-action:\s*auto[^{}]*\}/g) || [];
    const editableRule = autoRules.join('\n');

    expect(editableRule).toMatch(/\btextarea\b/);
    expect(editableRule).toMatch(/input:not\(\[type\]\)/);
    expect(editableRule).toMatch(/input\[type="text"\]/);
    expect(editableRule).toMatch(/\[contenteditable\]/);
  });
});
