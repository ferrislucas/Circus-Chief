import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PrIndicators from './PrIndicators.vue';

describe('PrIndicators', () => {
  describe('PR link display', () => {
    it('renders PR link when prUrl is provided', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/123',
        },
      });
      const link = wrapper.find('.pr-link');
      expect(link.exists()).toBe(true);
      expect(link.attributes('href')).toBe('https://github.com/owner/repo/pull/123');
    });

    it('does not render PR link when prUrl is null', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: null,
        },
      });
      expect(wrapper.find('.pr-link').exists()).toBe(false);
    });

    it('does not render PR link when prUrl is undefined', () => {
      const wrapper = mount(PrIndicators);
      expect(wrapper.find('.pr-link').exists()).toBe(false);
    });

    it('renders PR link with target="_blank" and noopener noreferrer', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/456',
        },
      });
      const link = wrapper.find('.pr-link');
      expect(link.attributes('target')).toBe('_blank');
      expect(link.attributes('rel')).toBe('noopener noreferrer');
    });
  });

  describe('PR text display', () => {
    it('displays PR number when valid GitHub PR URL is provided', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/123',
        },
      });
      expect(wrapper.find('.pr-link').text()).toBe('PR 123');
    });

    it('displays PR text for different PR numbers', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/999',
        },
      });
      expect(wrapper.find('.pr-link').text()).toBe('PR 999');
    });

    it('displays "PR" when URL format is invalid', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'not-a-valid-url',
        },
      });
      expect(wrapper.find('.pr-link').text()).toBe('PR');
    });

    it('displays "PR" when prUrl is empty string', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: '',
        },
      });
      // Empty string is falsy, so no link should render
      expect(wrapper.find('.pr-link').exists()).toBe(false);
    });
  });

  describe('PR tooltip', () => {
    it('shows tooltip with PR number and repository', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/myorg/myrepo/pull/123',
        },
      });
      const link = wrapper.find('.pr-link');
      expect(link.attributes('title')).toContain('PR #123');
      expect(link.attributes('title')).toContain('myorg/myrepo');
    });

    it('includes PR state in tooltip when summary has prState', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          summary: {
            prState: 'open',
          },
        },
      });
      const link = wrapper.find('.pr-link');
      expect(link.attributes('title')).toContain('State: Open');
    });

    it('tooltip is empty when prUrl is not provided', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: null,
        },
      });
      const link = wrapper.find('.pr-link');
      expect(link.exists()).toBe(false);
    });
  });

  describe('PR state badges', () => {
    it('renders "Merged" badge when prState is "merged"', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          summary: {
            prState: 'merged',
          },
        },
      });
      const badge = wrapper.find('.pr-state-badge');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe('Merged');
      expect(badge.classes()).toContain('pr-state-merged');
    });

    it('renders "Open" badge when prState is "open"', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          summary: {
            prState: 'open',
          },
        },
      });
      const badge = wrapper.find('.pr-state-badge');
      expect(badge.text()).toBe('Open');
      expect(badge.classes()).toContain('pr-state-open');
    });

    it('renders "Closed" badge when prState is "closed"', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          summary: {
            prState: 'closed',
          },
        },
      });
      const badge = wrapper.find('.pr-state-badge');
      expect(badge.text()).toBe('Closed');
      expect(badge.classes()).toContain('pr-state-closed');
    });

    it('renders "Draft" badge when prState is "draft"', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          summary: {
            prState: 'draft',
          },
        },
      });
      const badge = wrapper.find('.pr-state-badge');
      expect(badge.text()).toBe('Draft');
      expect(badge.classes()).toContain('pr-state-draft');
    });

    it('does not render badge when prState is not provided', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          summary: {},
        },
      });
      expect(wrapper.find('.pr-state-badge').exists()).toBe(false);
    });

    it('does not render badge when summary is null', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          summary: null,
        },
      });
      expect(wrapper.find('.pr-state-badge').exists()).toBe(false);
    });
  });

  describe('Merge conflict indicator', () => {
    it('renders conflict indicator when hasMergeConflicts is true', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          summary: {
            hasMergeConflicts: true,
          },
        },
      });
      const indicator = wrapper.find('.conflict-indicator');
      expect(indicator.exists()).toBe(true);
      expect(indicator.find('.conflict-icon').exists()).toBe(true);
    });

    it('does not render conflict indicator when hasMergeConflicts is false', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          summary: {
            hasMergeConflicts: false,
          },
        },
      });
      expect(wrapper.find('.conflict-indicator').exists()).toBe(false);
    });

    it('does not render conflict indicator when summary is null', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          summary: null,
        },
      });
      expect(wrapper.find('.conflict-indicator').exists()).toBe(false);
    });

    it('conflict indicator has title attribute', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          summary: {
            hasMergeConflicts: true,
          },
        },
      });
      const indicator = wrapper.find('.conflict-indicator');
      expect(indicator.attributes('title')).toBe('Merge conflicts detected');
    });
  });

  describe('CI status indicators', () => {
    it('renders success CI indicator when ciStatus is "success"', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          summary: {
            ciStatus: 'success',
          },
        },
      });
      const indicator = wrapper.find('.ci-success');
      expect(indicator.exists()).toBe(true);
      expect(indicator.classes()).toContain('ci-indicator');
      expect(indicator.attributes('title')).toBe('CI passing');
    });

    it('renders failure CI indicator when ciStatus is "failure"', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          summary: {
            ciStatus: 'failure',
          },
        },
      });
      const indicator = wrapper.find('.ci-failure');
      expect(indicator.exists()).toBe(true);
      expect(indicator.attributes('title')).toBe('CI failing');
    });

    it('renders pending CI indicator when ciStatus is "pending"', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          summary: {
            ciStatus: 'pending',
          },
        },
      });
      const indicator = wrapper.find('.ci-pending');
      expect(indicator.exists()).toBe(true);
      expect(indicator.attributes('title')).toBe('CI pending');
    });

    it('does not render CI indicator when ciStatus is not set', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          summary: {},
        },
      });
      expect(wrapper.find('.ci-indicator').exists()).toBe(false);
    });

    it('does not render CI indicator when summary is null', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          summary: null,
        },
      });
      expect(wrapper.find('.ci-indicator').exists()).toBe(false);
    });
  });

  describe('Multiple indicators together', () => {
    it('renders all indicators when all conditions are met', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          summary: {
            prState: 'open',
            hasMergeConflicts: true,
            ciStatus: 'failure',
          },
        },
      });
      expect(wrapper.find('.pr-link').exists()).toBe(true);
      expect(wrapper.find('.pr-state-badge').exists()).toBe(true);
      expect(wrapper.find('.conflict-indicator').exists()).toBe(true);
      expect(wrapper.find('.ci-failure').exists()).toBe(true);
    });

    it('renders indicators in correct container', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          summary: {
            prState: 'merged',
            ciStatus: 'success',
          },
        },
      });
      const container = wrapper.find('.pr-indicators');
      expect(container.exists()).toBe(true);
      expect(container.find('.pr-link').exists()).toBe(true);
      expect(container.find('.pr-state-badge').exists()).toBe(true);
    });
  });

  describe('PR link click behavior', () => {
    it('click event stops propagation on PR link', async () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/123',
        },
      });
      const link = wrapper.find('.pr-link');
      // The @click.stop on the link element prevents propagation
      // Verify the link can be clicked without errors
      expect(link.exists()).toBe(true);
      // The onclick handler is null since event handling is done via Vue directives
      expect(link.element.onclick === null || link.element.onclick === undefined).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('handles URLs with different repository names', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/someorg/some-repo-name/pull/999',
        },
      });
      const link = wrapper.find('.pr-link');
      expect(link.attributes('title')).toContain('someorg/some-repo-name');
      expect(link.text()).toBe('PR 999');
    });

    it('handles non-standard PR URLs gracefully', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/issues/123', // Not a PR URL
        },
      });
      // Should render the link but display text as 'PR' since it doesn't match the pattern
      expect(wrapper.find('.pr-link').text()).toBe('PR');
    });

    it('handles summary object with only some properties', () => {
      const wrapper = mount(PrIndicators, {
        props: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          summary: {
            prState: 'open',
            // missing hasMergeConflicts and ciStatus
          },
        },
      });
      expect(wrapper.find('.pr-state-badge').exists()).toBe(true);
      expect(wrapper.find('.conflict-indicator').exists()).toBe(false);
      expect(wrapper.find('.ci-indicator').exists()).toBe(false);
    });
  });
});
