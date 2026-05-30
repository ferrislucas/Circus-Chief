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
    await router.push('/sessions/session-1/summary');
    await router.isReady();
  });

  const defaultTabs = [
    { id: 'summary', label: 'Summary' },
    { id: 'changes', label: 'Changes' },
    { id: 'canvas', label: 'Canvas' },
    { id: 'commands', label: 'Commands' },
    { id: 'circus-time', label: 'Circus Time' },
    { id: 'chat', label: 'Chat', desktopOnly: true },
  ];

  function mountPanel(props = {}) {
    return mount(SessionTabsPanel, {
      global: { plugins: [router] },
      props: {
        sessionId: 'session-1',
        projectId: 'proj-1',
        activeTab: 'summary',
        tabs: defaultTabs,
        hasChanges: false,
        canvasCount: 0,
        ...props,
      },
    });
  }

  describe('tab rendering', () => {
    it('renders all tab labels', () => {
      const wrapper = mountPanel();
      const text = wrapper.text();
      expect(text).toContain('Summary');
      expect(text).toContain('Changes');
      expect(text).toContain('Canvas');
      expect(text).toContain('Commands');
      expect(text).toContain('Circus Time');
      expect(text).toContain('Chat');
    });

    it('renders back link with icon to sessions list', () => {
      const wrapper = mountPanel();
      const backLink = wrapper.find('.tab-back');
      expect(backLink.exists()).toBe(true);
      expect(backLink.attributes('href')).toBe('/projects/proj-1/sessions');
      // Verify icon is rendered instead of text
      expect(backLink.find('.back-icon').exists()).toBe(true);
      expect(backLink.findAll('svg').length).toBe(2);
      expect(backLink.attributes('title')).toBe('Back to Sessions');
    });

    it('renders desktop tabs', () => {
      const wrapper = mountPanel();
      expect(wrapper.find('.tabs-desktop').exists()).toBe(true);
    });

    it('renders mobile dropdown', () => {
      const wrapper = mountPanel();
      expect(wrapper.find('.tabs-mobile').exists()).toBe(true);
    });

    it('renders mobile select without desktop-only tabs', () => {
      const wrapper = mountPanel();
      const options = wrapper.findAll('.tab-select option');
      expect(options.length).toBe(5);
      expect(options.map(option => option.text())).toEqual([
        'Summary',
        'Changes',
        'Canvas',
        'Commands',
        'Circus Time',
      ]);
    });

    it('renders desktop chat tab', () => {
      const wrapper = mountPanel();
      const desktopTabs = wrapper.findAll('.tabs-desktop .tab');
      expect(desktopTabs.length).toBe(6);
      const chatTab = desktopTabs.find(tab => tab.text() === 'Chat');
      expect(chatTab).toBeDefined();
      expect(chatTab.attributes('href')).toBe('/sessions/session-1/chat');
    });

    it('applies the session-detail layout marker class', () => {
      const wrapper = mountPanel();
      expect(wrapper.find('.tabs.tabs-session-detail').exists()).toBe(true);
    });

    it('nests tabs-desktop inside the session-detail container', () => {
      const wrapper = mountPanel();
      expect(wrapper.find('.tabs-session-detail .tabs-desktop').exists()).toBe(true);
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

    it('shows dot indicator for canvas items in mobile', () => {
      const wrapper = mountPanel({ canvasCount: 2 });
      const option = wrapper.findAll('.tab-select option').find(o => o.text().includes('Canvas'));
      expect(option.text()).toContain('\u2022');
    });

    it('navigates when mobile select changes', async () => {
      const pushSpy = vi.spyOn(router, 'push');
      const wrapper = mountPanel();
      const select = wrapper.find('.tab-select');
      await select.setValue('circus-time');
      expect(pushSpy).toHaveBeenCalledWith('/sessions/session-1/circus-time');
    });

    it('does not expose the desktop-only chat tab as a mobile option', () => {
      const wrapper = mountPanel();
      const options = wrapper.findAll('.tab-select option');
      expect(options.some(option => option.attributes('value') === 'chat')).toBe(false);
      expect(options.some(option => option.text() === 'Chat')).toBe(false);
    });
  });

  describe('active tab', () => {
    it('marks active tab with active class', () => {
      const wrapper = mountPanel({ activeTab: 'summary' });
      const desktopTabs = wrapper.findAll('.tabs-desktop .tab');
      const activeTab = desktopTabs.find(t => t.classes().includes('active'));
      expect(activeTab).toBeDefined();
    });
  });
});
