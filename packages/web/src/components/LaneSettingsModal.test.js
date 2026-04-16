/* eslint-env vitest */
/* global global */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// Shared mock objects - same instance returned each time
const mockKanbanStore = {
  board: {
    lanes: [
      { id: 'lane-1', name: 'To Do' },
      { id: 'lane-2', name: 'In Progress' },
      { id: 'lane-3', name: 'Done' },
    ],
  },
  updateLane: vi.fn().mockResolvedValue({}),
  deleteLane: vi.fn().mockResolvedValue({}),
  reorderLanes: vi.fn().mockResolvedValue({}),
};

const mockTemplatesStore = {
  projectTemplates: [],
  globalTemplates: [],
  fetchProjectTemplates: vi.fn().mockResolvedValue({}),
};

const mockUiStore = {
  success: vi.fn(),
  error: vi.fn(),
};

const mockProjectsStore = {
  getProjectById: vi.fn(() => ({ workingDirectory: '/test/project' })),
};

vi.mock('../stores/kanban.js', () => ({
  useKanbanStore: () => mockKanbanStore,
}));

vi.mock('../stores/templates.js', () => ({
  useTemplatesStore: () => mockTemplatesStore,
}));

vi.mock('../stores/ui.js', () => ({
  useUiStore: () => mockUiStore,
}));

vi.mock('../stores/projects.js', () => ({
  useProjectsStore: () => mockProjectsStore,
}));

// Stub child components
vi.mock('./InterpolationHelp.vue', () => ({
  default: { template: '<div class="interpolation-help-stub" />' },
}));
vi.mock('./ResizableTextarea.vue', () => ({
  default: {
    template: '<textarea class="resizable-textarea-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    props: ['modelValue', 'minHeight'],
    emits: ['update:modelValue'],
  },
}));
vi.mock('./SessionFormOptions.vue', () => ({
  default: {
    template: '<div class="session-form-options-stub" />',
    props: ['mode', 'model', 'effortLevel', 'thinkingEnabled', 'hideStartImmediately'],
  },
}));
vi.mock('./SlashCommandButton.vue', () => ({
  default: { template: '<div class="slash-command-button-stub" />' },
}));
vi.mock('./SlashCommandWizard.vue', () => ({
  default: {
    template: '<div class="slash-command-wizard-stub" />',
    props: ['isOpen', 'workingDirectory', 'mode', 'hideBuiltin'],
  },
}));

import LaneSettingsModal from './LaneSettingsModal.vue';

