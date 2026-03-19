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

  describe('session active indicator', () => {
    it('shows active spinner when isSessionActive is true', () => {
      const wrapper = mountPanel({ isSessionActive: true, sessionStatus: 'running' });
      expect(wrapper.find('.session-active-indicator').exists()).toBe(true);
      expect(wrapper.find('.active-spinner').exists()).toBe(true);
    });

    it('hides active spinner when isSessionActive is false', () => {
      const wrapper = mountPanel({ isSessionActive: false, sessionStatus: 'completed' });
      expect(wrapper.find('.session-active-indicator').exists()).toBe(false);
    });

    it('shows "Session running..." tooltip when status is running', () => {
      const wrapper = mountPanel({ isSessionActive: true, sessionStatus: 'running' });
      const indicator = wrapper.find('.session-active-indicator');
      expect(indicator.attributes('title')).toBe('Session running...');
    });

    it('shows "Session starting..." tooltip when status is starting', () => {
      const wrapper = mountPanel({ isSessionActive: true, sessionStatus: 'starting' });
      const indicator = wrapper.find('.session-active-indicator');
      expect(indicator.attributes('title')).toBe('Session starting...');
    });
  });

  describe('mobile dropdown', () => {
    it('shows dot indicator for changes in mobile', () => {
      const wrapper = mountPanel({ hasChanges: true });
      const option = wrapper.findAll('.tab-select option').find(o => o.text().includes('Changes'));
      expect(option.text()).toContain('\u2022');
    });

    it('shows dot indicator for canvas items in mobile', () => {
      const wrapper = mountPanel({ canvasCount: 2 });
      const option = wrapper.findAll('.tab-select option').find(o => o.text().includes('Canvas'));
      expect(option.text()).toContain('\u2022');
    });

    it('shows ellipsis for active session in mobile', () => {
      const wrapper = mountPanel({ isSessionActive: true });
      const option = wrapper.findAll('.tab-select option').find(o => o.text().includes('Conversations'));
      expect(option.text()).toContain('...');
    });

    it('shows loading spinner when isSessionActive is true in mobile', () => {
      const wrapper = mountPanel({ isSessionActive: true });
      expect(wrapper.find('.tabs-mobile .loading-spinner').exists()).toBe(true);
    });

    it('hides loading spinner when isSessionActive is false in mobile', () => {
      const wrapper = mountPanel({ isSessionActive: false });
      expect(wrapper.find('.tabs-mobile .loading-spinner').exists()).toBe(false);
    });

    it('shows "Session running..." tooltip when status is running', () => {
      const wrapper = mountPanel({ isSessionActive: true, sessionStatus: 'running' });
      const spinner = wrapper.find('.tabs-mobile .loading-spinner');
      expect(spinner.attributes('title')).toBe('Session running...');
    });

    it('shows "Session starting..." tooltip when status is starting', () => {
      const wrapper = mountPanel({ isSessionActive: true, sessionStatus: 'starting' });
      const spinner = wrapper.find('.tabs-mobile .loading-spinner');
      expect(spinner.attributes('title')).toBe('Session starting...');
    });

    it('navigates when mobile select changes', async () => {
      const pushSpy = vi.spyOn(router, 'push');
      const wrapper = mountPanel();
      const select = wrapper.find('.tab-select');
      await select.setValue('canvas');
      expect(pushSpy).toHaveBeenCalledWith('/sessions/session-1/canvas');
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
