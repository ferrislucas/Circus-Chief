import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import SessionCardHeaderActions from './SessionCardHeaderActions.vue';

describe('SessionCardHeaderActions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function mountComponent(props = {}) {
    return mount(SessionCardHeaderActions, {
      props: {
        dateToShow: '2024-01-15T10:30:00Z',
        isChild: false,
        isOnBoard: false,
        kanbanEnabled: true,
        showArchive: false,
        showUnarchive: false,
        sessionStatus: 'completed',
        starred: false,
        ...props,
      },
    });
  }

  describe('Add to Board button', () => {
    it('shows Add to Board button when kanbanEnabled=true and isOnBoard=false', () => {
      const wrapper = mountComponent({
        kanbanEnabled: true,
        isOnBoard: false,
      });
      expect(wrapper.find('.add-to-board-btn').exists()).toBe(true);
    });

    it('hides Add to Board button when kanbanEnabled=false', () => {
      const wrapper = mountComponent({
        kanbanEnabled: false,
        isOnBoard: false,
      });
      expect(wrapper.find('.add-to-board-btn').exists()).toBe(false);
    });

    it('hides Add to Board button when isOnBoard=true (even if kanbanEnabled=true)', () => {
      const wrapper = mountComponent({
        kanbanEnabled: true,
        isOnBoard: true,
      });
      expect(wrapper.find('.add-to-board-btn').exists()).toBe(false);
    });

    it('defaults kanbanEnabled to true for backward compatibility', () => {
      // Mount without passing kanbanEnabled prop explicitly
      const wrapper = mount(SessionCardHeaderActions, {
        props: {
          dateToShow: '2024-01-15T10:30:00Z',
          isChild: false,
          isOnBoard: false,
          showArchive: false,
          showUnarchive: false,
          sessionStatus: 'completed',
          starred: false,
        },
      });
      // Should show button since kanbanEnabled defaults to true
      expect(wrapper.find('.add-to-board-btn').exists()).toBe(true);
    });

    it('Add to Board button is interactive', () => {
      const wrapper = mountComponent({
        kanbanEnabled: true,
        isOnBoard: false,
      });
      const btn = wrapper.find('.add-to-board-btn');
      expect(btn.exists()).toBe(true);
      // Button is clickable (not disabled)
      expect(btn.attributes('disabled')).toBeUndefined();
    });

    it('has correct title attribute', () => {
      const wrapper = mountComponent({
        kanbanEnabled: true,
        isOnBoard: false,
      });
      const btn = wrapper.find('.add-to-board-btn');
      expect(btn.attributes('title')).toBe('Add to kanban board');
    });
  });

  describe('isChild behavior', () => {
    it('hides all action buttons (including Add to Board) when isChild=true', () => {
      const wrapper = mountComponent({
        isChild: true,
        kanbanEnabled: true,
        isOnBoard: false,
        showArchive: true,
      });
      expect(wrapper.find('.add-to-board-btn').exists()).toBe(false);
      expect(wrapper.find('.archive-btn').exists()).toBe(false);
      expect(wrapper.find('.archive-actions').exists()).toBe(false);
    });
  });

  describe('archive button', () => {
    let confirmSpy;

    beforeEach(() => {
      confirmSpy = vi.spyOn(window, 'confirm');
    });

    afterEach(() => {
      if (confirmSpy) {
        confirmSpy.mockRestore();
      }
    });

    it('shows archive button when showArchive is true and canArchive is true', () => {
      const wrapper = mountComponent({
        showArchive: true,
        sessionStatus: 'completed',
      });
      const archiveBtn = wrapper.find('.archive-btn');
      expect(archiveBtn.exists()).toBe(true);
      expect(archiveBtn.attributes('title')).toBe('Archive session');
    });

    it('hides archive button when sessionStatus is running', () => {
      const wrapper = mountComponent({
        showArchive: true,
        sessionStatus: 'running',
      });
      expect(wrapper.find('.archive-btn[title="Archive session"]').exists()).toBe(false);
    });

    it('hides archive button when sessionStatus is starting', () => {
      const wrapper = mountComponent({
        showArchive: true,
        sessionStatus: 'starting',
      });
      expect(wrapper.find('.archive-btn[title="Archive session"]').exists()).toBe(false);
    });

    it('shows confirm dialog when archive button is clicked', async () => {
      confirmSpy.mockReturnValue(true);
      const wrapper = mountComponent({
        showArchive: true,
        sessionStatus: 'completed',
      });
      const btn = wrapper.find('.archive-btn');
      await btn.trigger('click');
      expect(confirmSpy).toHaveBeenCalledWith('Archive this session?');
    });

    it('does not emit archive event when user cancels', async () => {
      confirmSpy.mockReturnValue(false);
      const wrapper = mountComponent({
        showArchive: true,
        sessionStatus: 'completed',
      });
      const btn = wrapper.find('.archive-btn');
      await btn.trigger('click');
      expect(wrapper.emitted('archive')).toBeFalsy();
    });
  });

  describe('unarchive button', () => {
    let confirmSpy;

    beforeEach(() => {
      confirmSpy = vi.spyOn(window, 'confirm');
    });

    afterEach(() => {
      if (confirmSpy) {
        confirmSpy.mockRestore();
      }
    });

    it('shows unarchive button when showUnarchive is true', () => {
      const wrapper = mountComponent({
        showUnarchive: true,
      });
      const unarchiveBtn = wrapper.find('.archive-btn');
      expect(unarchiveBtn.exists()).toBe(true);
      expect(unarchiveBtn.attributes('title')).toBe('Unarchive session');
    });

    it('shows confirm dialog when unarchive button is clicked', async () => {
      confirmSpy.mockReturnValue(true);
      const wrapper = mountComponent({
        showUnarchive: true,
      });
      const btn = wrapper.find('.archive-btn');
      await btn.trigger('click');
      expect(confirmSpy).toHaveBeenCalledWith('Restore this session to active?');
    });

    it('does not emit unarchive event when user cancels', async () => {
      confirmSpy.mockReturnValue(false);
      const wrapper = mountComponent({
        showUnarchive: true,
      });
      const btn = wrapper.find('.archive-btn');
      await btn.trigger('click');
      expect(wrapper.emitted('unarchive')).toBeFalsy();
    });
  });

  describe('star button', () => {
    it('shows star button in archive-actions', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.star-btn-mobile').exists()).toBe(true);
    });

    it('star button is interactive', () => {
      const wrapper = mountComponent();
      const btn = wrapper.find('.star-btn-mobile');
      expect(btn.exists()).toBe(true);
      // Button is clickable (not disabled)
      expect(btn.attributes('disabled')).toBeUndefined();
    });

    it('shows filled star when starred is true', () => {
      const wrapper = mountComponent({ starred: true });
      const btn = wrapper.find('.star-btn-mobile');
      // When starred=true, SVG should have fill="currentColor"
      const svg = btn.find('svg');
      expect(svg.attributes('fill')).toBe('currentColor');
    });

    it('shows outline star when starred is false', () => {
      const wrapper = mountComponent({ starred: false });
      const btn = wrapper.find('.star-btn-mobile');
      // When starred=false, SVG should have fill="none"
      const svg = btn.find('svg');
      expect(svg.attributes('fill')).toBe('none');
    });
  });

  describe('date display', () => {
    it('displays formatted date', () => {
      const wrapper = mountComponent({
        dateToShow: '2024-01-15T10:30:00Z',
      });
      const dateEl = wrapper.find('.session-date');
      expect(dateEl.exists()).toBe(true);
      expect(dateEl.text()).toMatch(/Jan.*15.*2024/);
    });
  });

  describe('combined visibility scenarios', () => {
    it('shows Add to Board button only when kanbanEnabled=true AND isOnBoard=false AND isChild=false', () => {
      // All conditions met
      let wrapper = mountComponent({
        kanbanEnabled: true,
        isOnBoard: false,
        isChild: false,
      });
      expect(wrapper.find('.add-to-board-btn').exists()).toBe(true);

      // kanbanEnabled=false
      wrapper = mountComponent({
        kanbanEnabled: false,
        isOnBoard: false,
        isChild: false,
      });
      expect(wrapper.find('.add-to-board-btn').exists()).toBe(false);

      // isOnBoard=true
      wrapper = mountComponent({
        kanbanEnabled: true,
        isOnBoard: true,
        isChild: false,
      });
      expect(wrapper.find('.add-to-board-btn').exists()).toBe(false);

      // isChild=true
      wrapper = mountComponent({
        kanbanEnabled: true,
        isOnBoard: false,
        isChild: true,
      });
      expect(wrapper.find('.add-to-board-btn').exists()).toBe(false);
    });
  });
});
