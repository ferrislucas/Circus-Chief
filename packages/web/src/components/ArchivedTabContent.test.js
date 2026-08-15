import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ArchivedTabContent from './ArchivedTabContent.vue';

vi.mock('./SessionCard.vue', () => ({
  default: {
    name: 'SessionCard',
    props: [
      'session', 'showSummary', 'summary', 'workflowAggregate', 'showUnarchive',
      'prUrl', 'prSummary', 'canAddToBoard',
    ],
    emits: ['unarchive', 'star'],
    template: '<button class="session-card-mock" @click="$emit(\'unarchive\', session.id)">{{ session.name }}</button>',
  },
}));

function mountComponent(props = {}, attrs = {}) {
  return mount(ArchivedTabContent, { props, attrs });
}

describe('ArchivedTabContent', () => {
  it('declares the authoritative list-state props and forwarded events', () => {
    expect(ArchivedTabContent.props).toMatchObject({
      workspaces: expect.any(Object),
      loading: expect.any(Object),
      loadingMore: expect.any(Object),
      error: expect.any(Object),
      hasMore: expect.any(Object),
      total: expect.any(Object),
    });
    expect(ArchivedTabContent.emits).toEqual([
      'retry-summary', 'unarchive', 'star', 'load-more',
    ]);
  });

  it('renders loading, error, and empty states from list-response state', async () => {
    const wrapper = mountComponent({ loading: true });
    expect(wrapper.findAll('.skeleton')).toHaveLength(3);

    await wrapper.setProps({ loading: false, error: 'Failed to load workspaces' });
    expect(wrapper.find('.error-message').text()).toBe('Failed to load workspaces');

    await wrapper.setProps({ error: null });
    expect(wrapper.find('.empty-state').text()).toContain('No archived workspaces');
  });

  it('renders only the authoritative workspace-card props', () => {
    const workspaces = [
      {
        id: 'workspace-1',
        name: 'Archived workspace',
        summaryPreview: 'Server preview',
        runningCount: 1,
        latestCommandRuns: [{ buttonId: 'test', status: 'success' }],
      },
    ];
    const wrapper = mountComponent({ workspaces });
    const card = wrapper.findComponent({ name: 'SessionCard' });

    expect(card.props('session')).toEqual(workspaces[0]);
    expect(card.props('workflowAggregate')).toEqual(workspaces[0]);
    expect(card.props('summary')).toEqual({ shortSummary: 'Server preview' });
    expect(card.props('showUnarchive')).toBe(true);
    expect(card.props('canAddToBoard')).toBe(false);
  });

  it('renders every archived workspace exactly once', () => {
    const wrapper = mountComponent({
      workspaces: [
        { id: 'one', name: 'One' },
        { id: 'two', name: 'Two' },
      ],
    });
    expect(wrapper.findAllComponents({ name: 'SessionCard' })).toHaveLength(2);
  });

  it('keeps cards visible during an initial-list refresh', () => {
    const wrapper = mountComponent({
      workspaces: [{ id: 'one', name: 'One' }],
      loading: true,
    });

    expect(wrapper.find('.skeleton-list').exists()).toBe(false);
    expect(wrapper.find('.session-card-mock').exists()).toBe(true);
  });

  it('keeps cards visible when a background refresh fails', () => {
    const wrapper = mountComponent({
      workspaces: [{ id: 'one', name: 'One' }],
      error: 'Refresh failed',
    });

    expect(wrapper.find('.session-card-mock').exists()).toBe(true);
    expect(wrapper.find('[role="alert"]').text()).toBe('Refresh failed');
  });

  it('shows authoritative remaining count and emits loadMore', async () => {
    const onLoadMore = vi.fn();
    const wrapper = mountComponent({
      workspaces: [{ id: 'one', name: 'One' }],
      hasMore: true,
      total: 4,
    }, { onLoadMore });
    const button = wrapper.find('.load-more-container button');
    expect(button.text()).toContain('3 remaining');
    await button.trigger('click');
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('keeps visible cards while a next page loads', () => {
    const wrapper = mountComponent({
      workspaces: [{ id: 'one', name: 'One' }],
      hasMore: true,
      loadingMore: true,
      total: 2,
    });
    expect(wrapper.find('.skeleton-list').exists()).toBe(false);
    expect(wrapper.find('.session-card-mock').exists()).toBe(true);
    expect(wrapper.find('.load-more-container button').attributes('disabled')).toBeDefined();
    expect(wrapper.find('.load-more-container button').text()).toBe('Loading...');
  });

  it('hides load more when traversal is complete', () => {
    const wrapper = mountComponent({
      workspaces: [{ id: 'one', name: 'One' }],
      hasMore: false,
      total: 1,
    });

    expect(wrapper.find('.load-more-container').exists()).toBe(false);
  });

  it('never displays a negative remaining count', () => {
    const wrapper = mountComponent({
      workspaces: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }],
      hasMore: true,
      total: 1,
    });

    expect(wrapper.find('.load-more-container button').text()).toContain('0 remaining');
  });

  it('forwards unarchive events', async () => {
    const onUnarchive = vi.fn();
    const wrapper = mountComponent(
      { workspaces: [{ id: 'one', name: 'One' }] },
      { onUnarchive },
    );
    await wrapper.find('.session-card-mock').trigger('click');
    expect(onUnarchive).toHaveBeenCalledWith('one');
  });
});
