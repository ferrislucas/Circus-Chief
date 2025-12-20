import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { h, defineComponent } from 'vue';
import SessionCard from './SessionCard.vue';

// Custom RouterLink stub that renders slot content
const RouterLinkStub = defineComponent({
  name: 'RouterLink',
  props: ['to'],
  setup(props, { slots }) {
    return () => h('a', { href: props.to, class: 'router-link-stub' }, slots.default?.());
  },
});

describe('SessionCard', () => {
  const baseSession = {
    id: 'session-123',
    name: 'Test Session',
    status: 'running',
    mode: 'code',
    createdAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-01-15T11:45:00Z',
  };

  function mountComponent(props = {}) {
    return mount(SessionCard, {
      props: {
        session: baseSession,
        ...props,
      },
      global: {
        components: {
          RouterLink: RouterLinkStub,
        },
      },
    });
  }

  describe('basic rendering', () => {
    it('renders session name', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.session-name').text()).toBe('Test Session');
    });

    it('renders session status badge', () => {
      const wrapper = mountComponent();
      const badge = wrapper.find('.status-badge');
      expect(badge.text()).toBe('running');
      expect(badge.classes()).toContain('status-running');
    });

    it('renders session mode', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.session-mode').text()).toBe('code');
    });

    it('links to session detail page', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.router-link-stub').attributes('href')).toBe('/sessions/session-123');
    });

    it('renders formatted date', () => {
      const wrapper = mountComponent();
      const dateText = wrapper.find('.session-date').text();
      expect(dateText).toMatch(/Jan/);
      expect(dateText).toMatch(/15/);
      expect(dateText).toMatch(/2024/);
    });
  });

  describe('git branch display', () => {
    it('shows git branch when present', () => {
      const wrapper = mountComponent({
        session: { ...baseSession, gitBranch: 'feature/test' },
      });
      expect(wrapper.find('.session-branch').text()).toBe('feature/test');
    });

    it('hides git branch when not present', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.session-branch').exists()).toBe(false);
    });
  });

  describe('PR link display', () => {
    it('shows PR link when prUrl is present', () => {
      const wrapper = mountComponent({
        session: { ...baseSession, prUrl: 'https://github.com/org/repo/pull/123' },
      });
      const prLink = wrapper.find('.pr-link');
      expect(prLink.exists()).toBe(true);
      expect(prLink.attributes('href')).toBe('https://github.com/org/repo/pull/123');
      expect(prLink.attributes('target')).toBe('_blank');
    });

    it('hides PR link when prUrl is not present', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.pr-link').exists()).toBe(false);
    });

    it('displays PR number extracted from URL', () => {
      const wrapper = mountComponent({
        session: { ...baseSession, prUrl: 'https://github.com/org/repo/pull/456' },
      });
      const prLink = wrapper.find('.pr-link');
      expect(prLink.text()).toContain('PR 456');
    });

    it('displays PR number for different PR numbers', () => {
      const wrapper = mountComponent({
        session: { ...baseSession, prUrl: 'https://github.com/org/repo/pull/1' },
      });
      expect(wrapper.find('.pr-link').text()).toContain('PR 1');
    });

    it('displays PR number for large PR numbers', () => {
      const wrapper = mountComponent({
        session: { ...baseSession, prUrl: 'https://github.com/org/repo/pull/99999' },
      });
      expect(wrapper.find('.pr-link').text()).toContain('PR 99999');
    });

    it('displays "PR" when URL does not contain PR number pattern', () => {
      const wrapper = mountComponent({
        session: { ...baseSession, prUrl: 'https://github.com/org/repo/issues/123' },
      });
      expect(wrapper.find('.pr-link').text()).toContain('PR');
      expect(wrapper.find('.pr-link').text()).not.toContain('123');
    });
  });

  describe('project name display', () => {
    it('shows project name when showProject is true', () => {
      const wrapper = mountComponent({
        session: { ...baseSession, projectName: 'My Project' },
        showProject: true,
      });
      expect(wrapper.find('.project-name').text()).toBe('My Project');
    });

    it('hides project name when showProject is false', () => {
      const wrapper = mountComponent({
        session: { ...baseSession, projectName: 'My Project' },
        showProject: false,
      });
      expect(wrapper.find('.session-project').exists()).toBe(false);
    });

    it('hides project name section when project name is not present', () => {
      const wrapper = mountComponent({
        showProject: true,
      });
      expect(wrapper.find('.session-project').exists()).toBe(false);
    });
  });

  describe('date display logic', () => {
    it('shows createdAt when showProject is false (project view)', () => {
      const wrapper = mountComponent({
        session: {
          ...baseSession,
          createdAt: '2024-01-10T09:00:00Z',
          updatedAt: '2024-01-15T14:00:00Z',
        },
        showProject: false,
      });
      const dateText = wrapper.find('.session-date').text();
      expect(dateText).toMatch(/Jan.*10.*2024/);
    });

    it('shows updatedAt when showProject is true (active sessions view)', () => {
      const wrapper = mountComponent({
        session: {
          ...baseSession,
          createdAt: '2024-01-10T09:00:00Z',
          updatedAt: '2024-01-15T14:00:00Z',
        },
        showProject: true,
      });
      const dateText = wrapper.find('.session-date').text();
      expect(dateText).toMatch(/Jan.*15.*2024/);
    });
  });

  describe('summary display', () => {
    const testSummary = {
      shortSummary: 'Implemented new feature',
      filesModified: ['src/app.js', 'src/utils.js'],
    };

    it('shows summary when showSummary is true and summary is provided', () => {
      const wrapper = mountComponent({
        showSummary: true,
        summary: testSummary,
      });
      expect(wrapper.find('.summary-text').text()).toBe('Implemented new feature');
      expect(wrapper.find('.summary-files').text()).toBe('2 files modified');
    });

    it('hides summary section when showSummary is false', () => {
      const wrapper = mountComponent({
        showSummary: false,
        summary: testSummary,
      });
      expect(wrapper.find('.session-summary').exists()).toBe(false);
    });

    it('shows loading state when summaryLoading is true', () => {
      const wrapper = mountComponent({
        showSummary: true,
        summaryLoading: true,
      });
      expect(wrapper.find('.session-summary-loading').exists()).toBe(true);
      expect(wrapper.find('.loading-spinner-small').exists()).toBe(true);
      expect(wrapper.text()).toContain('Loading summary...');
    });

    it('shows error state when summaryError is true', () => {
      const wrapper = mountComponent({
        showSummary: true,
        summaryError: true,
      });
      expect(wrapper.find('.session-summary-error').exists()).toBe(true);
      expect(wrapper.find('.error-icon').exists()).toBe(true);
      expect(wrapper.text()).toContain('Summary unavailable');
    });

    it('shows retry button on error', () => {
      const wrapper = mountComponent({
        showSummary: true,
        summaryError: true,
      });
      expect(wrapper.find('.retry-btn').exists()).toBe(true);
      expect(wrapper.find('.retry-btn').text()).toBe('Retry');
    });

    it('retry button is clickable', async () => {
      const wrapper = mountComponent({
        showSummary: true,
        summaryError: true,
      });
      const btn = wrapper.find('.retry-btn');
      expect(btn.exists()).toBe(true);
      // Verify button can be clicked without errors
      await btn.trigger('click');
      // The click event is captured, confirming the button is interactive
      expect(wrapper.emitted('click')).toBeTruthy();
    });

    it('hides files modified count when filesModified is empty', () => {
      const wrapper = mountComponent({
        showSummary: true,
        summary: { shortSummary: 'Test', filesModified: [] },
      });
      expect(wrapper.find('.summary-files').exists()).toBe(false);
    });

    it('hides files modified count when filesModified is undefined', () => {
      const wrapper = mountComponent({
        showSummary: true,
        summary: { shortSummary: 'Test' },
      });
      expect(wrapper.find('.summary-files').exists()).toBe(false);
    });

    it('does not show summary, loading, or error when all are falsy', () => {
      const wrapper = mountComponent({
        showSummary: true,
        summary: null,
        summaryLoading: false,
        summaryError: false,
      });
      expect(wrapper.find('.session-summary').exists()).toBe(false);
      expect(wrapper.find('.session-summary-loading').exists()).toBe(false);
      expect(wrapper.find('.session-summary-error').exists()).toBe(false);
    });
  });

  describe('status badge classes', () => {
    const statuses = ['running', 'waiting', 'completed', 'error', 'stopped'];

    statuses.forEach((status) => {
      it(`applies correct class for ${status} status`, () => {
        const wrapper = mountComponent({
          session: { ...baseSession, status },
        });
        expect(wrapper.find('.status-badge').classes()).toContain(`status-${status}`);
      });
    });
  });
});
