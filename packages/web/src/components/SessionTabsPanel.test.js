import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import SessionTabsPanel from './SessionTabsPanel.vue';

describe('SessionTabsPanel', () => {
  let router;

  beforeEach(async () => {
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/sessions/:id/:tab?', component: { template: '<div />' } },
        { path: '/projects/:id/sessions', component: { template: '<div />' } },
      ],
    });
    await router.push('/sessions/session-1/conversation');
    await router.isReady();
  });

  const defaultTabs = [
    { id: 'summary', label: 'Summary' },
    { id: 'conversation', label: 'Conversations' },
    { id: 'changes', label: 'Changes' },
    { id: 'canvas', label: 'Canvas' },
    { id: 'commands', label: 'Commands' },
  ];

  function mountPanel(props = {}) {
    return mount(SessionTabsPanel, {
      global: { plugins: [router] },
      props: {
        sessionId: 'session-1',
        projectId: 'proj-1',
        activeTab: 'conversation',
        tabs: defaultTabs,
        hasChanges: false,
        canvasCount: 0,
        changesFileCount: 0,
        isSessionActive: false,
        sessionStatus: '',
        ...props,
      },
    });
  }

  describe('tab rendering', () => {
    it('renders all tab labels', () => {
      const wrapper = mountPanel();
      const text = wrapper.text();
      expect(text).toContain('Summary');
      expect(text).toContain('Conversations');
      expect(text).toContain('Changes');
      expect(text).toContain('Canvas');
      expect(text).toContain('Commands');
    });

    it('renders back link to sessions list', () => {
      const wrapper = mountPanel();
      const backLink = wrapper.find('.tab-back');
      expect(backLink.exists()).toBe(true);
      expect(backLink.attributes('href')).toBe('/projects/proj-1/sessions');
    });

    it('renders desktop tabs', () => {
      const wrapper = mountPanel();
      expect(wrapper.find('.tabs-desktop').exists()).toBe(true);
    });

    it('renders mobile dropdown', () => {
      const wrapper = mountPanel();
      expect(wrapper.find('.tabs-mobile').exists()).toBe(true);
    });

    it('renders mobile select with all options', () => {
      const wrapper = mountPanel();
      const options = wrapper.findAll('.tab-select option');
      expect(options.length).toBe(5);
    });
  });

  describe('changes indicator', () => {
    it('shows changes indicator when hasChanges is true', () => {
      const wrapper = mountPanel({ hasChanges: true });
      expect(wrapper.find('.changes-indicator').exists()).toBe(true);
    });

    it('hides changes indicator when hasChanges is false', () => {
      const wrapper = mountPanel({ hasChanges: false });
      expect(wrapper.find('.changes-indicator').exists()).toBe(false);
    });
  });

  describe('canvas indicator', () => {
    it('shows canvas indicator when canvasCount > 0', () => {
      const wrapper = mountPanel({ canvasCount: 3 });
      expect(wrapper.find('.canvas-indicator').exists()).toBe(true);
    });

    it('hides canvas indicator when canvasCount is 0', () => {
      const wrapper = mountPanel({ canvasCount: 0 });
      expect(wrapper.find('.canvas-indicator').exists()).toBe(false);
    });
  });

  describe('mobile dropdown', () => {
    it('shows dot indicator for changes in mobile', () => {
      const wrapper = mountPanel({ hasChanges: true });
      const option = wrapper.findAll('.tab-select option').find(o => o.text().includes('Changes'));
      expect(option.text()).toContain('\u2022');
    });

    it('shows canvas count in mobile option when canvasCount > 0', () => {
      const wrapper = mountPanel({ canvasCount: 2 });
      const option = wrapper.findAll('.tab-select option').find(o => o.text().includes('Canvas'));
      expect(option.text()).toContain('(2)');
    });

    it('navigates when mobile select changes', async () => {
      const pushSpy = vi.spyOn(router, 'push');
      const wrapper = mountPanel();
      const select = wrapper.find('.tab-select');
      await select.setValue('canvas');
      expect(pushSpy).toHaveBeenCalledWith('/sessions/session-1/canvas');
    });
  });

  describe('counts display', () => {
    it('always renders all 5 options in mobile select regardless of canvas/changes counts', () => {
      const wrapper = mountPanel({ canvasCount: 5, changesFileCount: 3, hasChanges: true });
      const options = wrapper.findAll('.tab-select option');
      expect(options.length).toBe(5);
      expect(options.map(o => o.attributes('value'))).toEqual([
        'summary', 'conversation', 'changes', 'canvas', 'commands'
      ]);
    });

    it('shows changes file count in mobile option text when changesFileCount > 0', () => {
      const wrapper = mountPanel({ changesFileCount: 3, hasChanges: true });
      const option = wrapper.findAll('.tab-select option').find(o => o.attributes('value') === 'changes');
      expect(option.text()).toContain('(3)');
    });

    it('shows canvas count in mobile option text when canvasCount > 0', () => {
      const wrapper = mountPanel({ canvasCount: 7 });
      const option = wrapper.findAll('.tab-select option').find(o => o.attributes('value') === 'canvas');
      expect(option.text()).toContain('(7)');
    });

    it('shows changes file count in desktop tab label when changesFileCount > 0', () => {
      const wrapper = mountPanel({ changesFileCount: 4 });
      const desktopTabs = wrapper.findAll('.tabs-desktop .tab');
      const changesTab = desktopTabs.find(t => t.text().includes('Changes'));
      expect(changesTab.text()).toContain('(4)');
    });

    it('shows canvas count in desktop tab label when canvasCount > 0', () => {
      const wrapper = mountPanel({ canvasCount: 2 });
      const desktopTabs = wrapper.findAll('.tabs-desktop .tab');
      const canvasTab = desktopTabs.find(t => t.text().includes('Canvas'));
      expect(canvasTab.text()).toContain('(2)');
    });

    it('does not show counts when changesFileCount and canvasCount are 0', () => {
      const wrapper = mountPanel({ changesFileCount: 0, canvasCount: 0 });
      const options = wrapper.findAll('.tab-select option');
      const changesOption = options.find(o => o.attributes('value') === 'changes');
      const canvasOption = options.find(o => o.attributes('value') === 'canvas');
      expect(changesOption.text()).toBe('Changes');
      expect(canvasOption.text()).toBe('Canvas');
    });

    it('shows dot indicator for changes in mobile alongside count', () => {
      const wrapper = mountPanel({ hasChanges: true, changesFileCount: 2 });
      const option = wrapper.findAll('.tab-select option').find(o => o.attributes('value') === 'changes');
      expect(option.text()).toContain('(2)');
      expect(option.text()).toContain('\u2022');
    });
  });

  describe('active tab', () => {
    it('marks active tab with active class', () => {
      const wrapper = mountPanel({ activeTab: 'conversation' });
      const desktopTabs = wrapper.findAll('.tabs-desktop .tab');
      const activeTab = desktopTabs.find(t => t.classes().includes('active'));
      expect(activeTab).toBeDefined();
    });
  });
});
