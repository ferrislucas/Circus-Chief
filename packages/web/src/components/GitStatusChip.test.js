import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import GitStatusChip from './GitStatusChip.vue';

describe('GitStatusChip', () => {
  let router;

  beforeEach(async () => {
    router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/sessions/:id/:tab?', component: { template: '<div />' } }],
    });
    await router.push('/sessions/sess-1/summary');
    await router.isReady();
  });

  it('renders actionable status styling', () => {
    const wrapper = mount(GitStatusChip, {
      global: { plugins: [router] },
      props: {
        sessionId: 'sess-1',
        summaryText: '2 unpushed commits',
        hasActionableStatus: true,
      },
    });

    expect(wrapper.text()).toContain('2 unpushed commits');
    expect(wrapper.classes()).toContain('is-actionable');
  });

  it('navigates to the Changes tab on click', async () => {
    const pushSpy = vi.spyOn(router, 'push');
    const wrapper = mount(GitStatusChip, {
      global: { plugins: [router] },
      props: { sessionId: 'sess-1', summaryText: 'Git clean' },
    });

    await wrapper.trigger('click');

    expect(pushSpy).toHaveBeenCalledWith('/sessions/sess-1/changes');
  });
});
