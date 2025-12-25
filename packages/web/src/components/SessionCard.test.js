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

    it('renders session mode capitalized', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.session-mode').text()).toBe('Code');
    });

    it('renders YOLO mode in uppercase', () => {
      const wrapper = mountComponent({
        session: { ...baseSession, mode: 'yolo' },
      });
      expect(wrapper.find('.session-mode').text()).toBe('YOLO');
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

  describe('PR status indicators', () => {
    describe('PR state badge', () => {
      it('shows merged badge when prState is merged', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, prUrl: 'https://github.com/org/repo/pull/123' },
          summary: { shortSummary: 'Test', prState: 'merged' },
        });
        const badge = wrapper.find('.pr-state-badge');
        expect(badge.exists()).toBe(true);
        expect(badge.text()).toBe('Merged');
        expect(badge.classes()).toContain('pr-state-merged');
      });

      it('shows open badge when prState is open', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, prUrl: 'https://github.com/org/repo/pull/123' },
          summary: { shortSummary: 'Test', prState: 'open' },
        });
        const badge = wrapper.find('.pr-state-badge');
        expect(badge.exists()).toBe(true);
        expect(badge.text()).toBe('Open');
        expect(badge.classes()).toContain('pr-state-open');
      });

      it('shows closed badge when prState is closed', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, prUrl: 'https://github.com/org/repo/pull/123' },
          summary: { shortSummary: 'Test', prState: 'closed' },
        });
        const badge = wrapper.find('.pr-state-badge');
        expect(badge.exists()).toBe(true);
        expect(badge.text()).toBe('Closed');
        expect(badge.classes()).toContain('pr-state-closed');
      });

      it('shows draft badge when prState is draft', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, prUrl: 'https://github.com/org/repo/pull/123' },
          summary: { shortSummary: 'Test', prState: 'draft' },
        });
        const badge = wrapper.find('.pr-state-badge');
        expect(badge.exists()).toBe(true);
        expect(badge.text()).toBe('Draft');
        expect(badge.classes()).toContain('pr-state-draft');
      });

      it('does not show PR state badge when prState is not present', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, prUrl: 'https://github.com/org/repo/pull/123' },
          summary: { shortSummary: 'Test' },
        });
        expect(wrapper.find('.pr-state-badge').exists()).toBe(false);
      });

      it('does not show PR state badge when summary is null', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, prUrl: 'https://github.com/org/repo/pull/123' },
          summary: null,
        });
        expect(wrapper.find('.pr-state-badge').exists()).toBe(false);
      });
    });

    describe('merge conflict indicator', () => {
      it('shows conflict indicator when hasMergeConflicts is true', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, prUrl: 'https://github.com/org/repo/pull/123' },
          summary: { shortSummary: 'Test', hasMergeConflicts: true },
        });
        const indicator = wrapper.find('.conflict-indicator');
        expect(indicator.exists()).toBe(true);
        expect(indicator.attributes('title')).toBe('Merge conflicts detected');
      });

      it('does not show conflict indicator when hasMergeConflicts is false', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, prUrl: 'https://github.com/org/repo/pull/123' },
          summary: { shortSummary: 'Test', hasMergeConflicts: false },
        });
        expect(wrapper.find('.conflict-indicator').exists()).toBe(false);
      });

      it('does not show conflict indicator when hasMergeConflicts is not present', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, prUrl: 'https://github.com/org/repo/pull/123' },
          summary: { shortSummary: 'Test' },
        });
        expect(wrapper.find('.conflict-indicator').exists()).toBe(false);
      });
    });

    describe('CI status indicator', () => {
      it('shows success indicator when ciStatus is success', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, prUrl: 'https://github.com/org/repo/pull/123' },
          summary: { shortSummary: 'Test', ciStatus: 'success' },
        });
        const indicator = wrapper.find('.ci-indicator');
        expect(indicator.exists()).toBe(true);
        expect(indicator.text()).toBe('✓');
        expect(indicator.classes()).toContain('ci-success');
        expect(indicator.attributes('title')).toBe('CI passing');
      });

      it('shows failure indicator when ciStatus is failure', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, prUrl: 'https://github.com/org/repo/pull/123' },
          summary: { shortSummary: 'Test', ciStatus: 'failure' },
        });
        const indicator = wrapper.find('.ci-indicator');
        expect(indicator.exists()).toBe(true);
        expect(indicator.text()).toBe('✗');
        expect(indicator.classes()).toContain('ci-failure');
        expect(indicator.attributes('title')).toBe('CI failing');
      });

      it('shows pending indicator when ciStatus is pending', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, prUrl: 'https://github.com/org/repo/pull/123' },
          summary: { shortSummary: 'Test', ciStatus: 'pending' },
        });
        const indicator = wrapper.find('.ci-indicator');
        expect(indicator.exists()).toBe(true);
        expect(indicator.text()).toBe('○');
        expect(indicator.classes()).toContain('ci-pending');
        expect(indicator.attributes('title')).toBe('CI pending');
      });

      it('does not show CI indicator when ciStatus is not present', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, prUrl: 'https://github.com/org/repo/pull/123' },
          summary: { shortSummary: 'Test' },
        });
        expect(wrapper.find('.ci-indicator').exists()).toBe(false);
      });

      it('does not show CI indicator when ciStatus is null', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, prUrl: 'https://github.com/org/repo/pull/123' },
          summary: { shortSummary: 'Test', ciStatus: null },
        });
        expect(wrapper.find('.ci-indicator').exists()).toBe(false);
      });
    });

    describe('graceful degradation', () => {
      it('shows all indicators when all data is present', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, prUrl: 'https://github.com/org/repo/pull/123' },
          summary: {
            shortSummary: 'Test',
            prState: 'open',
            hasMergeConflicts: true,
            ciStatus: 'failure',
          },
        });
        expect(wrapper.find('.pr-state-badge').exists()).toBe(true);
        expect(wrapper.find('.conflict-indicator').exists()).toBe(true);
        expect(wrapper.find('.ci-indicator').exists()).toBe(true);
      });

      it('shows no indicators when summary is missing', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, prUrl: 'https://github.com/org/repo/pull/123' },
        });
        expect(wrapper.find('.pr-state-badge').exists()).toBe(false);
        expect(wrapper.find('.conflict-indicator').exists()).toBe(false);
        expect(wrapper.find('.ci-indicator').exists()).toBe(false);
      });

      it('shows only available indicators (partial data)', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, prUrl: 'https://github.com/org/repo/pull/123' },
          summary: {
            shortSummary: 'Test',
            prState: 'open',
            // No hasMergeConflicts or ciStatus
          },
        });
        expect(wrapper.find('.pr-state-badge').exists()).toBe(true);
        expect(wrapper.find('.conflict-indicator').exists()).toBe(false);
        expect(wrapper.find('.ci-indicator').exists()).toBe(false);
      });
    });
  });

  describe('archive/unarchive buttons', () => {
    describe('archive button', () => {
      it('shows archive button when showArchive is true and session can be archived', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, status: 'completed' },
          showArchive: true,
        });
        const archiveBtn = wrapper.find('.archive-btn');
        expect(archiveBtn.exists()).toBe(true);
        expect(archiveBtn.attributes('title')).toBe('Archive session');
      });

      it('shows archive button for stopped sessions', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, status: 'stopped' },
          showArchive: true,
        });
        expect(wrapper.find('.archive-btn').exists()).toBe(true);
      });

      it('shows archive button for error sessions', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, status: 'error' },
          showArchive: true,
        });
        expect(wrapper.find('.archive-btn').exists()).toBe(true);
      });

      it('hides archive button for running sessions', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, status: 'running' },
          showArchive: true,
        });
        expect(wrapper.find('.archive-btn').exists()).toBe(false);
      });

      it('hides archive button for waiting sessions', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, status: 'waiting' },
          showArchive: true,
        });
        expect(wrapper.find('.archive-btn').exists()).toBe(false);
      });

      it('hides archive button when showArchive is false', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, status: 'completed' },
          showArchive: false,
        });
        expect(wrapper.find('.archive-btn').exists()).toBe(false);
      });

      it('archive button is clickable', async () => {
        const wrapper = mountComponent({
          session: { ...baseSession, status: 'completed' },
          showArchive: true,
        });
        const btn = wrapper.find('.archive-btn');
        expect(btn.exists()).toBe(true);
        // Verify button can be clicked without errors
        await btn.trigger('click');
      });
    });

    describe('unarchive button', () => {
      it('shows unarchive button when showUnarchive is true', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, status: 'completed', archived: true },
          showUnarchive: true,
        });
        const unarchiveBtn = wrapper.find('.archive-btn');
        expect(unarchiveBtn.exists()).toBe(true);
        expect(unarchiveBtn.attributes('title')).toBe('Unarchive session');
      });

      it('hides unarchive button when showUnarchive is false', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, status: 'completed', archived: true },
          showUnarchive: false,
        });
        expect(wrapper.find('.archive-actions').exists()).toBe(false);
      });

      it('unarchive button is clickable', async () => {
        const wrapper = mountComponent({
          session: { ...baseSession, status: 'completed', archived: true },
          showUnarchive: true,
        });
        const btn = wrapper.find('.archive-btn');
        expect(btn.exists()).toBe(true);
        // Verify button can be clicked without errors
        await btn.trigger('click');
      });
    });

    describe('archive actions container', () => {
      it('shows archive-actions container when showArchive is true', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, status: 'completed' },
          showArchive: true,
        });
        expect(wrapper.find('.archive-actions').exists()).toBe(true);
      });

      it('shows archive-actions container when showUnarchive is true', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, status: 'completed' },
          showUnarchive: true,
        });
        expect(wrapper.find('.archive-actions').exists()).toBe(true);
      });

      it('hides archive-actions container when both showArchive and showUnarchive are false', () => {
        const wrapper = mountComponent({
          session: { ...baseSession, status: 'completed' },
          showArchive: false,
          showUnarchive: false,
        });
        expect(wrapper.find('.archive-actions').exists()).toBe(false);
      });
    });
  });
});
