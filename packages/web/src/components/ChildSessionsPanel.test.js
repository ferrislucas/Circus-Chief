import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ChildSessionsPanel from './ChildSessionsPanel.vue';

// Mock the templates store
const mockTemplatesStore = {
  getTemplateById: vi.fn(),
};

vi.mock('../stores/templates.js', () => ({
  useTemplatesStore: () => mockTemplatesStore,
}));

// Mock router-link
const RouterLinkStub = {
  name: 'RouterLinkStub',
  props: ['to'],
  template: '<a :href="to"><slot /></a>',
  compatConfig: { MODE: 3 }, // Vue 3 compatibility
};

describe('ChildSessionsPanel', () => {
  let baseSessions;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup pinia
    const pinia = createPinia();
    setActivePinia(pinia);

    // Base session data
    baseSessions = [
      {
        id: 'child-1',
        name: 'Child Session 1',
        status: 'completed',
        createdAt: Date.now() - 3600000, // 1 hour ago
        nextTemplateId: null,
      },
      {
        id: 'child-2',
        name: 'Child Session 2',
        status: 'running',
        createdAt: Date.now() - 1800000, // 30 minutes ago
        nextTemplateId: null,
      },
    ];
  });

  function mountComponent(sessions = baseSessions, propsOverrides = {}) {
    return mount(ChildSessionsPanel, {
      props: {
        sessions,
        parentSessionId: 'parent-1',
        ...propsOverrides,
      },
      global: {
        components: {
          'router-link': RouterLinkStub,
        },
      },
    });
  }

  describe('rendering basics', () => {
    it('renders the panel with session count', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.child-sessions-panel').exists()).toBe(true);
      expect(wrapper.find('.panel-title').text()).toContain('Child Sessions (2)');
    });

    it('renders child session items', () => {
      const wrapper = mountComponent();
      const items = wrapper.findAll('.child-session-item');
      expect(items.length).toBe(2);
    });

    it('shows session names', () => {
      const wrapper = mountComponent();
      const names = wrapper.findAll('.child-session-name');
      expect(names[0].text()).toBe('Child Session 1');
      expect(names[1].text()).toBe('Child Session 2');
    });

    it('shows status badges', () => {
      const wrapper = mountComponent();
      const badges = wrapper.findAll('.status-badge');
      expect(badges.length).toBe(2);
      expect(badges[0].text()).toBe('completed');
      expect(badges[1].text()).toBe('running');
    });

    it('shows creation dates', () => {
      const wrapper = mountComponent();
      const dates = wrapper.findAll('.child-session-date');
      expect(dates.length).toBe(2);
      // Dates are formatted, just check they exist
      expect(dates[0].text()).toBeTruthy();
      expect(dates[1].text()).toBeTruthy();
    });

    it('displays "0" count when no sessions', () => {
      const wrapper = mountComponent([]);
      expect(wrapper.find('.panel-title').text()).toContain('Child Sessions (0)');
      expect(wrapper.findAll('.child-session-item').length).toBe(0);
    });
  });

  describe('next template display', () => {
    beforeEach(() => {
      mockTemplatesStore.getTemplateById.mockReturnValue({
        id: 'tpl-1',
        name: 'Review Template',
      });
    });

    it('does NOT show template indicator when nextTemplateId is null', () => {
      const wrapper = mountComponent([
        {
          id: 'child-1',
          name: 'Child Session 1',
          status: 'completed',
          createdAt: Date.now() - 3600000,
          nextTemplateId: null,
        },
      ]);

      expect(wrapper.find('.child-session-next-template').exists()).toBe(false);
    });

    it('shows template name when nextTemplateId is set and template exists', () => {
      const wrapper = mountComponent([
        {
          id: 'child-1',
          name: 'Child Session 1',
          status: 'completed',
          createdAt: Date.now() - 3600000,
          nextTemplateId: 'tpl-1',
        },
      ]);

      const nextEl = wrapper.find('.child-session-next-template');
      expect(nextEl.exists()).toBe(true);
      expect(nextEl.text()).toBe('→ Review Template');
    });

    it('calls templatesStore.getTemplateById with correct ID', () => {
      mountComponent([
        {
          id: 'child-1',
          name: 'Child Session 1',
          status: 'completed',
          createdAt: Date.now() - 3600000,
          nextTemplateId: 'tpl-1',
        },
      ]);

      expect(mockTemplatesStore.getTemplateById).toHaveBeenCalledWith('tpl-1');
    });

    it('does NOT show template indicator when template not found in store', () => {
      mockTemplatesStore.getTemplateById.mockReturnValue(undefined);

      const wrapper = mountComponent([
        {
          id: 'child-1',
          name: 'Child Session 1',
          status: 'completed',
          createdAt: Date.now() - 3600000,
          nextTemplateId: 'non-existent',
        },
      ]);

      expect(wrapper.find('.child-session-next-template').exists()).toBe(false);
    });

    it('handles template with null name gracefully', () => {
      mockTemplatesStore.getTemplateById.mockReturnValue({
        id: 'tpl-1',
        name: null,
      });

      const wrapper = mountComponent([
        {
          id: 'child-1',
          name: 'Child Session 1',
          status: 'completed',
          createdAt: Date.now() - 3600000,
          nextTemplateId: 'tpl-1',
        },
      ]);

      expect(wrapper.find('.child-session-next-template').exists()).toBe(false);
    });

    it('handles multiple sessions with different template states', () => {
      mockTemplatesStore.getTemplateById.mockImplementation((id) => {
        if (id === 'tpl-1') return { id: 'tpl-1', name: 'Review Template' };
        if (id === 'tpl-2') return { id: 'tpl-2', name: 'Test Template' };
        return undefined;
      });

      const wrapper = mountComponent([
        {
          id: 'child-1',
          name: 'Child Session 1',
          status: 'completed',
          createdAt: Date.now() - 3600000,
          nextTemplateId: 'tpl-1',
        },
        {
          id: 'child-2',
          name: 'Child Session 2',
          status: 'running',
          createdAt: Date.now() - 1800000,
          nextTemplateId: null, // No template
        },
        {
          id: 'child-3',
          name: 'Child Session 3',
          status: 'waiting',
          createdAt: Date.now() - 900000,
          nextTemplateId: 'tpl-2',
        },
      ]);

      const nextEls = wrapper.findAll('.child-session-next-template');
      expect(nextEls.length).toBe(2); // Only child-1 and child-3
      expect(nextEls[0].text()).toBe('→ Review Template');
      expect(nextEls[1].text()).toBe('→ Test Template');
    });
  });

  describe('expand/collapse behavior', () => {
    it('starts expanded by default', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.panel-content').exists()).toBe(true);
    });

    it('toggles when header is clicked', async () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.panel-content').exists()).toBe(true);

      await wrapper.find('.panel-header').trigger('click');
      expect(wrapper.find('.panel-content').exists()).toBe(false);

      await wrapper.find('.panel-header').trigger('click');
      expect(wrapper.find('.panel-content').exists()).toBe(true);
    });

    it('updates expand icon direction', async () => {
      const wrapper = mountComponent();

      expect(wrapper.find('.expand-icon').text()).toBe('▼');

      await wrapper.find('.panel-header').trigger('click');
      expect(wrapper.find('.expand-icon').text()).toBe('▶');

      await wrapper.find('.panel-header').trigger('click');
      expect(wrapper.find('.expand-icon').text()).toBe('▼');
    });
  });

  describe('status badge styling', () => {
    it('applies correct status class for completed status', () => {
      const wrapper = mountComponent([
        {
          id: 'child-1',
          name: 'Child Session 1',
          status: 'completed',
          createdAt: Date.now() - 3600000,
          nextTemplateId: null,
        },
      ]);

      const badge = wrapper.find('.status-badge');
      expect(badge.classes()).toContain('status-completed');
    });

    it('applies correct status class for running status', () => {
      const wrapper = mountComponent([
        {
          id: 'child-1',
          name: 'Child Session 1',
          status: 'running',
          createdAt: Date.now() - 3600000,
          nextTemplateId: null,
        },
      ]);

      const badge = wrapper.find('.status-badge');
      expect(badge.classes()).toContain('status-running');
    });

    it('applies correct status class for error status', () => {
      const wrapper = mountComponent([
        {
          id: 'child-1',
          name: 'Child Session 1',
          status: 'error',
          createdAt: Date.now() - 3600000,
          nextTemplateId: null,
        },
      ]);

      const badge = wrapper.find('.status-badge');
      expect(badge.classes()).toContain('status-error');
    });
  });

  describe('date formatting with lastActivityAt', () => {
    it('shows lastActivityAt when available', () => {
      const justNow = Date.now() - 1000; // 1 second ago
      const wrapper = mountComponent([
        {
          id: 'child-1',
          name: 'Child Session 1',
          status: 'completed',
          createdAt: Date.now() - 3600000, // 1 hour ago
          updatedAt: Date.now() - 2700000, // 45 minutes ago
          lastActivityAt: justNow, // 1 second ago (most recent)
          nextTemplateId: null,
        },
      ]);

      const dateText = wrapper.find('.child-session-date').text();
      // Should show "at HH:MM" format for recent activity
      expect(dateText).toMatch(/at \d{1,2}:\d{2}/);
    });

    it('falls back to updatedAt when lastActivityAt is not available', () => {
      const updatedTime = Date.now() - 1800000; // 30 minutes ago
      const wrapper = mountComponent([
        {
          id: 'child-1',
          name: 'Child Session 1',
          status: 'completed',
          createdAt: Date.now() - 3600000, // 1 hour ago
          updatedAt: updatedTime,
          lastActivityAt: null,
          nextTemplateId: null,
        },
      ]);

      const dateText = wrapper.find('.child-session-date').text();
      // Should show "at HH:MM" format
      expect(dateText).toMatch(/at \d{1,2}:\d{2}/);
    });

    it('falls back to createdAt when both lastActivityAt and updatedAt are not available', () => {
      const createdTime = Date.now() - 3600000; // 1 hour ago
      const wrapper = mountComponent([
        {
          id: 'child-1',
          name: 'Child Session 1',
          status: 'completed',
          createdAt: createdTime,
          updatedAt: createdTime,
          lastActivityAt: null,
          nextTemplateId: null,
        },
      ]);

      const dateText = wrapper.find('.child-session-date').text();
      // Should show "at HH:MM" format
      expect(dateText).toMatch(/at \d{1,2}:\d{2}/);
    });

    it('shows date for sessions with activity yesterday or earlier', () => {
      const yesterday = Date.now() - 86400000 * 2; // 2 days ago
      const wrapper = mountComponent([
        {
          id: 'child-1',
          name: 'Child Session 1',
          status: 'completed',
          createdAt: yesterday,
          lastActivityAt: yesterday,
          nextTemplateId: null,
        },
      ]);

      const dateText = wrapper.find('.child-session-date').text();
      // Should show "MMM D" format (e.g., "Jan 30")
      expect(dateText).toMatch(/[A-Z][a-z]{2} \d{1,2}/);
    });

    it('returns empty string when all timestamps are null', () => {
      const wrapper = mountComponent([
        {
          id: 'child-1',
          name: 'Child Session 1',
          status: 'completed',
          createdAt: null,
          updatedAt: null,
          lastActivityAt: null,
          nextTemplateId: null,
        },
      ]);

      const dateText = wrapper.find('.child-session-date').text();
      expect(dateText).toBe('');
    });
  });

  describe('navigation links', () => {
    it('generates correct router-link URLs', () => {
      const wrapper = mountComponent();
      const links = wrapper.findAllComponents(RouterLinkStub);

      expect(links.length).toBe(2);
      expect(links[0].props('to')).toBe('/sessions/child-1/conversation');
      expect(links[1].props('to')).toBe('/sessions/child-2/conversation');
    });
  });
});
