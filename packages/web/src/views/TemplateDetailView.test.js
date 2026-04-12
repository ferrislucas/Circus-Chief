import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import TemplateDetailView from './TemplateDetailView.vue';
import { useTemplatesStore } from '../stores/templates.js';
import { useUiStore } from '../stores/ui.js';
import { useProvidersStore } from '../stores/providers.js';

// Mock the API - must match the import path in TemplateDetailView.vue
vi.mock('../api/index.js', () => ({
  api: {
    getTemplate: vi.fn(),
  },
}));

import { api } from '../api/index.js';

// Mock ModelSelector component
vi.mock('../components/ModelSelector.vue', () => ({
  default: {
    name: 'ModelSelector',
    template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option value="claude-sonnet-4-6">Sonnet</option><option value="claude-opus-4-20250529">Opus</option><option value="null">Use Default</option></select>',
    props: ['modelValue'],
    emits: ['update:modelValue'],
    setup(props, { emit }) {
      // Automatically emit the modelValue prop as the selected value on mount
      // This simulates ModelSelector's behavior of selecting a default model
      return { modelValue: props.modelValue || 'claude-opus-4-20250529' };
    },
  },
}));

// Mock EffortLevelSelector component
vi.mock('../components/EffortLevelSelector.vue', () => ({
  default: {
    name: 'EffortLevelSelector',
    template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option value="">Auto</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="max">Max</option></select>',
    props: ['modelValue'],
    emits: ['update:modelValue'],
  },
}));

// Mock ResizableTextarea component
vi.mock('../components/ResizableTextarea.vue', () => ({
  default: {
    name: 'ResizableTextarea',
    template: '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value); $emit(\'input\', $event)" />',
    props: ['modelValue', 'minHeight', 'maxHeight'],
    emits: ['update:modelValue', 'input'],
  },
}));

