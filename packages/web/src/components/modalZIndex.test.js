/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readComponent(name) {
  return readFileSync(resolve(__dirname, name), 'utf8');
}

function getRuleZIndex(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\s*\\{[\\s\\S]*?z-index:\\s*(\\d+)`));
  expect(match, `${selector} should define a z-index`).toBeTruthy();
  return Number(match[1]);
}

describe('Overlay modal z-index regression guard', () => {
  it('modals opened from the session overlay render above the overlay backdrop', () => {
    const overlayZ = getRuleZIndex(readComponent('SessionChatOverlay.vue'), '.overlay-backdrop');
    const modalLayers = [
      ['AutoRescheduleModal.vue', '.modal-backdrop'],
      ['SchedulingEditModal.vue', '.modal-backdrop'],
      ['ScheduleSessionModal.vue', '.modal-backdrop'],
      ['SlashCommandWizard.vue', '.wizard-overlay'],
      ['QuickResponseSettings.vue', '.settings-overlay'],
    ];

    for (const [fileName, selector] of modalLayers) {
      const modalZ = getRuleZIndex(readComponent(fileName), selector);
      expect(modalZ, `${fileName} ${selector}`).toBeGreaterThan(overlayZ);
    }
  });

  it('quick response dialog renders above quick response settings', () => {
    const settingsZ = getRuleZIndex(readComponent('QuickResponseSettings.vue'), '.settings-overlay');
    const dialogZ = getRuleZIndex(readComponent('QuickResponseDialog.vue'), '.dialog-overlay');
    const confirmZ = getRuleZIndex(readComponent('QuickResponseSettings.vue'), '.confirm-overlay');

    expect(dialogZ).toBeGreaterThan(settingsZ);
    expect(confirmZ).toBeGreaterThan(settingsZ);
  });
});
