import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import QueuedBadge from './QueuedBadge.vue';

describe('QueuedBadge', () => {
  it('renders Queued when the entry state is queued without a position', () => {
    const wrapper = mount(QueuedBadge, {
      props: { entryState: 'queued', queuePosition: null },
    });

    expect(wrapper.get('[data-testid="queued-badge"]').text()).toContain('Queued');
  });

  it('renders Queued #N when a queue position is known', () => {
    const wrapper = mount(QueuedBadge, {
      props: { entryState: 'queued', queuePosition: 2 },
    });

    const badge = wrapper.get('[data-testid="queued-badge"]');
    expect(badge.text()).toContain('Queued');
    expect(badge.text()).toContain('#2');
  });

  it('renders for the legacy disabled-lane marker alone', () => {
    const wrapper = mount(QueuedBadge, {
      props: { entryStatus: 'queued' },
    });

    expect(wrapper.get('[data-testid="queued-badge"]').text()).toContain('Queued');
  });

  it('renders nothing for running, unknown, or archived contexts', () => {
    for (const props of [
      { entryState: 'running' },
      {},
      { entryState: 'queued', queuePosition: 1, archived: true },
    ]) {
      const wrapper = mount(QueuedBadge, { props });
      expect(wrapper.find('[data-testid="queued-badge"]').exists()).toBe(false);
    }
  });

  it('hides a stale paused marker once the entry is running', () => {
    const wrapper = mount(QueuedBadge, {
      props: { entryState: 'running', entryStatus: 'queued' },
    });

    expect(wrapper.find('[data-testid="queued-badge"]').exists()).toBe(false);
  });

  it('explains the queue cause on hover', () => {
    const paused = mount(QueuedBadge, {
      props: { entryStatus: 'queued', cause: 'paused' },
    });
    const limited = mount(QueuedBadge, {
      props: { entryState: 'queued', queuePosition: 1, cause: 'concurrency' },
    });

    expect(paused.get('[data-testid="queued-badge"]').attributes('title')).toContain('paused');
    expect(limited.get('[data-testid="queued-badge"]').attributes('title')).toContain('slot');
    expect(paused.get('[data-testid="queued-badge"]').attributes('title')).not.toBe(
      limited.get('[data-testid="queued-badge"]').attributes('title')
    );
  });

  it('shows the paused reason for the paused-lane card API shape', () => {
    const wrapper = mount(QueuedBadge, {
      props: { entryState: 'queued', entryStatus: 'queued' },
    });

    expect(wrapper.get('[data-testid="queued-badge"]').attributes('title')).toContain('paused');
  });

  it('shows the concurrency reason for the limited-lane shape without a paused marker', () => {
    const wrapper = mount(QueuedBadge, {
      props: { entryState: 'queued', queuePosition: 1 },
    });

    expect(wrapper.get('[data-testid="queued-badge"]').attributes('title')).toContain('slot');
  });

  it('uses the shared queued status styling', () => {
    const wrapper = mount(QueuedBadge, {
      props: { entryState: 'queued', queuePosition: 1 },
    });

    expect(wrapper.get('[data-testid="queued-badge"]').classes()).toContain('status-queued');
  });
});
