import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import TemplateDetailView from './TemplateDetailView.vue';
import { useTemplatesStore } from '../stores/templates.js';
import { useUiStore } from '../stores/ui.js';
import { CLAUDE_MODELS, DEFAULT_MODEL } from '@claudetools/shared';

// Mock the API
vi.mock('../composables/useApi.js', () => ({
  api: {
    getTemplate: vi.fn(),
  },
}));

import { api } from '../composables/useApi.js';

describe('TemplateDetailView - New Form Fields', () => {
  let pinia;
  let router;
  let templatesStore;
  let uiStore;

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

    // Mock store methods
    vi.spyOn(templatesStore, 'updateTemplate').mockResolvedValue({
      id: 'template-1',
      name: 'Updated Template',
      prompt: 'Updated prompt',
    });
    vi.spyOn(templatesStore, 'deleteTemplate').mockResolvedValue(undefined);

    vi.spyOn(uiStore, 'success').mockImplementation(() => {});
    vi.spyOn(uiStore, 'error').mockImplementation(() => {});

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
      model: DEFAULT_MODEL,
      mode: 'yolo',
    });

    await router.push({ path: '/projects/proj-1/templates/template-1' });
    await router.isReady();
  });

  describe('Form Field Rendering', () => {
    it('displays model dropdown with all Claude models', async () => {
      const wrapper = mount(TemplateDetailView, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();
      await nextTick();

      // Find model select
      const modelSelect = wrapper.find('#model');
      expect(modelSelect.exists()).toBe(true);

      // Check that all CLAUDE_MODELS are present as options
      const options = modelSelect.findAll('option');
      expect(options.length).toBe(CLAUDE_MODELS.length);

      CLAUDE_MODELS.forEach((model, index) => {
        expect(options[index].text()).toBe(model.name);
        expect(options[index].attributes('value')).toBe(model.id);
      });
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
      expect(options.length).toBe(3);
      expect(options[0].attributes('value')).toBe('plan');
      expect(options[0].text()).toBe('Plan');
      expect(options[1].attributes('value')).toBe('standard');
      expect(options[1].text()).toBe('Standard');
      expect(options[2].attributes('value')).toBe('yolo');
      expect(options[2].text()).toBe('YOLO');
    });
  });

  describe('Loading Template Data', () => {
    it('uses default values when template fields are null', async () => {
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

      // Check that defaults are applied
      const modelSelect = wrapper.find('#model');
      expect(modelSelect.element.value).toBe(DEFAULT_MODEL);

      const modeSelect = wrapper.find('#mode');
      expect(modeSelect.element.value).toBe('yolo');
    });
  });

  describe('Form Submission with New Fields', () => {
    it('submits form with model when different from default', async () => {
      const wrapper = mount(TemplateDetailView, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();
      await nextTick();
      await flushPromises();
      await nextTick();

      // Change model to non-default (sonnet instead of opus)
      const modelSelect = wrapper.find('#model');
      await modelSelect.setValue('claude-sonnet-4-5-20250929');

      // Submit form
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      // Verify updateTemplate was called
      expect(templatesStore.updateTemplate).toHaveBeenCalled();
      const callArgs = templatesStore.updateTemplate.mock.calls[0];
      expect(callArgs[0]).toBe('template-1');
      expect(callArgs[1].model).toBe('claude-sonnet-4-5-20250929');
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
      const modelSelect = wrapper.find('#model');
      await modelSelect.setValue('claude-sonnet-4-5-20250929');

      const modeSelect = wrapper.find('#mode');
      await modeSelect.setValue('standard');

      // Submit form
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      // Verify updateTemplate was called with all new fields
      expect(templatesStore.updateTemplate).toHaveBeenCalled();
      const callArgs = templatesStore.updateTemplate.mock.calls[0];
      expect(callArgs[1].model).toBe('claude-sonnet-4-5-20250929');
      expect(callArgs[1].mode).toBe('standard');
    });

    it('omits default values from submission', async () => {
      const wrapper = mount(TemplateDetailView, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();
      await nextTick();
      await flushPromises();
      await nextTick();

      // Submit form without changing any new fields
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      // Verify updateTemplate was called without default values
      expect(templatesStore.updateTemplate).toHaveBeenCalled();
      const callArgs = templatesStore.updateTemplate.mock.calls[0];
      // DEFAULT_MODEL should be omitted
      expect(callArgs[1].model).toBeUndefined();
      // yolo should be omitted
      expect(callArgs[1].mode).toBeUndefined();
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

      const modelSelect = wrapper.find('#model');
      await modelSelect.setValue('claude-sonnet-4-5-20250929');

      expect(modelSelect.element.value).toBe('claude-sonnet-4-5-20250929');
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
  });
});
