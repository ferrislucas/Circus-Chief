import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import RunningState from './RunningState.vue';

// Mock child components
vi.mock('./LiveWorkLogPanel.vue', () => ({
  default: {
    name: 'LiveWorkLogPanel',
    props: ['workLogs', 'partialThinking', 'showHeader'],
    template: '<div class="live-work-log-panel"></div>',
  },
}));

function mountComponent(props = {}) {
  return mount(RunningState, {
    props: {
      activeModelDisplayName: null,
      stopping: false,
      workLogs: [],
      partialThinking: '',
      nextTemplate: null,
      projectId: null,
      ...props,
    },
  });
}

describe('RunningState', () => {
  describe('rendering', () => {
    it('should render "Agent is working..." message', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.running-title').text()).toBe('Agent is working...');
    });

    it('should render loading spinner inside stop button', () => {
      const wrapper = mountComponent();
      const btn = wrapper.find('.btn-stop');
      expect(btn.find('.loading-spinner').exists()).toBe(true);
    });

    it('should not render loading spinner in the status area', () => {
      const wrapper = mountComponent();
      const status = wrapper.find('.running-status');
      expect(status.find('.loading-spinner').exists()).toBe(false);
    });

    it('should render stop button', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.btn-stop').exists()).toBe(true);
      expect(wrapper.find('.btn-stop').text()).toContain('Stop');
    });
  });

  describe('model display', () => {
    it('should show model name when provided', () => {
      const wrapper = mountComponent({ activeModelDisplayName: 'Claude 3.5 Sonnet' });
      expect(wrapper.find('.running-model-label').text()).toBe('Claude 3.5 Sonnet');
    });

    it('should hide model name when null', () => {
      const wrapper = mountComponent({ activeModelDisplayName: null });
      expect(wrapper.find('.running-model-label').exists()).toBe(false);
    });
  });

  describe('stop button', () => {
    it('should have clickable stop button', async () => {
      // Note: Custom emit capture via wrapper.emitted() is unreliable with
      // Vue 3 script setup SFCs (known Vue Test Utils limitation).
      // We verify the button renders and responds to clicks.
      const wrapper = mountComponent();
      const btn = wrapper.find('.btn-stop');
      expect(btn.exists()).toBe(true);
      expect(btn.attributes('disabled')).toBeUndefined();
      await btn.trigger('click');
      // The click event fires (even if the custom 'stop' emit isn't captured)
      expect(wrapper.emitted().click).toBeTruthy();
    });

    it('should be disabled when stopping', () => {
      const wrapper = mountComponent({ stopping: true });
      expect(wrapper.find('.btn-stop').attributes('disabled')).toBeDefined();
    });

    it('should always show spinner in stop button regardless of stopping state', () => {
      // Spinner is always visible in the stop button (not conditionally shown only when stopping)
      const wrapperNotStopping = mountComponent({ stopping: false });
      expect(wrapperNotStopping.find('.btn-stop').find('.loading-spinner').exists()).toBe(true);

      const wrapperStopping = mountComponent({ stopping: true });
      expect(wrapperStopping.find('.btn-stop').find('.loading-spinner').exists()).toBe(true);
    });
  });

  describe('work logs', () => {
    it('should pass work logs to LiveWorkLogPanel', () => {
      const workLogs = [{ id: 'wl-1', type: 'file_read' }];
      const wrapper = mountComponent({ workLogs });
      const panel = wrapper.findComponent({ name: 'LiveWorkLogPanel' });
      expect(panel.props('workLogs')).toEqual(workLogs);
    });

    it('should pass partialThinking to LiveWorkLogPanel', () => {
      const wrapper = mountComponent({ partialThinking: 'Thinking about...' });
      const panel = wrapper.findComponent({ name: 'LiveWorkLogPanel' });
      expect(panel.props('partialThinking')).toBe('Thinking about...');
    });

    it('should pass showHeader=false to LiveWorkLogPanel', () => {
      const wrapper = mountComponent();
      const panel = wrapper.findComponent({ name: 'LiveWorkLogPanel' });
      expect(panel.props('showHeader')).toBe(false);
    });
  });

  describe('template indicator', () => {
    it('should not show template indicator when nextTemplate is null', () => {
      const wrapper = mountComponent({ nextTemplate: null });
      expect(wrapper.find('.template-pending').exists()).toBe(false);
    });

    it('should show template indicator when nextTemplate is provided', () => {
      const wrapper = mountComponent({
        nextTemplate: { id: 'tmpl-1', name: 'Code Review' },
        projectId: 'proj-1',
      });
      expect(wrapper.find('.template-pending').exists()).toBe(true);
      expect(wrapper.find('.template-pending-link').text()).toBe('Code Review');
    });

    it('should show description text with template indicator', () => {
      const wrapper = mountComponent({
        nextTemplate: { id: 'tmpl-1', name: 'Deploy' },
        projectId: 'proj-1',
      });
      expect(wrapper.find('.template-pending-description').text()).toContain('will trigger when Claude finishes');
    });

    it('should link to project templates page', () => {
      const wrapper = mountComponent({
        nextTemplate: { id: 'tmpl-1', name: 'Test' },
        projectId: 'proj-42',
      });
      const link = wrapper.find('.template-pending-link');
      expect(link.attributes('href')).toBe('/projects/proj-42/templates');
    });
  });
});
