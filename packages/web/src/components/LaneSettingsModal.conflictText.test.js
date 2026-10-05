import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import LaneSettingsModal from './LaneSettingsModal.vue';

vi.mock('../stores/kanban.js', () => ({
  useKanbanStore: () => ({
    board: { lanes: [{ id: 'lane-1', name: 'To Do' }] },
    updateLane: vi.fn().mockResolvedValue({}),
    deleteLane: vi.fn().mockResolvedValue({}),
    reorderLanes: vi.fn().mockResolvedValue({}),
  }),
}));

vi.mock('../stores/templates.js', () => ({
  useTemplatesStore: () => ({
    projectTemplates: [],
    globalTemplates: [],
    fetchProjectTemplates: vi.fn().mockResolvedValue({}),
  }),
}));

vi.mock('../stores/ui.js', () => ({
  useUiStore: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('../stores/projects.js', () => ({
  useProjectsStore: () => ({
    getProjectById: vi.fn(() => ({ workingDirectory: '/test/project' })),
  }),
}));

// Pure conflict: banner visible, no blocking problem — the banner must still
// render a real sentence instead of an empty paragraph.
vi.mock('../composables/useSelectionGuard.js', () => ({
  useSelectionGuard: () => ({
    problem: null,
    invalid: false,
    showBanner: true,
    keepMine: vi.fn(),
  }),
}));

vi.mock('./SessionFormOptions.vue', () => ({
  default: { template: '<div class="session-form-options-stub" />' },
}));

describe('LaneSettingsModal pure-conflict banner text', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const laneWithPrompt = {
    id: 'lane-1',
    name: 'Auto Lane',
    onEnterTemplateId: null,
    onEnterPrompt: 'Run the lint check',
    onEnterMode: 'standard',
    onEnterModel: 'claude-3',
    onEnterEffortLevel: null,
    onEnterThinkingEnabled: null,
    onEnterAutoRescheduleEnabled: false,
    onEnterRescheduleDelayMinutes: 15,
    onEnterRescheduleOnTokenLimit: true,
    onEnterRescheduleOnServiceError: true,
    onEnterMaxRescheduleCount: null,
    onEnterMaxTotalTokens: null,
    onEnterRescheduleAtTokenCount: null,
    completionTargetLaneId: null,
  };

  it('renders a non-empty paragraph on a pure conflict', () => {
    const wrapper = mount(LaneSettingsModal, {
      props: { isOpen: true, projectId: 'proj-1', lane: laneWithPrompt },
    });

    const banner = wrapper.find('.conflict-banner');
    expect(banner.exists()).toBe(true);
    expect(banner.find('p').text().trim().length).toBeGreaterThan(0);
  });
});
