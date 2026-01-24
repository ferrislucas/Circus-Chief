import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';

import CanvasFileList from './CanvasFileList.vue';

// Global helper to flush all async updates
async function flushAll(wrapper) {
  await flushPromises();
  await nextTick();
  if (wrapper && wrapper.vm) {
    await wrapper.vm.$nextTick?.();
    await wrapper.vm.$forceUpdate();
    await nextTick();
  }
}

describe('CanvasFileList', () => {
  let mockClipboard;

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock clipboard API
    mockClipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
    };
    Object.defineProperty(navigator, 'clipboard', {
      value: mockClipboard,
      configurable: true,
    });
    // Mock timers for copy feedback
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mountComponent(props = { items: [] }) {
    return mount(CanvasFileList, {
      props,
    });
  }

  describe('rendering', () => {
    it('renders items list', () => {
      const wrapper = mountComponent({
        items: [
          { id: '1', filename: 'test.png', type: 'image', createdAt: Date.now() },
          { id: '2', filename: 'doc.md', type: 'markdown', createdAt: Date.now() },
        ],
      });

      const rows = wrapper.findAll('.file-row');
      expect(rows).toHaveLength(2);
    });

    it('displays filename for each item', () => {
      const wrapper = mountComponent({
        items: [
          { id: '1', filename: 'myfile.txt', type: 'text', createdAt: Date.now() },
        ],
      });

      expect(wrapper.find('.file-name').text()).toBe('myfile.txt');
    });

    it('displays type icon', () => {
      const wrapper = mountComponent({
        items: [
          { id: '1', filename: 'photo.png', type: 'image', createdAt: Date.now() },
        ],
      });

      expect(wrapper.find('.file-icon').text()).toContain('📷');
    });

    it('displays version badge when versionCount > 1', () => {
      const wrapper = mountComponent({
        items: [
          { id: '1', filename: 'multi.txt', type: 'text', createdAt: Date.now(), versionCount: 3 },
        ],
      });

      expect(wrapper.find('.version-badge').exists()).toBe(true);
      expect(wrapper.find('.version-badge').text()).toContain('v3');
    });

    it('hides version badge when versionCount is 1', () => {
      const wrapper = mountComponent({
        items: [
          { id: '1', filename: 'single.txt', type: 'text', createdAt: Date.now(), versionCount: 1 },
        ],
      });

      expect(wrapper.find('.version-badge').exists()).toBe(false);
    });
  });

  describe('copy button', () => {
    it('renders copy button for each item', () => {
      const wrapper = mountComponent({
        items: [
          { id: '1', filename: 'test.png', type: 'image', createdAt: Date.now() },
          { id: '2', filename: 'doc.md', type: 'markdown', createdAt: Date.now() },
        ],
      });

      const copyButtons = wrapper.findAll('.copy-button');
      expect(copyButtons).toHaveLength(2);
    });

    it('copies filename to clipboard on click', async () => {
      const wrapper = mountComponent({
        items: [
          { id: '1', filename: 'myfile.txt', type: 'text', createdAt: Date.now() },
        ],
      });

      const copyButton = wrapper.find('.copy-button');
      await copyButton.trigger('click');

      expect(mockClipboard.writeText).toHaveBeenCalledWith('myfile.txt');
    });

    it('uses Untitled as fallback when filename is missing', async () => {
      const wrapper = mountComponent({
        items: [
          { id: '1', type: 'text', createdAt: Date.now() },
        ],
      });

      const copyButton = wrapper.find('.copy-button');
      await copyButton.trigger('click');

      expect(mockClipboard.writeText).toHaveBeenCalledWith('Untitled');
    });

    it('shows copied state temporarily', async () => {
      const wrapper = mountComponent({
        items: [
          { id: '1', filename: 'test.txt', type: 'text', createdAt: Date.now() },
        ],
      });

      const copyButton = wrapper.find('.copy-button');
      await copyButton.trigger('click');
      await flushAll(wrapper);

      // Should show checkmark after copy
      expect(copyButton.text()).toContain('✓');
      expect(copyButton.classes()).toContain('copied');

      // After 1.5s, should revert
      vi.advanceTimersByTime(1500);
      await flushAll(wrapper);

      expect(copyButton.text()).toContain('📋');
      expect(copyButton.classes()).not.toContain('copied');
    });

    it('stops click propagation (does not trigger row selection)', async () => {
      const wrapper = mountComponent({
        items: [
          { id: '1', filename: 'test.txt', type: 'text', createdAt: Date.now() },
        ],
      });

      const copyButton = wrapper.find('.copy-button');
      await copyButton.trigger('click');

      // Should not emit 'select' when clicking copy button
      expect(wrapper.emitted('select')).toBeFalsy();
    });

    it('has correct aria-label for accessibility', () => {
      const wrapper = mountComponent({
        items: [
          { id: '1', filename: 'accessible.txt', type: 'text', createdAt: Date.now() },
        ],
      });

      const copyButton = wrapper.find('.copy-button');
      expect(copyButton.attributes('aria-label')).toContain('Copy');
      expect(copyButton.attributes('aria-label')).toContain('accessible.txt');
    });
  });

  describe('type icons', () => {
    const testCases = [
      { type: 'image', expected: '📷' },
      { type: 'markdown', expected: '📄' },
      { type: 'json', expected: '📋' },
      { type: 'text', expected: '📝' },
      { type: 'pdf', expected: '📕' },
      { type: 'code', expected: '💻' },
      { type: 'unknown', expected: '📁' },
    ];

    testCases.forEach(({ type, expected }) => {
      it(`displays correct icon for ${type} type`, () => {
        const wrapper = mountComponent({
          items: [
            { id: '1', filename: 'test', type, createdAt: Date.now() },
          ],
        });

        expect(wrapper.find('.file-icon').text()).toContain(expected);
      });
    });
  });
});
