import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import GitStatusSummary from './GitStatusSummary.vue';

describe('GitStatusSummary', () => {
  it('renders status copy, branch mapping, and refresh event', async () => {
    const onRefreshOrigin = vi.fn();
    const wrapper = mount(GitStatusSummary, {
      props: {
        status: {
          currentBranch: 'feature/session-detail',
          upstreamBranch: 'origin/feature/session-detail',
          lastCheckedAt: '2026-06-05T18:12:30.000Z',
          localChangeCount: 3,
        },
        summaryText: '3 local files',
        onRefreshOrigin,
      },
    });

    expect(wrapper.text()).toContain('Git attention');
    expect(wrapper.text()).toContain('3 local files');
    expect(wrapper.text()).toContain('feature/session-detail -> origin/feature/session-detail');

    const button = wrapper.find('.refresh-origin-button');
    expect(button.exists()).toBe(true);
    expect(button.attributes('disabled')).toBeUndefined();
    await button.trigger('click');

    expect(onRefreshOrigin).toHaveBeenCalledTimes(1);
  });

  it('renders inline error text', () => {
    const wrapper = mount(GitStatusSummary, {
      props: {
        summaryText: 'Git status unknown',
        error: new Error('Not a git repository'),
      },
    });

    expect(wrapper.text()).toContain('Not a git repository');
  });
});
