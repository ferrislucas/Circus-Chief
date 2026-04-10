/* eslint-env vitest */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ArchiveConfirmModal from './ArchiveConfirmModal.vue';

describe('ArchiveConfirmModal.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up teleported content
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
  });

  const defaultProps = {
    isOpen: true,
    sessionName: 'My Session',
    hasWorktree: false,
  };

  function mountModal(props = {}, listeners = {}) {
    return mount(ArchiveConfirmModal, {
      props: {
        ...defaultProps,
        ...props,
        ...listeners,
      },
      attachTo: document.body,
    });
  }

  describe('Rendering & visibility', () => {
    it('does not render when isOpen is false', () => {
      mountModal({ isOpen: false });
      expect(document.querySelector('.modal-backdrop')).toBeNull();
    });

    it('renders modal when isOpen is true', () => {
      mountModal({ isOpen: true });
      expect(document.querySelector('.modal-backdrop')).not.toBeNull();
    });

    it('displays the session name in the confirmation message', () => {
      mountModal({ sessionName: 'My Session' });
      const message = document.querySelector('.confirm-message');
      expect(message.textContent).toContain('My Session');
      expect(message.querySelector('strong').textContent).toBe('My Session');
    });
  });

  describe('Worktree cleanup checkbox', () => {
    it('shows cleanup checkbox when hasWorktree is true', () => {
      mountModal({ hasWorktree: true });
      expect(document.querySelector('input[type="checkbox"]')).not.toBeNull();
    });

    it('hides cleanup checkbox when hasWorktree is false', () => {
      mountModal({ hasWorktree: false });
      expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    });
  });

  describe('Confirm action', () => {
    it('emits confirm(true) when Archive clicked with checkbox checked (default)', async () => {
      const onConfirm = vi.fn();
      mountModal({ hasWorktree: true, onConfirm });
      const buttons = document.querySelectorAll('button');
      const archiveBtn = Array.from(buttons).find(b => b.textContent === 'Archive');
      archiveBtn.click();
      await nextTick();
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onConfirm).toHaveBeenCalledWith(true);
    });

    it('emits confirm(false) when Archive clicked with checkbox unchecked', async () => {
      const onConfirm = vi.fn();
      mountModal({ hasWorktree: true, onConfirm });
      const checkbox = document.querySelector('input[type="checkbox"]');
      checkbox.click();
      await nextTick();
      const buttons = document.querySelectorAll('button');
      const archiveBtn = Array.from(buttons).find(b => b.textContent === 'Archive');
      archiveBtn.click();
      await nextTick();
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onConfirm).toHaveBeenCalledWith(false);
    });
  });

  describe('Cancel behavior', () => {
    it('emits cancel when Cancel button is clicked', async () => {
      const onCancel = vi.fn();
      mountModal({}, { onCancel });
      const buttons = document.querySelectorAll('button');
      const cancelBtn = Array.from(buttons).find(b => b.textContent === 'Cancel');
      cancelBtn.click();
      await nextTick();
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('emits cancel when backdrop is clicked', async () => {
      const onCancel = vi.fn();
      mountModal({}, { onCancel });
      const backdrop = document.querySelector('.modal-backdrop');
      backdrop.click();
      await nextTick();
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('emits cancel when Escape key is pressed', async () => {
      const onCancel = vi.fn();
      mountModal({ isOpen: true }, { onCancel });
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);
      await nextTick();
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('State reset on re-open', () => {
    it('resets cleanupWorktree to true when modal re-opens', async () => {
      const wrapper = mountModal({ isOpen: true, hasWorktree: true });
      // Uncheck the checkbox
      const checkbox = document.querySelector('input[type="checkbox"]');
      checkbox.click();
      await nextTick();
      expect(checkbox.checked).toBe(false);

      // Close the modal
      await wrapper.setProps({ isOpen: false });
      await nextTick();

      // Re-open
      await wrapper.setProps({ isOpen: true });
      await nextTick();

      // Checkbox should be checked again
      const checkboxAfter = document.querySelector('input[type="checkbox"]');
      expect(checkboxAfter.checked).toBe(true);
    });
  });
});
