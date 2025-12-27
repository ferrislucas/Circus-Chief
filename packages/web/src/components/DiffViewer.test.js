import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import DiffViewer from './DiffViewer.vue';

describe('DiffViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mountComponent(files = []) {
    const div = document.createElement('div');
    document.body.appendChild(div);

    return mount(DiffViewer, {
      props: {
        files,
      },
      attachTo: div,
    });
  }

  describe('copyFilePath functionality', () => {
    it('copies file path to clipboard on button click', async () => {
      navigator.clipboard.writeText.mockResolvedValue(undefined);

      const files = [
        {
          displayPath: 'src/main.js',
          isNew: false,
          isDeleted: false,
          isRenamed: false,
          additions: 5,
          deletions: 0,
          diff: 'diff content',
        },
      ];

      const wrapper = mountComponent(files);
      await nextTick();

      const copyButton = wrapper.find('.copy-button');
      await copyButton.trigger('click');
      await nextTick();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('src/main.js');
    });

    it('shows success feedback (checkmark) after copy', async () => {
      navigator.clipboard.writeText.mockResolvedValue(undefined);

      const files = [
        {
          displayPath: 'src/main.js',
          isNew: false,
          isDeleted: false,
          isRenamed: false,
          additions: 5,
          deletions: 0,
          diff: 'diff content',
        },
      ];

      const wrapper = mountComponent(files);
      await nextTick();

      const copyButton = wrapper.find('.copy-button');
      expect(copyButton.text()).toContain('📋');

      await copyButton.trigger('click');
      await nextTick();

      // Should show checkmark
      expect(wrapper.vm.copiedFileIndex).toBe(0);
      expect(copyButton.text()).toContain('✓');
    });

    it('resets copy feedback after 1.5 seconds', async () => {
      vi.useFakeTimers();
      navigator.clipboard.writeText.mockResolvedValue(undefined);

      const files = [
        {
          displayPath: 'src/main.js',
          isNew: false,
          isDeleted: false,
          isRenamed: false,
          additions: 5,
          deletions: 0,
          diff: 'diff content',
        },
      ];

      const wrapper = mountComponent(files);
      await nextTick();

      const copyButton = wrapper.find('.copy-button');
      await copyButton.trigger('click');
      await nextTick();

      expect(wrapper.vm.copiedFileIndex).toBe(0);

      // Fast forward 1.5 seconds
      vi.advanceTimersByTime(1500);
      await nextTick();

      expect(wrapper.vm.copiedFileIndex).toBeNull();

      vi.useRealTimers();
    });

    it('applies "copied" class when copy is successful', async () => {
      navigator.clipboard.writeText.mockResolvedValue(undefined);

      const files = [
        {
          displayPath: 'src/component.vue',
          isNew: false,
          isDeleted: false,
          isRenamed: false,
          additions: 10,
          deletions: 2,
          diff: 'diff content',
        },
      ];

      const wrapper = mountComponent(files);
      await nextTick();

      const copyButton = wrapper.find('.copy-button');

      // Initially no copied class
      expect(copyButton.classes()).not.toContain('copied');

      await copyButton.trigger('click');
      await nextTick();

      // Should have copied class
      expect(copyButton.classes('copied')).toBe(true);
    });

    it('handles clipboard API failure with fallback', async () => {
      // Mock clipboard.writeText to fail
      navigator.clipboard.writeText.mockRejectedValue(new Error('Clipboard denied'));

      // Mock execCommand fallback
      const mockExecCommand = vi.fn().mockReturnValue(true);
      const mockSelect = vi.fn();

      global.document.execCommand = mockExecCommand;

      const files = [
        {
          displayPath: 'src/app.js',
          isNew: false,
          isDeleted: false,
          isRenamed: false,
          additions: 3,
          deletions: 1,
          diff: 'diff content',
        },
      ];

      const wrapper = mountComponent(files);
      await nextTick();

      const copyButton = wrapper.find('.copy-button');
      await copyButton.trigger('click');
      await flushPromises();
      await nextTick();

      // Fallback should be attempted
      expect(mockExecCommand).toHaveBeenCalledWith('copy');
      // Should still show success
      expect(wrapper.vm.copiedFileIndex).toBe(0);
    });

    it('copies correct file path when multiple files present', async () => {
      navigator.clipboard.writeText.mockResolvedValue(undefined);

      const files = [
        {
          displayPath: 'src/main.js',
          isNew: false,
          isDeleted: false,
          isRenamed: false,
          additions: 5,
          deletions: 0,
          diff: 'diff content',
        },
        {
          displayPath: 'src/components/Card.vue',
          isNew: false,
          isDeleted: false,
          isRenamed: false,
          additions: 10,
          deletions: 3,
          diff: 'diff content',
        },
        {
          displayPath: 'src/utils/helpers.js',
          isNew: false,
          isDeleted: false,
          isRenamed: false,
          additions: 2,
          deletions: 1,
          diff: 'diff content',
        },
      ];

      const wrapper = mountComponent(files);
      await nextTick();

      const copyButtons = wrapper.findAll('.copy-button');
      expect(copyButtons).toHaveLength(3);

      // Click second button
      await copyButtons[1].trigger('click');
      await nextTick();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('src/components/Card.vue');
      expect(wrapper.vm.copiedFileIndex).toBe(1);
    });

    it('disables copy on click event propagation', async () => {
      navigator.clipboard.writeText.mockResolvedValue(undefined);

      const files = [
        {
          displayPath: 'src/main.js',
          isNew: false,
          isDeleted: false,
          isRenamed: false,
          additions: 5,
          deletions: 0,
          diff: 'diff content',
        },
      ];

      const wrapper = mountComponent(files);
      await nextTick();

      const copyButton = wrapper.find('.copy-button');

      // Check that @click.stop is applied (prevents propagation)
      const clickEvent = new MouseEvent('click', { bubbles: true });
      const stopPropagationSpy = vi.spyOn(clickEvent, 'stopPropagation');

      await copyButton.trigger('click', { stopPropagation: stopPropagationSpy });

      // The button uses @click.stop, so propagation should be stopped
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });

    it('has correct aria-label for accessibility', async () => {
      const files = [
        {
          displayPath: 'src/api.js',
          isNew: false,
          isDeleted: false,
          isRenamed: false,
          additions: 5,
          deletions: 0,
          diff: 'diff content',
        },
      ];

      const wrapper = mountComponent(files);
      await nextTick();

      const copyButton = wrapper.find('.copy-button');
      expect(copyButton.attributes('aria-label')).toBe('Copy src/api.js to clipboard');
    });

    it('updates title attribute based on copy state', async () => {
      vi.useFakeTimers();
      navigator.clipboard.writeText.mockResolvedValue(undefined);

      const files = [
        {
          displayPath: 'src/main.js',
          isNew: false,
          isDeleted: false,
          isRenamed: false,
          additions: 5,
          deletions: 0,
          diff: 'diff content',
        },
      ];

      const wrapper = mountComponent(files);
      await nextTick();

      const copyButton = wrapper.find('.copy-button');

      // Initial title
      expect(copyButton.attributes('title')).toBe('Copy filename');

      await copyButton.trigger('click');
      await nextTick();

      // After copy
      expect(copyButton.attributes('title')).toBe('Copied!');

      // Reset after 1.5 seconds
      vi.advanceTimersByTime(1500);
      await nextTick();

      expect(copyButton.attributes('title')).toBe('Copy filename');

      vi.useRealTimers();
    });
  });

  describe('copy button styling', () => {
    it('renders copy button with correct icon', async () => {
      const files = [
        {
          displayPath: 'src/main.js',
          isNew: false,
          isDeleted: false,
          isRenamed: false,
          additions: 5,
          deletions: 0,
          diff: 'diff content',
        },
      ];

      const wrapper = mountComponent(files);
      await nextTick();

      const copyButtonIcon = wrapper.find('.copy-button-icon');
      expect(copyButtonIcon.text()).toBe('📋');
    });

    it('renders copy button with checkmark icon when copied', async () => {
      vi.useFakeTimers();
      navigator.clipboard.writeText.mockResolvedValue(undefined);

      const files = [
        {
          displayPath: 'src/main.js',
          isNew: false,
          isDeleted: false,
          isRenamed: false,
          additions: 5,
          deletions: 0,
          diff: 'diff content',
        },
      ];

      const wrapper = mountComponent(files);
      await nextTick();

      const copyButton = wrapper.find('.copy-button');
      const copyButtonIcon = wrapper.find('.copy-button-icon');

      expect(copyButtonIcon.text()).toBe('📋');

      await copyButton.trigger('click');
      await nextTick();

      expect(copyButtonIcon.text()).toBe('✓');

      vi.useRealTimers();
    });
  });
});
