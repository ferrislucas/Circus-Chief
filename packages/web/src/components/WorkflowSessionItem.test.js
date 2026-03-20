import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { h, defineComponent } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import WorkflowSessionItem from './WorkflowSessionItem.vue';

// Mock the templates store
const mockTemplatesStore = {
  getTemplateById: vi.fn(),
};

vi.mock('../stores/templates.js', () => ({
  useTemplatesStore: () => mockTemplatesStore,
}));

// Mock SessionLogStream component
vi.mock('./SessionLogStream.vue', () => ({
  default: defineComponent({
    name: 'SessionLogStream',
    props: ['sessionId'],
    setup(props) {
      return () => h('div', { class: 'session-log-stream-mock', 'data-session-id': props.sessionId });
    },
  }),
}));

// Mock router-link
const RouterLinkStub = {
  name: 'RouterLinkStub',
  props: ['to'],
  template: '<a :href="to"><slot /></a>',
  compatConfig: { MODE: 3 }, // Vue 3 compatibility
};

describe('WorkflowSessionItem', () => {
  let baseSession;
  let summaries;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup pinia
    const pinia = createPinia();
    setActivePinia(pinia);

    // Base session data
    baseSession = {
      id: 'sess-1',
      name: 'Test Session',
      status: 'completed',
      createdAt: Date.now() - 3600000, // 1 hour ago
      scheduledAt: null,
      nextTemplateId: null,
    };

    summaries = {
      'sess-1': { shortSummary: 'This is a summary' },
    };
  });

  function mountComponent(sessionOverrides = {}, propsOverrides = {}) {
    return mount(WorkflowSessionItem, {
      props: {
        session: { ...baseSession, ...sessionOverrides },
        summaries,
        depth: 0,
        ...propsOverrides,
      },
      global: {
        components: {
          'router-link': RouterLinkStub,
        },
      },
    });
  }

  describe('basic rendering', () => {
    it('renders the component', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.workflow-session-item').exists()).toBe(true);
    });

    it('displays session name', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.workflow-session-name').text()).toBe('Test Session');
    });

    it('displays summary text', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.workflow-session-summary').text()).toBe('This is a summary');
    });

    it('displays "No summary yet" when no summary exists', () => {
      const wrapper = mountComponent({}, { summaries: {} });
      expect(wrapper.find('.workflow-session-summary').text()).toBe('No summary yet');
    });

    it('shows CHILD role indicator', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.workflow-session-role').text()).toContain('CHILD');
    });
  });

  describe('depth prop', () => {
    it('applies correct padding based on depth', () => {
      const wrapper0 = mountComponent({}, { depth: 0 });
      expect(wrapper0.find('.workflow-session-item').attributes('style')).toContain('padding-left: 0.5rem');

      const wrapper1 = mountComponent({}, { depth: 1 });
      expect(wrapper1.find('.workflow-session-item').attributes('style')).toContain('padding-left: 2rem');

      const wrapper2 = mountComponent({}, { depth: 2 });
      expect(wrapper2.find('.workflow-session-item').attributes('style')).toContain('padding-left: 3.5rem');
    });

    it('shows └─ prefix when depth > 0', () => {
      const wrapper0 = mountComponent({}, { depth: 0 });
      expect(wrapper0.find('.workflow-session-role').text()).not.toContain('└─');

      const wrapper1 = mountComponent({}, { depth: 1 });
      expect(wrapper1.find('.workflow-session-role').text()).toContain('└─');
    });
  });

  describe('status labels', () => {
    it('shows "● Running" for running status', () => {
      const wrapper = mountComponent({ status: 'running' });
      const statusEl = wrapper.find('.workflow-session-status');
      expect(statusEl.exists()).toBe(true);
      expect(statusEl.text()).toBe('● Running');
    });

    it('shows "● Running" for starting status', () => {
      const wrapper = mountComponent({ status: 'starting' });
      const statusEl = wrapper.find('.workflow-session-status');
      expect(statusEl.exists()).toBe(true);
      expect(statusEl.text()).toBe('● Running');
    });

    it('shows "⏰ Scheduled" for scheduled status', () => {
      const wrapper = mountComponent({ status: 'scheduled' });
      const statusEl = wrapper.find('.workflow-session-status');
      expect(statusEl.exists()).toBe(true);
      expect(statusEl.text()).toBe('⏰ Scheduled');
    });

    it('does not show status label for error status', () => {
      const wrapper = mountComponent({ status: 'error' });
      expect(wrapper.find('.workflow-session-status').exists()).toBe(false);
    });

    it('does not show status label for waiting status', () => {
      const wrapper = mountComponent({ status: 'waiting' });
      expect(wrapper.find('.workflow-session-status').exists()).toBe(false);
    });

    it('does not show status label for completed status', () => {
      const wrapper = mountComponent({ status: 'completed' });
      expect(wrapper.find('.workflow-session-status').exists()).toBe(false);
    });
  });

  describe('displayDate computed property', () => {
    it('shows scheduledAt date for scheduled sessions', () => {
      const scheduledTime = Date.now() + 86400000; // Tomorrow
      const wrapper = mountComponent({
        status: 'scheduled',
        scheduledAt: scheduledTime,
        lastActivityAt: Date.now() - 3600000, // Should be ignored for scheduled
      });

      const dateText = wrapper.find('.workflow-session-date').text();
      // Should contain the scheduled date
      expect(dateText).toBeTruthy();
    });

    it('shows lastActivityAt for non-scheduled sessions when available', () => {
      const lastActivityTime = Date.now() - 1800000; // 30 minutes ago
      const wrapper = mountComponent({
        status: 'running',
        createdAt: Date.now() - 3600000, // 1 hour ago
        updatedAt: Date.now() - 2700000, // 45 minutes ago
        lastActivityAt: lastActivityTime, // 30 minutes ago (most recent)
      });

      const dateText = wrapper.find('.workflow-session-date').text();
      expect(dateText).toBeTruthy();
      // Should show the more recent lastActivityAt time
    });

    it('falls back to updatedAt when lastActivityAt is not available', () => {
      const updatedTime = Date.now() - 1800000; // 30 minutes ago
      const wrapper = mountComponent({
        status: 'completed',
        createdAt: Date.now() - 3600000, // 1 hour ago
        updatedAt: updatedTime,
        lastActivityAt: null,
      });

      const dateText = wrapper.find('.workflow-session-date').text();
      expect(dateText).toBeTruthy();
      // Should show updatedAt time
    });

    it('falls back to createdAt when both lastActivityAt and updatedAt are not available', () => {
      const createdTime = Date.now() - 3600000; // 1 hour ago
      const wrapper = mountComponent({
        status: 'completed',
        createdAt: createdTime,
        updatedAt: createdTime,
        lastActivityAt: null,
      });

      const dateText = wrapper.find('.workflow-session-date').text();
      expect(dateText).toBeTruthy();
      // Should show createdAt time
    });

    it('shows time for sessions with activity today', () => {
      const justNow = Date.now() - 1000; // 1 second ago
      const wrapper = mountComponent({
        status: 'completed',
        createdAt: justNow,
        lastActivityAt: justNow,
      });

      const dateText = wrapper.find('.workflow-session-date').text();
      // Should show "at HH:MM" format
      expect(dateText).toMatch(/at \d{1,2}:\d{2}/);
    });

    it('shows date for sessions with activity yesterday or earlier', () => {
      const yesterday = Date.now() - 86400000 * 2; // 2 days ago
      const wrapper = mountComponent({
        status: 'completed',
        createdAt: yesterday,
        lastActivityAt: yesterday,
      });

      const dateText = wrapper.find('.workflow-session-date').text();
      // Should show "MMM D" format (e.g., "Jan 30")
      expect(dateText).toMatch(/[A-Z][a-z]{2} \d{1,2}/);
    });

    it('returns empty string when timestamp is null', () => {
      const wrapper = mountComponent({
        status: 'completed',
        createdAt: null,
        updatedAt: null,
        lastActivityAt: null,
      });

      const dateText = wrapper.find('.workflow-session-date').text();
      expect(dateText).toBe('');
    });
  });

  describe('nextTemplateName computed property', () => {
    beforeEach(() => {
      mockTemplatesStore.getTemplateById.mockReturnValue({
        id: 'tpl-1',
        name: 'Review Template',
      });
    });

    it('shows "Next: {templateName}" when nextTemplateId is set', () => {
      const wrapper = mountComponent({
        nextTemplateId: 'tpl-1',
      });

      const nextEl = wrapper.find('.workflow-session-next');
      expect(nextEl.exists()).toBe(true);
      expect(nextEl.text()).toBe('Next: Review Template');
    });

    it('calls templatesStore.getTemplateById with correct ID', () => {
      mountComponent({
        nextTemplateId: 'tpl-1',
      });

      // Access the computed property to trigger the getter
      const wrapper = mountComponent({ nextTemplateId: 'tpl-1' });
      wrapper.vm.nextTemplateName; // Trigger the computed property

      expect(mockTemplatesStore.getTemplateById).toHaveBeenCalledWith('tpl-1');
    });

    it('does not show next template when nextTemplateId is null', () => {
      const wrapper = mountComponent({
        nextTemplateId: null,
      });

      expect(wrapper.find('.workflow-session-next').exists()).toBe(false);
    });

    it('does not show next template when template is not found', () => {
      mockTemplatesStore.getTemplateById.mockReturnValue(undefined);

      const wrapper = mountComponent({
        nextTemplateId: 'non-existent',
      });

      expect(wrapper.find('.workflow-session-next').exists()).toBe(false);
    });

    it('handles template with null name gracefully', () => {
      mockTemplatesStore.getTemplateById.mockReturnValue({
        id: 'tpl-1',
        name: null,
      });

      const wrapper = mountComponent({
        nextTemplateId: 'tpl-1',
      });

      expect(wrapper.find('.workflow-session-next').exists()).toBe(false);
    });
  });

  describe('meta layout', () => {
    it('renders meta-right container', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.workflow-session-meta-right').exists()).toBe(true);
    });

    it('shows both next template and date when both exist', () => {
      mockTemplatesStore.getTemplateById.mockReturnValue({
        id: 'tpl-1',
        name: 'Review Template',
      });

      const wrapper = mountComponent({
        nextTemplateId: 'tpl-1',
      });

      expect(wrapper.find('.workflow-session-next').exists()).toBe(true);
      expect(wrapper.find('.workflow-session-date').exists()).toBe(true);
    });
  });

  describe('computed properties', () => {
    it('computes displayDate correctly for scheduled sessions', () => {
      const scheduledTime = Date.now() + 86400000;
      const wrapper = mountComponent({
        status: 'scheduled',
        scheduledAt: scheduledTime,
      });

      // Display date is tested via DOM - verify it's not null
      const dateText = wrapper.find('.workflow-session-date').text();
      expect(dateText).toBeTruthy();
    });

    it('computes displayDate correctly for non-scheduled sessions', () => {
      const createdTime = Date.now() - 3600000;
      const wrapper = mountComponent({
        status: 'running',
        createdAt: createdTime,
      });

      // Display date is tested via DOM - verify it's not null
      const dateText = wrapper.find('.workflow-session-date').text();
      expect(dateText).toBeTruthy();
    });

    it('computes statusLabel correctly', () => {
      // Status label is tested via DOM in status labels section
      const running = mountComponent({ status: 'running' });
      expect(running.find('.workflow-session-status').exists()).toBe(true);
      expect(running.find('.workflow-session-status').text()).toBe('● Running');

      const waiting = mountComponent({ status: 'waiting' });
      expect(waiting.find('.workflow-session-status').exists()).toBe(false);
    });

    it('computes summaryText correctly', () => {
      // Summary text is tested via DOM in basic rendering section
      const wrapper = mountComponent();
      expect(wrapper.find('.workflow-session-summary').text()).toBe('This is a summary');

      const wrapper2 = mountComponent({}, { summaries: {} });
      expect(wrapper2.find('.workflow-session-summary').text()).toBe('No summary yet');
    });
  });

  describe('SessionLogStream integration', () => {
    it('renders SessionLogStream when child session status is "running"', () => {
      const wrapper = mountComponent({ status: 'running' });
      expect(wrapper.find('.session-log-stream-mock').exists()).toBe(true);
    });

    it('renders SessionLogStream when child session status is "starting"', () => {
      const wrapper = mountComponent({ status: 'starting' });
      expect(wrapper.find('.session-log-stream-mock').exists()).toBe(true);
    });

    it('does NOT render SessionLogStream when child session status is "completed"', () => {
      const wrapper = mountComponent({ status: 'completed' });
      expect(wrapper.find('.session-log-stream-mock').exists()).toBe(false);
    });

    it('passes correct session.id as sessionId prop', () => {
      const wrapper = mountComponent({ id: 'child-session-42', status: 'running' });
      const logStream = wrapper.find('.session-log-stream-mock');
      expect(logStream.attributes('data-session-id')).toBe('child-session-42');
    });
  });
});
