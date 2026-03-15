import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import PrUrlEditor from './PrUrlEditor.vue';

vi.mock('./PrIndicators.vue', () => ({
  default: {
    name: 'PrIndicators',
    template: '<div class="pr-indicators">PR: {{ prUrl }}</div>',
    props: ['prUrl', 'summary'],
  }
}));

vi.mock('../composables/useApi.js', () => ({
  api: {
    updateSession: vi.fn().mockResolvedValue({}),
  },
}));

import { api } from '../composables/useApi.js';

describe('PrUrlEditor', () => {
  let pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
  });

  function mountEditor(props = {}) {
    return mount(PrUrlEditor, {
      global: { plugins: [pinia] },
      props: {
        sessionId: 'session-1',
        prUrl: '',
        summary: null,
        ...props,
      },
    });
  }

  describe('display mode (not editing)', () => {
    it('shows "Link PR" text when no prUrl is set', () => {
      const wrapper = mountEditor({ prUrl: '' });
      const trigger = wrapper.find('.pr-edit-trigger');
      expect(trigger.exists()).toBe(true);
      expect(trigger.text()).toContain('Link PR');
    });

    it('does not show "Link PR" text when prUrl is set', () => {
      const wrapper = mountEditor({ prUrl: 'https://github.com/owner/repo/pull/123' });
      const trigger = wrapper.find('.pr-edit-trigger');
      expect(trigger.exists()).toBe(true);
      expect(trigger.text()).not.toContain('Link PR');
    });

    it('renders PrIndicators when prUrl is set', () => {
      const wrapper = mountEditor({ prUrl: 'https://github.com/owner/repo/pull/123' });
      const indicators = wrapper.findComponent({ name: 'PrIndicators' });
      expect(indicators.exists()).toBe(true);
      expect(indicators.props('prUrl')).toBe('https://github.com/owner/repo/pull/123');
    });

    it('does not render PrIndicators when prUrl is empty', () => {
      const wrapper = mountEditor({ prUrl: '' });
      const indicators = wrapper.findComponent({ name: 'PrIndicators' });
      expect(indicators.exists()).toBe(false);
    });

    it('passes summary to PrIndicators', () => {
      const summary = { title: 'Test Summary' };
      const wrapper = mountEditor({
        prUrl: 'https://github.com/owner/repo/pull/123',
        summary,
      });
      const indicators = wrapper.findComponent({ name: 'PrIndicators' });
      expect(indicators.props('summary')).toEqual(summary);
    });

    it('edit trigger has "Add PR URL" title when no prUrl', () => {
      const wrapper = mountEditor({ prUrl: '' });
      const trigger = wrapper.find('.pr-edit-trigger');
      expect(trigger.attributes('title')).toBe('Add PR URL');
    });

    it('edit trigger has "Edit PR URL" title when prUrl is set', () => {
      const wrapper = mountEditor({ prUrl: 'https://github.com/owner/repo/pull/123' });
      const trigger = wrapper.find('.pr-edit-trigger');
      expect(trigger.attributes('title')).toBe('Edit PR URL');
    });
  });

  describe('entering edit mode', () => {
    it('shows edit form when edit trigger is clicked', async () => {
      const wrapper = mountEditor({ prUrl: '' });
      expect(wrapper.find('.pr-edit-form').exists()).toBe(false);

      await wrapper.find('.pr-edit-trigger').trigger('click');
      expect(wrapper.find('.pr-edit-form').exists()).toBe(true);
      expect(wrapper.find('.pr-url-input').exists()).toBe(true);
    });

    it('populates input with existing prUrl when editing', async () => {
      const prUrl = 'https://github.com/owner/repo/pull/123';
      const wrapper = mountEditor({ prUrl });

      await wrapper.find('.pr-edit-trigger').trigger('click');

      const input = wrapper.find('.pr-url-input');
      expect(input.element.value).toBe(prUrl);
    });

    it('input has correct placeholder', async () => {
      const wrapper = mountEditor({ prUrl: '' });
      await wrapper.find('.pr-edit-trigger').trigger('click');

      const input = wrapper.find('.pr-url-input');
      expect(input.attributes('placeholder')).toBe('https://github.com/owner/repo/pull/123');
    });
  });

  describe('cancel', () => {
    it('cancels editing when cancel button is clicked', async () => {
      const wrapper = mountEditor({ prUrl: '' });
      await wrapper.find('.pr-edit-trigger').trigger('click');
      expect(wrapper.find('.pr-edit-form').exists()).toBe(true);

      await wrapper.find('.pr-cancel-btn').trigger('click');
      expect(wrapper.find('.pr-edit-form').exists()).toBe(false);
    });

    it('cancels editing when Escape key is pressed', async () => {
      const wrapper = mountEditor({ prUrl: '' });
      await wrapper.find('.pr-edit-trigger').trigger('click');
      expect(wrapper.find('.pr-edit-form').exists()).toBe(true);

      await wrapper.find('.pr-url-input').trigger('keyup.escape');
      expect(wrapper.find('.pr-edit-form').exists()).toBe(false);
    });
  });

  describe('save', () => {
    it('saves valid PR URL on Enter', async () => {
      api.updateSession.mockResolvedValue({ prUrl: 'https://github.com/owner/repo/pull/456' });
      const wrapper = mountEditor({ prUrl: '' });
      await wrapper.find('.pr-edit-trigger').trigger('click');

      const input = wrapper.find('.pr-url-input');
      await input.setValue('https://github.com/owner/repo/pull/456');
      await input.trigger('keyup.enter');
      await flushPromises();

      expect(api.updateSession).toHaveBeenCalledWith('session-1', { prUrl: 'https://github.com/owner/repo/pull/456' });
    });

    it('saves valid PR URL on save button click', async () => {
      api.updateSession.mockResolvedValue({ prUrl: 'https://github.com/owner/repo/pull/789' });
      const wrapper = mountEditor({ prUrl: '' });
      await wrapper.find('.pr-edit-trigger').trigger('click');

      await wrapper.find('.pr-url-input').setValue('https://github.com/owner/repo/pull/789');
      await wrapper.find('.pr-save-btn').trigger('click');
      await flushPromises();

      expect(api.updateSession).toHaveBeenCalledWith('session-1', { prUrl: 'https://github.com/owner/repo/pull/789' });
    });

    it('closes edit form after successful save', async () => {
      api.updateSession.mockResolvedValue({});
      const wrapper = mountEditor({ prUrl: '' });
      await wrapper.find('.pr-edit-trigger').trigger('click');

      await wrapper.find('.pr-url-input').setValue('https://github.com/owner/repo/pull/1');
      await wrapper.find('.pr-save-btn').trigger('click');
      await flushPromises();

      expect(wrapper.find('.pr-edit-form').exists()).toBe(false);
    });

    it('allows saving empty URL to clear the PR URL', async () => {
      api.updateSession.mockResolvedValue({});
      const wrapper = mountEditor({ prUrl: 'https://github.com/owner/repo/pull/123' });
      await wrapper.find('.pr-edit-trigger').trigger('click');

      await wrapper.find('.pr-url-input').setValue('');
      await wrapper.find('.pr-save-btn').trigger('click');
      await flushPromises();

      expect(api.updateSession).toHaveBeenCalledWith('session-1', { prUrl: null });
    });
  });

  describe('validation', () => {
    it('rejects invalid GitHub PR URL', async () => {
      const wrapper = mountEditor({ prUrl: '' });
      await wrapper.find('.pr-edit-trigger').trigger('click');

      await wrapper.find('.pr-url-input').setValue('https://not-github.com/foo');
      await wrapper.find('.pr-save-btn').trigger('click');
      await flushPromises();

      expect(api.updateSession).not.toHaveBeenCalled();
      // Form should stay open
      expect(wrapper.find('.pr-edit-form').exists()).toBe(true);
    });

    it('rejects non-PR GitHub URLs', async () => {
      const wrapper = mountEditor({ prUrl: '' });
      await wrapper.find('.pr-edit-trigger').trigger('click');

      await wrapper.find('.pr-url-input').setValue('https://github.com/owner/repo/issues/123');
      await wrapper.find('.pr-save-btn').trigger('click');
      await flushPromises();

      expect(api.updateSession).not.toHaveBeenCalled();
    });

    it('accepts valid GitHub PR URL', () => {
      const wrapper = mountEditor();
      const pattern = wrapper.vm.PR_URL_PATTERN;
      expect(pattern.test('https://github.com/owner/repo/pull/123')).toBe(true);
      expect(pattern.test('https://github.com/my-org/my-repo/pull/1')).toBe(true);
    });

    it('rejects URLs with trailing slashes', () => {
      const wrapper = mountEditor();
      const pattern = wrapper.vm.PR_URL_PATTERN;
      expect(pattern.test('https://github.com/owner/repo/pull/123/')).toBe(false);
    });
  });

  describe('clear button', () => {
    it('shows clear button when input has value', async () => {
      const wrapper = mountEditor({ prUrl: 'https://github.com/owner/repo/pull/123' });
      await wrapper.find('.pr-edit-trigger').trigger('click');

      expect(wrapper.find('.pr-clear-btn').exists()).toBe(true);
    });

    it('hides clear button when input is empty', async () => {
      const wrapper = mountEditor({ prUrl: '' });
      await wrapper.find('.pr-edit-trigger').trigger('click');

      expect(wrapper.find('.pr-clear-btn').exists()).toBe(false);
    });

    it('clears input and saves when clear button is clicked', async () => {
      api.updateSession.mockResolvedValue({});
      const wrapper = mountEditor({ prUrl: 'https://github.com/owner/repo/pull/123' });
      await wrapper.find('.pr-edit-trigger').trigger('click');

      await wrapper.find('.pr-clear-btn').trigger('click');
      await flushPromises();

      expect(api.updateSession).toHaveBeenCalledWith('session-1', { prUrl: null });
    });
  });

  describe('error handling', () => {
    it('keeps form open on API error', async () => {
      api.updateSession.mockRejectedValue(new Error('Network error'));
      const wrapper = mountEditor({ prUrl: '' });
      await wrapper.find('.pr-edit-trigger').trigger('click');

      await wrapper.find('.pr-url-input').setValue('https://github.com/owner/repo/pull/123');
      await wrapper.find('.pr-save-btn').trigger('click');
      await flushPromises();

      // Form should stay open since save failed
      expect(wrapper.find('.pr-edit-form').exists()).toBe(true);
    });
  });
});