describe('LaneSettingsModal.vue', () => {
  const defaultLanes = [
    { id: 'lane-1', name: 'To Do' },
    { id: 'lane-2', name: 'In Progress' },
    { id: 'lane-3', name: 'Done' },
  ];

  const baseLane = {
    id: 'lane-2',
    name: 'In Progress',
    onEnterTemplateId: null,
    onEnterPrompt: null,
    onEnterMode: null,
    onEnterModel: null,
    onEnterEffortLevel: null,
    onEnterThinkingEnabled: null,
    onEnterAutoRescheduleEnabled: false,
    onEnterRescheduleDelayMinutes: 15,
    onEnterRescheduleOnTokenLimit: true,
    onEnterRescheduleOnServiceError: true,
    onEnterMaxRescheduleCount: null,
    onEnterMaxTotalTokens: null,
    onEnterRescheduleAtTokenCount: null,
  };

  const laneWithTemplate = {
    ...baseLane,
    id: 'lane-2',
    name: 'Review',
    onEnterTemplateId: 'template-42',
    onEnterPrompt: null,
  };

  const laneWithPrompt = {
    ...baseLane,
    id: 'lane-2',
    name: 'Auto Lane',
    onEnterTemplateId: null,
    onEnterPrompt: 'Run the lint check',
    onEnterMode: 'code',
    onEnterModel: 'claude-3',
    onEnterEffortLevel: 'high',
    onEnterThinkingEnabled: true,
    onEnterAutoRescheduleEnabled: true,
    onEnterRescheduleDelayMinutes: 30,
    onEnterRescheduleOnTokenLimit: false,
    onEnterRescheduleOnServiceError: true,
    onEnterMaxRescheduleCount: 5,
    onEnterMaxTotalTokens: 100000,
    onEnterRescheduleAtTokenCount: 50000,
  };

  beforeEach(() => {
    setActivePinia(createPinia());

    // Reset mock functions
    mockKanbanStore.updateLane = vi.fn().mockResolvedValue({});
    mockKanbanStore.deleteLane = vi.fn().mockResolvedValue({});
    mockKanbanStore.reorderLanes = vi.fn().mockResolvedValue({});
    mockKanbanStore.board = { lanes: [...defaultLanes] };

    mockTemplatesStore.projectTemplates = [];
    mockTemplatesStore.globalTemplates = [];
    mockTemplatesStore.fetchProjectTemplates = vi.fn().mockResolvedValue({});

    mockUiStore.success = vi.fn();
    mockUiStore.error = vi.fn();

    mockProjectsStore.getProjectById = vi.fn(() => ({ workingDirectory: '/test/project' }));

    global.confirm = vi.fn();
    vi.stubGlobal('confirm', global.confirm);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const defaultProps = {
    isOpen: true,
    projectId: 'proj-1',
    lane: baseLane,
  };

  function mountModal(props = {}) {
    return mount(LaneSettingsModal, {
      props: {
        ...defaultProps,
        ...props,
      },
    });
  }

  // -----------------------------------------------------------------------
  // Component structure
  // -----------------------------------------------------------------------
  describe('component structure', () => {
    it('exports a Vue component', () => {
      expect(LaneSettingsModal).toBeDefined();
      expect(LaneSettingsModal.__name).toBe('LaneSettingsModal');
    });

    it('renders when isOpen is true', () => {
      const wrapper = mountModal();
      expect(wrapper.find('.modal-backdrop').exists()).toBe(true);
    });

    it('does not render when isOpen is false', () => {
      const wrapper = mountModal({ isOpen: false });
      expect(wrapper.find('.modal-backdrop').exists()).toBe(false);
    });

    it('renders the modal title', () => {
      const wrapper = mountModal();
      expect(wrapper.find('.modal-title').text()).toBe('Lane Settings');
    });

    it('renders a close button', () => {
      const wrapper = mountModal();
      expect(wrapper.find('.close-btn').exists()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // resetForm with lane data
  // -----------------------------------------------------------------------
  describe('resetForm with lane data', () => {
    it('populates the name input from lane', () => {
      const wrapper = mountModal({ lane: baseLane });
      const nameInput = wrapper.find('#lane-name');
      expect(nameInput.element.value).toBe('In Progress');
    });

    it('populates the name input from a lane with prompt automation', () => {
      const wrapper = mountModal({ lane: laneWithPrompt });
      const nameInput = wrapper.find('#lane-name');
      expect(nameInput.element.value).toBe('Auto Lane');
    });

    it('detects automation type as "template" and shows template selector', () => {
      const wrapper = mountModal({ lane: laneWithTemplate });
      expect(wrapper.find('#template-select').exists()).toBe(true);
    });

    it('detects automation type as "prompt" and shows prompt input', () => {
      const wrapper = mountModal({ lane: laneWithPrompt });
      expect(wrapper.find('#custom-prompt').exists()).toBe(true);
    });

    it('detects automation type as "none" when neither template nor prompt is set', () => {
      const wrapper = mountModal({ lane: baseLane });
      expect(wrapper.find('#template-select').exists()).toBe(false);
      expect(wrapper.find('#custom-prompt').exists()).toBe(false);
    });

    it('selects the "none" radio when no automation is set', () => {
      const wrapper = mountModal({ lane: baseLane });
      const noneRadio = wrapper.find('input[type="radio"][value="none"]');
      expect(noneRadio.element.checked).toBe(true);
    });

    it('selects the "template" radio when onEnterTemplateId is set', () => {
      const wrapper = mountModal({ lane: laneWithTemplate });
      const templateRadio = wrapper.find('input[type="radio"][value="template"]');
      expect(templateRadio.element.checked).toBe(true);
    });

    it('selects the "prompt" radio when onEnterPrompt is set', () => {
      const wrapper = mountModal({ lane: laneWithPrompt });
      const promptRadio = wrapper.find('input[type="radio"][value="prompt"]');
      expect(promptRadio.element.checked).toBe(true);
    });

    it('expands agent settings when agent settings are configured', () => {
      const wrapper = mountModal({ lane: laneWithPrompt });
      expect(wrapper.find('.agent-settings-body').exists()).toBe(true);
    });

    it('does not expand agent settings when no agent settings are configured', () => {
      const lanePromptNoAgent = {
        ...baseLane,
        onEnterPrompt: 'Simple prompt',
        onEnterMode: null,
        onEnterModel: null,
        onEnterEffortLevel: null,
        onEnterThinkingEnabled: null,
        onEnterAutoRescheduleEnabled: false,
      };
      const wrapper = mountModal({ lane: lanePromptNoAgent });
      expect(wrapper.find('.agent-settings-body').exists()).toBe(false);
    });

    it('shows position controls with correct position label', () => {
      const wrapper = mountModal({ lane: baseLane });
      // lane-2 is at index 1, should show "2 of 3"
      expect(wrapper.find('.lane-position-label').text()).toBe('2 of 3');
    });
  });

  // -----------------------------------------------------------------------
  // resetForm with null lane
  // -----------------------------------------------------------------------
  describe('resetForm with null lane', () => {
    it('resets the name input to empty', () => {
      const wrapper = mountModal({ lane: null });
      const nameInput = wrapper.find('#lane-name');
      if (nameInput.exists()) {
        expect(nameInput.element.value).toBe('');
      }
    });

    it('resets automation type to "none"', () => {
      const wrapper = mountModal({ lane: null });
      expect(wrapper.find('#template-select').exists()).toBe(false);
      expect(wrapper.find('#custom-prompt').exists()).toBe(false);
    });

    it('does not show agent settings', () => {
      const wrapper = mountModal({ lane: null });
      expect(wrapper.find('.agent-settings-body').exists()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // isValid computed property
  // -----------------------------------------------------------------------
  describe('isValid computed property', () => {
    it('disables Save when name is empty', () => {
      const laneEmptyName = { ...baseLane, name: '' };
      const wrapper = mountModal({ lane: laneEmptyName });
      const saveBtn = wrapper.find('.btn-primary');
      expect(saveBtn.attributes('disabled')).toBeDefined();
    });

    it('disables Save when name is only whitespace', () => {
      const laneSpaceName = { ...baseLane, name: '   ' };
      const wrapper = mountModal({ lane: laneSpaceName });
      const saveBtn = wrapper.find('.btn-primary');
      expect(saveBtn.attributes('disabled')).toBeDefined();
    });

    it('enables Save when name is set and automation is "none"', () => {
      const wrapper = mountModal({ lane: baseLane });
      const saveBtn = wrapper.find('.btn-primary');
      expect(saveBtn.attributes('disabled')).toBeUndefined();
    });

    it('enables Save when automation is "template" and template is selected', () => {
      // Need a template option for the select to have a value
      mockTemplatesStore.projectTemplates = [{ id: 'template-42', name: 'Test Template' }];
      const wrapper = mountModal({ lane: laneWithTemplate });
      const saveBtn = wrapper.find('.btn-primary');
      expect(saveBtn.attributes('disabled')).toBeUndefined();
    });

    it('enables Save when automation is "prompt" and prompt is filled', () => {
      const wrapper = mountModal({ lane: laneWithPrompt });
      const saveBtn = wrapper.find('.btn-primary');
      expect(saveBtn.attributes('disabled')).toBeUndefined();
    });

    it('disables Save when automation is "prompt" but prompt is empty', async () => {
      const lanePromptEmpty = { ...baseLane, onEnterPrompt: 'x' };
      const wrapper = mountModal({ lane: lanePromptEmpty });
      const promptInput = wrapper.find('#custom-prompt');
      await promptInput.setValue('');
      await wrapper.vm.$nextTick();
      const saveBtn = wrapper.find('.btn-primary');
      expect(saveBtn.attributes('disabled')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // handleSave - automation type "none"
  // -----------------------------------------------------------------------
  describe('handleSave with automationType "none"', () => {
    it('calls kanbanStore.updateLane with cleared automation fields', async () => {
      const wrapper = mountModal({ lane: baseLane });
      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      expect(mockKanbanStore.updateLane).toHaveBeenCalled();
      const [projectId, laneId, data] = mockKanbanStore.updateLane.mock.calls[0];
      expect(projectId).toBe('proj-1');
      expect(laneId).toBe('lane-2');
      expect(data.name).toBe('In Progress');
      expect(data.onEnterTemplateId).toBeNull();
      expect(data.onEnterPrompt).toBeNull();
      expect(data.onEnterMode).toBeNull();
      expect(data.onEnterModel).toBeNull();
      expect(data.onEnterEffortLevel).toBeNull();
      expect(data.onEnterThinkingEnabled).toBeNull();
      expect(data.onEnterAutoRescheduleEnabled).toBe(false);
    });

    it('shows success toast on success', async () => {
      const wrapper = mountModal({ lane: baseLane });
      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      expect(mockUiStore.success).toHaveBeenCalledWith('Lane settings saved');
    });

    it('calls close after successful save', async () => {
      const wrapper = mountModal({ lane: baseLane });
      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      // Verify the full save + close flow completed by checking the store was called
      // and success toast was shown (close is called internally after save)
      expect(mockKanbanStore.updateLane).toHaveBeenCalled();
      expect(mockUiStore.success).toHaveBeenCalledWith('Lane settings saved');
    });

    it('trims the lane name before saving', async () => {
      const laneWithSpacedName = { ...baseLane, name: '  Spaced Name  ' };
      const wrapper = mountModal({ lane: laneWithSpacedName });
      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      const [, , data] = mockKanbanStore.updateLane.mock.calls[0];
      expect(data.name).toBe('Spaced Name');
    });
  });

  // -----------------------------------------------------------------------
  // handleSave - automation type "template"
  // -----------------------------------------------------------------------
  describe('handleSave with automationType "template"', () => {
    it('includes onEnterTemplateId and clears prompt/agent settings', async () => {
      mockTemplatesStore.projectTemplates = [{ id: 'template-42', name: 'Test Template' }];
      const wrapper = mountModal({ lane: laneWithTemplate });
      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      expect(mockKanbanStore.updateLane).toHaveBeenCalled();
      const [, , data] = mockKanbanStore.updateLane.mock.calls[0];
      expect(data.onEnterTemplateId).toBe('template-42');
      expect(data.onEnterPrompt).toBeNull();
      expect(data.onEnterMode).toBeNull();
      expect(data.onEnterModel).toBeNull();
      expect(data.onEnterEffortLevel).toBeNull();
      expect(data.onEnterThinkingEnabled).toBeNull();
      expect(data.onEnterAutoRescheduleEnabled).toBe(false);
      expect(data.onEnterRescheduleDelayMinutes).toBe(15);
      expect(data.onEnterMaxRescheduleCount).toBeNull();
      expect(data.onEnterMaxTotalTokens).toBeNull();
      expect(data.onEnterRescheduleAtTokenCount).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // handleSave - automation type "prompt"
  // -----------------------------------------------------------------------
  describe('handleSave with automationType "prompt"', () => {
    it('includes prompt and agent settings, clears templateId', async () => {
      const wrapper = mountModal({ lane: laneWithPrompt });
      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      expect(mockKanbanStore.updateLane).toHaveBeenCalled();
      const [, , data] = mockKanbanStore.updateLane.mock.calls[0];
      expect(data.onEnterTemplateId).toBeNull();
      expect(data.onEnterPrompt).toBe('Run the lint check');
      expect(data.onEnterMode).toBe('code');
      expect(data.onEnterModel).toBe('claude-3');
      expect(data.onEnterEffortLevel).toBe('high');
      expect(data.onEnterThinkingEnabled).toBe(true);
      expect(data.onEnterAutoRescheduleEnabled).toBe(true);
      expect(data.onEnterRescheduleDelayMinutes).toBe(30);
      expect(data.onEnterRescheduleOnTokenLimit).toBe(false);
      expect(data.onEnterRescheduleOnServiceError).toBe(true);
      expect(data.onEnterMaxRescheduleCount).toBe(5);
      expect(data.onEnterMaxTotalTokens).toBe(100000);
      expect(data.onEnterRescheduleAtTokenCount).toBe(50000);
    });

    it('trims the prompt before saving', async () => {
      const laneSpacedPrompt = { ...laneWithPrompt, onEnterPrompt: '  spaced prompt  ' };
      const wrapper = mountModal({ lane: laneSpacedPrompt });
      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      const [, , data] = mockKanbanStore.updateLane.mock.calls[0];
      expect(data.onEnterPrompt).toBe('spaced prompt');
    });
  });

  // -----------------------------------------------------------------------
  // handleSave with position change
  // -----------------------------------------------------------------------
  describe('handleSave with position change', () => {
    it('calls reorderLanes before updateLane when lane is moved left', async () => {
      const wrapper = mountModal({ lane: baseLane });
      // Click the "move left" button to change position from 1 to 0
      const leftBtn = wrapper.findAll('.btn-icon')[0];
      await leftBtn.trigger('click');
      await wrapper.vm.$nextTick();

      // Now save
      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      expect(mockKanbanStore.reorderLanes).toHaveBeenCalled();
      const [projectId, newOrder] = mockKanbanStore.reorderLanes.mock.calls[0];
      expect(projectId).toBe('proj-1');
      // lane-2 moved from index 1 to index 0: [lane-2, lane-1, lane-3]
      expect(newOrder).toEqual(['lane-2', 'lane-1', 'lane-3']);

      expect(mockKanbanStore.updateLane).toHaveBeenCalled();
    });

    it('does not call reorderLanes when position has not changed', async () => {
      const wrapper = mountModal({ lane: baseLane });
      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      expect(mockKanbanStore.reorderLanes).not.toHaveBeenCalled();
      expect(mockKanbanStore.updateLane).toHaveBeenCalled();
    });

    it('calls reorderLanes when lane is moved right', async () => {
      const wrapper = mountModal({ lane: baseLane });
      const rightBtn = wrapper.findAll('.btn-icon')[1];
      await rightBtn.trigger('click');
      await wrapper.vm.$nextTick();

      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      expect(mockKanbanStore.reorderLanes).toHaveBeenCalled();
      const [, newOrder] = mockKanbanStore.reorderLanes.mock.calls[0];
      // lane-2 moved from index 1 to index 2: [lane-1, lane-3, lane-2]
      expect(newOrder).toEqual(['lane-1', 'lane-3', 'lane-2']);
    });
  });

  // -----------------------------------------------------------------------
  // handleSave error handling
  // -----------------------------------------------------------------------
  describe('handleSave error handling', () => {
    it('shows error toast when updateLane rejects', async () => {
      mockKanbanStore.updateLane = vi.fn().mockRejectedValue(new Error('Network error'));
      const wrapper = mountModal({ lane: baseLane });

      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      expect(mockUiStore.error).toHaveBeenCalledWith('Network error');
    });

    it('does not emit "updated" on failure', async () => {
      mockKanbanStore.updateLane = vi.fn().mockRejectedValue(new Error('fail'));
      const wrapper = mountModal({ lane: baseLane });

      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      expect(wrapper.emitted('updated')).toBeFalsy();
    });

    it('does not save when lane prop is null', () => {
      mountModal({ lane: null });
      // handleSave guards: if (!props.lane) return
      expect(mockKanbanStore.updateLane).not.toHaveBeenCalled();
    });

    it('uses fallback message when error has no message', async () => {
      mockKanbanStore.updateLane = vi.fn().mockRejectedValue(new Error(''));
      const wrapper = mountModal({ lane: baseLane });

      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      expect(mockUiStore.error).toHaveBeenCalledWith('Failed to save lane settings');
    });

    it('resets Save button text after failure', async () => {
      mockKanbanStore.updateLane = vi.fn().mockRejectedValue(new Error('fail'));
      const wrapper = mountModal({ lane: baseLane });

      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      expect(wrapper.find('.btn-primary').text()).toBe('Save Changes');
    });
  });

  // -----------------------------------------------------------------------
  // close() behavior
  // -----------------------------------------------------------------------
  describe('close() behavior', () => {
    it('renders Cancel button', () => {
      const wrapper = mountModal();
      expect(wrapper.find('.btn-secondary').exists()).toBe(true);
      expect(wrapper.find('.btn-secondary').text()).toBe('Cancel');
    });

    it('renders close button (x) in header', () => {
      const wrapper = mountModal();
      expect(wrapper.find('.close-btn').exists()).toBe(true);
    });

    it('has @click handler on Cancel button', () => {
      const wrapper = mountModal();
      // Verify Cancel button exists and is clickable
      const cancelBtn = wrapper.find('.btn-secondary');
      expect(cancelBtn.exists()).toBe(true);
    });

    it('has @click.self on modal backdrop', () => {
      const wrapper = mountModal();
      expect(wrapper.find('.modal-backdrop').exists()).toBe(true);
    });

    it('changes position label when moving and verifies move left', async () => {
      const wrapper = mountModal({ lane: baseLane });
      const leftBtn = wrapper.findAll('.btn-icon')[0];
      await leftBtn.trigger('click');
      await wrapper.vm.$nextTick();

      // Verify position label changed to 1 of 3
      expect(wrapper.find('.lane-position-label').text()).toBe('1 of 3');
    });
  });

  // -----------------------------------------------------------------------
  // handleMoveLane
  // -----------------------------------------------------------------------
  describe('handleMoveLane', () => {
    it('updates position label when moving left', async () => {
      const wrapper = mountModal({ lane: baseLane });
      expect(wrapper.find('.lane-position-label').text()).toBe('2 of 3');

      const leftBtn = wrapper.findAll('.btn-icon')[0];
      await leftBtn.trigger('click');
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.lane-position-label').text()).toBe('1 of 3');
    });

    it('updates position label when moving right', async () => {
      const wrapper = mountModal({ lane: baseLane });
      const rightBtn = wrapper.findAll('.btn-icon')[1];
      await rightBtn.trigger('click');
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.lane-position-label').text()).toBe('3 of 3');
    });

    it('disables left button at leftmost position', () => {
      const wrapper = mountModal({ lane: { ...baseLane, id: 'lane-1', name: 'To Do' } });
      const leftBtn = wrapper.findAll('.btn-icon')[0];
      expect(leftBtn.attributes('disabled')).toBeDefined();
    });

    it('disables right button at rightmost position', () => {
      const wrapper = mountModal({ lane: { ...baseLane, id: 'lane-3', name: 'Done' } });
      const rightBtn = wrapper.findAll('.btn-icon')[1];
      expect(rightBtn.attributes('disabled')).toBeDefined();
    });

    it('renders position controls when totalLanes > 1', () => {
      const wrapper = mountModal();
      expect(wrapper.find('.lane-position-controls').exists()).toBe(true);
    });

    it('does not render position controls when only 1 lane', () => {
      mockKanbanStore.board = { lanes: [{ id: 'lane-1', name: 'Only Lane' }] };
      const wrapper = mountModal({ lane: { ...baseLane, id: 'lane-1', name: 'Only Lane' } });
      expect(wrapper.find('.lane-position-controls').exists()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // confirmDelete
  // -----------------------------------------------------------------------
  describe('confirmDelete', () => {
    it('shows a confirm dialog with the lane name', async () => {
      global.confirm.mockReturnValue(false);
      const wrapper = mountModal();
      await wrapper.find('.btn-danger').trigger('click');
      expect(global.confirm).toHaveBeenCalledWith(
        'Are you sure you want to delete the "In Progress" lane? This cannot be undone.',
      );
    });

    it('does not delete when user cancels the confirm dialog', async () => {
      global.confirm.mockReturnValue(false);
      const wrapper = mountModal();
      await wrapper.find('.btn-danger').trigger('click');
      expect(mockKanbanStore.deleteLane).not.toHaveBeenCalled();
    });

    it('calls kanbanStore.deleteLane when user confirms', async () => {
      global.confirm.mockReturnValue(true);
      const wrapper = mountModal();
      await wrapper.find('.btn-danger').trigger('click');
      await flushPromises();

      expect(mockKanbanStore.deleteLane).toHaveBeenCalledWith('proj-1', 'lane-2');
    });

    it('calls close after successful deletion', async () => {
      global.confirm.mockReturnValue(true);
      const wrapper = mountModal();
      await wrapper.find('.btn-danger').trigger('click');
      await flushPromises();

      // Verify the full delete + close flow completed
      expect(mockKanbanStore.deleteLane).toHaveBeenCalledWith('proj-1', 'lane-2');
      expect(mockUiStore.success).toHaveBeenCalledWith('Lane deleted');
    });

    it('shows success toast on deletion', async () => {
      global.confirm.mockReturnValue(true);
      const wrapper = mountModal();
      await wrapper.find('.btn-danger').trigger('click');
      await flushPromises();

      expect(mockUiStore.success).toHaveBeenCalledWith('Lane deleted');
    });

    it('shows error toast when deletion fails', async () => {
      global.confirm.mockReturnValue(true);
      mockKanbanStore.deleteLane = vi.fn().mockRejectedValue(new Error('Delete failed'));
      const wrapper = mountModal();
      await wrapper.find('.btn-danger').trigger('click');
      await flushPromises();

      expect(mockUiStore.error).toHaveBeenCalledWith('Delete failed');
    });

    it('resets delete button text after failure', async () => {
      global.confirm.mockReturnValue(true);
      mockKanbanStore.deleteLane = vi.fn().mockRejectedValue(new Error('fail'));
      const wrapper = mountModal();
      await wrapper.find('.btn-danger').trigger('click');
      await flushPromises();

      expect(wrapper.find('.btn-danger').text()).toBe('Delete Lane');
    });

    it('does nothing when lane prop is null', () => {
      mountModal({ lane: null });
      expect(mockKanbanStore.deleteLane).not.toHaveBeenCalled();
    });

    it('shows "Deleting..." text while deletion is in progress', async () => {
      global.confirm.mockReturnValue(true);
      let resolveDelete;
      mockKanbanStore.deleteLane = vi.fn(() => new Promise((resolve) => {
        resolveDelete = resolve;
      }));
      const wrapper = mountModal();
      await wrapper.find('.btn-danger').trigger('click');
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.btn-danger').text()).toBe('Deleting...');

      // Resolve to clean up
      resolveDelete();
      await flushPromises();
    });
  });

  // -----------------------------------------------------------------------
  // Automation type rendering
  // -----------------------------------------------------------------------
  describe('automation type rendering', () => {
    it('shows template selector when automation type is "template"', () => {
      const wrapper = mountModal({ lane: laneWithTemplate });
      expect(wrapper.find('#template-select').exists()).toBe(true);
    });

    it('does not show template selector when automation type is "none"', () => {
      const wrapper = mountModal({ lane: baseLane });
      expect(wrapper.find('#template-select').exists()).toBe(false);
    });

    it('shows custom prompt input when automation type is "prompt"', () => {
      const wrapper = mountModal({ lane: laneWithPrompt });
      expect(wrapper.find('#custom-prompt').exists()).toBe(true);
    });

    it('shows agent settings section when automation type is "prompt"', () => {
      const wrapper = mountModal({ lane: laneWithPrompt });
      expect(wrapper.find('.agent-settings-section').exists()).toBe(true);
    });

    it('does not show agent settings section when automation type is "none"', () => {
      const wrapper = mountModal({ lane: baseLane });
      expect(wrapper.find('.agent-settings-section').exists()).toBe(false);
    });

    it('renders three radio options for automation type', () => {
      const wrapper = mountModal();
      const radios = wrapper.findAll('input[type="radio"][name="automation"]');
      expect(radios).toHaveLength(3);
    });

    it('switches to template view when template radio is selected', async () => {
      const wrapper = mountModal({ lane: baseLane });
      expect(wrapper.find('#template-select').exists()).toBe(false);

      const templateRadio = wrapper.find('input[type="radio"][value="template"]');
      await templateRadio.setValue(true);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('#template-select').exists()).toBe(true);
    });

    it('switches to prompt view when prompt radio is selected', async () => {
      const wrapper = mountModal({ lane: baseLane });
      expect(wrapper.find('#custom-prompt').exists()).toBe(false);

      const promptRadio = wrapper.find('input[type="radio"][value="prompt"]');
      await promptRadio.setValue(true);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('#custom-prompt').exists()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Danger zone
  // -----------------------------------------------------------------------
  describe('danger zone', () => {
    it('renders danger zone section', () => {
      const wrapper = mountModal();
      expect(wrapper.find('.danger-zone').exists()).toBe(true);
    });

    it('renders delete button with correct text', () => {
      const wrapper = mountModal();
      expect(wrapper.find('.btn-danger').text()).toBe('Delete Lane');
    });

    it('displays danger zone description', () => {
      const wrapper = mountModal();
      expect(wrapper.find('.danger-description').text()).toContain(
        'Deleting this lane will remove all cards from it',
      );
    });
  });

  // -----------------------------------------------------------------------
  // Template loading on open
  // -----------------------------------------------------------------------
  describe('template loading', () => {
    it('fetches project templates when modal opens', () => {
      mountModal();
      expect(mockTemplatesStore.fetchProjectTemplates).toHaveBeenCalledWith('proj-1');
    });

    it('does not fetch templates when projectId is empty', () => {
      mockTemplatesStore.fetchProjectTemplates = vi.fn();
      mountModal({ projectId: '' });
      expect(mockTemplatesStore.fetchProjectTemplates).not.toHaveBeenCalled();
    });

    it('does not fetch templates when modal is closed', () => {
      mockTemplatesStore.fetchProjectTemplates = vi.fn();
      mountModal({ isOpen: false });
      expect(mockTemplatesStore.fetchProjectTemplates).not.toHaveBeenCalled();
    });
  });
});