describe('TemplateDetailView - New Form Fields', () => {
  let pinia;
  let router;
  let templatesStore;
  let uiStore;
  let providersStore;

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/projects/:projectId/templates', component: { template: '<div></div>' } },
        { path: '/projects/:projectId/templates/:templateId', component: TemplateDetailView },
      ],
    });

    templatesStore = useTemplatesStore();
    uiStore = useUiStore();
    providersStore = useProvidersStore();

    // Mock store methods
    vi.spyOn(templatesStore, 'updateTemplate').mockResolvedValue({
      id: 'template-1',
      name: 'Updated Template',
      prompt: 'Updated prompt',
    });
    vi.spyOn(templatesStore, 'deleteTemplate').mockResolvedValue(undefined);

    vi.spyOn(uiStore, 'success').mockImplementation(() => {});
    vi.spyOn(uiStore, 'error').mockImplementation(() => {});

    // Mock providers with models
    providersStore.providers = [
      {
        id: 'anthropic',
        name: 'Anthropic',
        isBuiltIn: true,
        models: [
          { modelId: 'claude-opus-4-20250529', displayName: 'Opus 4', tier: 'opus' },
          { modelId: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', tier: 'sonnet' },
        ],
      },
    ];

    // Mock templates in store for next template dropdown
    templatesStore.projectTemplates = [
      {
        id: 'template-2',
        name: 'Other Template',
        prompt: 'Other prompt',
        projectId: 'proj-1',
      },
    ];
    templatesStore.globalTemplates = [];

    // Mock API to return a template
    api.getTemplate.mockResolvedValue({
      id: 'template-1',
      name: 'Test Template',
      prompt: 'Test prompt',
      projectId: 'proj-1',
      nextTemplateId: null,
      thinkingEnabled: false,
      model: 'claude-opus-4-20250529',
      mode: 'yolo',
    });

    await router.push({ path: '/projects/proj-1/templates/template-1' });
    await router.isReady();
  });

  describe('Form Field Rendering', () => {
    it('displays model selector', async () => {
      const wrapper = mount(TemplateDetailView, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();
      await nextTick();

      // Find ModelSelector component
      const modelSelector = wrapper.findComponent({ name: 'ModelSelector' });
      expect(modelSelector.exists()).toBe(true);
    });

    it('displays mode dropdown with all mode options', async () => {
      const wrapper = mount(TemplateDetailView, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();
      await nextTick();

      // Find mode select
      const modeSelect = wrapper.find('#mode');
      expect(modeSelect.exists()).toBe(true);

      // Check mode options
      const options = modeSelect.findAll('option');
      expect(options.length).toBe(4);
      expect(options[0].attributes('value')).toBeUndefined(); // null renders as no value attribute
      expect(options[0].text()).toBe('Inherit from root session');
      expect(options[1].attributes('value')).toBe('plan');
      expect(options[1].text()).toBe('Plan');
      expect(options[2].attributes('value')).toBe('standard');
      expect(options[2].text()).toBe('Standard');
      expect(options[3].attributes('value')).toBe('yolo');
      expect(options[3].text()).toBe('YOLO');
    });

    it('displays effort level selector', async () => {
      const wrapper = mount(TemplateDetailView, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();
      await nextTick();

      // Find EffortLevelSelector component
      const effortSelector = wrapper.findComponent({ name: 'EffortLevelSelector' });
      expect(effortSelector.exists()).toBe(true);
    });
  });

  describe('Loading Template Data', () => {
    it('uses null for model when template model is null', async () => {
      // Use a different template ID to avoid beforeEach mock conflict
      api.getTemplate.mockResolvedValueOnce({
        id: 'template-2',
        name: 'Old Template',
        prompt: 'Old prompt',
        projectId: 'proj-1',
        model: null,
        mode: null,
      });

      const wrapper = mount(TemplateDetailView, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();
      await nextTick();
      await flushPromises();
      await nextTick();

      // Check that model is null (will use default from ModelSelector)
      const modelSelector = wrapper.findComponent({ name: 'ModelSelector' });
      expect(modelSelector.props('modelValue')).toBeNull();

      const modeSelect = wrapper.find('#mode');
      // When null is selected, element.value is the text of the first option
      expect(modeSelect.element.value).toBe('Inherit from root session');
    });

    it('loads effort level from template', async () => {
      api.getTemplate.mockResolvedValueOnce({
        id: 'template-2',
        name: 'High Effort Template',
        prompt: 'Test prompt',
        projectId: 'proj-1',
        effortLevel: 'high',
      });

      const wrapper = mount(TemplateDetailView, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();
      await nextTick();
      await flushPromises();
      await nextTick();

      // Check that effortLevel is loaded
      const effortSelector = wrapper.findComponent({ name: 'EffortLevelSelector' });
      expect(effortSelector.props('modelValue')).toBe('high');
    });

    it('loads null effort level when template has null', async () => {
      api.getTemplate.mockResolvedValueOnce({
        id: 'template-2',
        name: 'Auto Effort Template',
        prompt: 'Test prompt',
        projectId: 'proj-1',
        effortLevel: null,
      });

      const wrapper = mount(TemplateDetailView, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();
      await nextTick();
      await flushPromises();
      await nextTick();

      // Check that effortLevel is null
      const effortSelector = wrapper.findComponent({ name: 'EffortLevelSelector' });
      expect(effortSelector.props('modelValue')).toBeNull();
    });
  });

  describe('Form Submission with New Fields', () => {
    it('submits form with model value', async () => {
      const wrapper = mount(TemplateDetailView, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();
      await nextTick();
      await flushPromises();
      await nextTick();

      // Change model
      const modelSelector = wrapper.findComponent({ name: 'ModelSelector' });
      await modelSelector.vm.$emit('update:modelValue', 'claude-sonnet-4-6');
      await nextTick();

      // Submit form
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      // Verify updateTemplate was called with the model value
      expect(templatesStore.updateTemplate).toHaveBeenCalled();
      const callArgs = templatesStore.updateTemplate.mock.calls[0];
      expect(callArgs[0]).toBe('template-1');
      expect(callArgs[1].model).toBe('claude-sonnet-4-6');
    });

    it('submits form with mode when different from default', async () => {
      const wrapper = mount(TemplateDetailView, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();
      await nextTick();
      await flushPromises();
      await nextTick();

      // Change mode to non-default
      const modeSelect = wrapper.find('#mode');
      await modeSelect.setValue('plan');

      // Submit form
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      // Verify updateTemplate was called
      expect(templatesStore.updateTemplate).toHaveBeenCalled();
      const callArgs = templatesStore.updateTemplate.mock.calls[0];
      expect(callArgs[1].mode).toBe('plan');
    });

    it('submits form with effort level', async () => {
      const wrapper = mount(TemplateDetailView, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();
      await nextTick();
      await flushPromises();
      await nextTick();

      // Change effort level
      const effortSelector = wrapper.findComponent({ name: 'EffortLevelSelector' });
      await effortSelector.vm.$emit('update:modelValue', 'max');
      await nextTick();

      // Submit form
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      // Verify updateTemplate was called with the effort level
      expect(templatesStore.updateTemplate).toHaveBeenCalled();
      const callArgs = templatesStore.updateTemplate.mock.calls[0];
      expect(callArgs[1].effortLevel).toBe('max');
    });

    it('submits form with all new fields', async () => {
      const wrapper = mount(TemplateDetailView, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();
      await nextTick();
      await flushPromises();
      await nextTick();

      // Set all new fields
      const modelSelector = wrapper.findComponent({ name: 'ModelSelector' });
      await modelSelector.vm.$emit('update:modelValue', 'claude-sonnet-4-6');
      await nextTick();

      const modeSelect = wrapper.find('#mode');
      await modeSelect.setValue('standard');

      const effortSelector = wrapper.findComponent({ name: 'EffortLevelSelector' });
      await effortSelector.vm.$emit('update:modelValue', 'high');
      await nextTick();

      // Submit form
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      // Verify updateTemplate was called with all new fields
      expect(templatesStore.updateTemplate).toHaveBeenCalled();
      const callArgs = templatesStore.updateTemplate.mock.calls[0];
      expect(callArgs[1].model).toBe('claude-sonnet-4-6');
      expect(callArgs[1].mode).toBe('standard');
      expect(callArgs[1].effortLevel).toBe('high');
    });

    it('submits form with current model value from ModelSelector', async () => {
      const wrapper = mount(TemplateDetailView, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();
      await nextTick();
      await flushPromises();
      await nextTick();

      // Simulate ModelSelector initializing with the template's model value
      // (ModelSelector emits the initial value when it mounts with a modelValue prop)
      const modelSelector = wrapper.findComponent({ name: 'ModelSelector' });
      await modelSelector.vm.$emit('update:modelValue', 'claude-opus-4-20250529');
      await nextTick();

      // Submit form without changing any fields
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      // Verify updateTemplate was called with the model value
      expect(templatesStore.updateTemplate).toHaveBeenCalled();
      const callArgs = templatesStore.updateTemplate.mock.calls[0];
      // Model value should be sent (whatever was loaded from template)
      expect(callArgs[1].model).toBe('claude-opus-4-20250529');
      // Mode should be sent explicitly (even yolo), not omitted
      expect(callArgs[1].mode).toBe('yolo');
    });

    it('submits form with null effort level when set to auto', async () => {
      api.getTemplate.mockResolvedValueOnce({
        id: 'template-2',
        name: 'Template with High Effort',
        prompt: 'Test prompt',
        projectId: 'proj-1',
        effortLevel: 'high',
      });

      const wrapper = mount(TemplateDetailView, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();
      await nextTick();
      await flushPromises();
      await nextTick();

      // Change effort level to null (auto)
      const effortSelector = wrapper.findComponent({ name: 'EffortLevelSelector' });
      await effortSelector.vm.$emit('update:modelValue', null);
      await nextTick();

      // Submit form
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      // Verify updateTemplate was called with null effort level
      expect(templatesStore.updateTemplate).toHaveBeenCalled();
      const callArgs = templatesStore.updateTemplate.mock.calls[0];
      expect(callArgs[1].effortLevel).toBeNull();
    });
  });

  describe('Field Interactions', () => {
    it('allows changing model selection', async () => {
      const wrapper = mount(TemplateDetailView, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();
      await nextTick();
      await flushPromises();
      await nextTick();

      const modelSelector = wrapper.findComponent({ name: 'ModelSelector' });
      await modelSelector.vm.$emit('update:modelValue', 'claude-sonnet-4-6');
      await nextTick();

      expect(modelSelector.props('modelValue')).toBe('claude-sonnet-4-6');
    });

    it('allows changing mode selection', async () => {
      const wrapper = mount(TemplateDetailView, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();
      await nextTick();
      await flushPromises();
      await nextTick();

      const modeSelect = wrapper.find('#mode');
      await modeSelect.setValue('plan');

      expect(modeSelect.element.value).toBe('plan');
    });

    it('allows changing effort level selection', async () => {
      const wrapper = mount(TemplateDetailView, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();
      await nextTick();
      await flushPromises();
      await nextTick();

      const effortSelector = wrapper.findComponent({ name: 'EffortLevelSelector' });
      await effortSelector.vm.$emit('update:modelValue', 'medium');
      await nextTick();

      expect(effortSelector.props('modelValue')).toBe('medium');
    });

    it('allows setting effort level to all valid values', async () => {
      const validLevels = ['low', 'medium', 'high', 'max', null];

      for (const level of validLevels) {
        const wrapper = mount(TemplateDetailView, {
          global: {
            plugins: [pinia, router],
          },
        });

        await flushPromises();
        await nextTick();
        await flushPromises();
        await nextTick();

        const effortSelector = wrapper.findComponent({ name: 'EffortLevelSelector' });
        await effortSelector.vm.$emit('update:modelValue', level);
        await nextTick();

        expect(effortSelector.props('modelValue')).toBe(level);
      }
    });
  });

  describe('Mode Selection Bug Fixes', () => {
    it('MUST send mode value when changing from plan to yolo', async () => {
      // BUG: When user changes mode from 'plan' to 'yolo', the mode should be
      // explicitly sent to the backend so it can be updated.
      // Previously, sending undefined caused the backend to skip the update.

      // Reset and set fresh mock for this test
      api.getTemplate.mockReset();
      api.getTemplate.mockResolvedValue({
        id: 'template-1',
        name: 'Test Template',
        prompt: 'Test prompt',
        projectId: 'proj-1',
        nextTemplateId: null,
        thinkingEnabled: false,
        model: 'claude-opus-4-20250529',
        mode: 'plan', // Template currently has 'plan' mode
      });

      const wrapper = mount(TemplateDetailView, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();
      await nextTick();
      await flushPromises();
      await nextTick();

      // Verify template loaded with 'plan' mode
      const modeSelect = wrapper.find('#mode');
      expect(modeSelect.element.value).toBe('plan');

      // Change mode to 'yolo'
      await modeSelect.setValue('yolo');
      expect(modeSelect.element.value).toBe('yolo');

      // Submit form
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      // Verify updateTemplate was called with mode='yolo' (NOT undefined)
      // The backend needs the explicit value to update from 'plan' to 'yolo'
      expect(templatesStore.updateTemplate).toHaveBeenCalled();
      const callArgs = templatesStore.updateTemplate.mock.calls[0];
      expect(callArgs[1].mode).toBe('yolo'); // This was failing before the fix
    });

    it('MUST send mode value when mode is yolo and template already has yolo', async () => {
      // Even when the mode hasn't changed, we should send the value
      // to ensure the backend keeps it as 'yolo'
      const wrapper = mount(TemplateDetailView, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();
      await nextTick();
      await flushPromises();
      await nextTick();

      // Template already has mode 'yolo' (from beforeEach mock)
      const modeSelect = wrapper.find('#mode');
      expect(modeSelect.element.value).toBe('yolo');

      // Submit form without changing mode
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      // Mode should still be sent (not undefined)
      expect(templatesStore.updateTemplate).toHaveBeenCalled();
      const callArgs = templatesStore.updateTemplate.mock.calls[0];
      // Mode should be 'yolo', not undefined
      expect(callArgs[1].mode).toBe('yolo');
    });
  });

  describe('ResizableTextarea Integration', () => {
    it('renders ResizableTextarea for the prompt field', async () => {
      const wrapper = mount(TemplateDetailView, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();
      await nextTick();

      const resizableTextarea = wrapper.findComponent({ name: 'ResizableTextarea' });
      expect(resizableTextarea.exists()).toBe(true);
      expect(resizableTextarea.props('modelValue')).toBe('Test prompt');
      expect(resizableTextarea.props('minHeight')).toBe(120);
    });

    it('updates prompt via ResizableTextarea v-model', async () => {
      const wrapper = mount(TemplateDetailView, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();
      await nextTick();

      const resizableTextarea = wrapper.findComponent({ name: 'ResizableTextarea' });
      await resizableTextarea.vm.$emit('update:modelValue', 'New prompt text');
      await nextTick();

      expect(resizableTextarea.props('modelValue')).toBe('New prompt text');

      // Verify the updated prompt is included in form submission
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(templatesStore.updateTemplate).toHaveBeenCalled();
      const callArgs = templatesStore.updateTemplate.mock.calls[0];
      expect(callArgs[1].prompt).toBe('New prompt text');
    });
  });
});
