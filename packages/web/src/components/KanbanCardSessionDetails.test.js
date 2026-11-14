import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import KanbanCardSessionDetails from './KanbanCardSessionDetails.vue';

// Runtime template compilation is unavailable in the test build, so string
// template stubs render as comments. Use the render-function stub pattern
// from SessionCard.test.js.
const RouterLinkStub = defineComponent({
  name: 'RouterLink',
  props: ['to'],
  setup(props, { slots }) {
    return () => h('a', { href: props.to }, slots.default?.());
  },
});

describe('KanbanCardSessionDetails', () => {
  const session = {
    id: 'session-1', name: 'Prompted session', status: 'running', mode: 'standard',
  };

  it('shows the reason and link for a failed automation', () => {
    const wrapper = mount(KanbanCardSessionDetails, {
      props: { session, lane: { name: 'Review' }, activeLaneRun: {
        status: 'failed', failureReason: 'Git setup failed', failedSessionId: 'child-1',
      } },
      // Register like a plugin would: the `stubs` RouterLink key is
      // special-cased by @vue/test-utils and renders nothing here.
      global: { components: { 'router-link': RouterLinkStub } },
    });
    expect(wrapper.text()).toContain('automation failed');
    expect(wrapper.text()).toContain('Git setup failed');
    const link = wrapper.findAll('a').find((a) => a.text() === 'Open failed session');
    expect(link).toBeTruthy();
    expect(link.attributes('href')).toBe('/sessions/child-1');
  });

  it('shows the accessible attention badge only when a card session needs agent input', () => {
    const wrapper = mount(KanbanCardSessionDetails, {
      props: { session, sessions: [{ ...session, pendingAgentInput: true }], lane: { name: 'Implementation' } },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });

    expect(wrapper.get('[aria-label="Agent input required"]').text()).toBe('needs input');

    const withoutPrompt = mount(KanbanCardSessionDetails, {
      props: { session, sessions: [session], lane: { name: 'Implementation' } },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    expect(withoutPrompt.find('[aria-label="Agent input required"]').exists()).toBe(false);
  });

  it('shows a declared exit lane while an automation run remains open', () => {
    const wrapper = mount(KanbanCardSessionDetails, {
      props: {
        session,
        sessions: [session],
        lane: { name: 'Review' },
        activeLaneRun: { status: 'open', sourceLaneName: 'Review', chosenExitLaneName: 'Needs attention' },
      },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });

    expect(wrapper.get('.lane-run-exit-lane').text()).toBe('Exit lane: Needs attention');
  });

  it('labels a terminal-run declaration as discarded', () => {
    const wrapper = mount(KanbanCardSessionDetails, {
      props: {
        session, sessions: [session], lane: { name: 'Review' },
        activeLaneRun: { status: 'cancelled', sourceLaneName: 'Review', chosenExitLaneName: 'Needs attention' },
      },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    expect(wrapper.get('.lane-run-exit-lane').text()).toBe('Discarded exit: Needs attention');
  });

  it('shows a queued badge with position when the card entry is queued', () => {
    const wrapper = mount(KanbanCardSessionDetails, {
      props: {
        session, sessions: [session], lane: { name: 'Review' },
        entryState: 'queued', queuePosition: 2,
      },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });

    expect(wrapper.get('[data-testid="queued-badge"]').text()).toContain('Queued');
    expect(wrapper.get('[data-testid="queued-badge"]').text()).toContain('#2');
  });

  it('shows no queued badge for running or unset entry states', () => {
    for (const props of [
      { session, sessions: [session], lane: { name: 'Review' }, entryState: 'running' },
      { session, sessions: [session], lane: { name: 'Review' } },
    ]) {
      const wrapper = mount(KanbanCardSessionDetails, {
        props,
        global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
      });
      expect(wrapper.find('[data-testid="queued-badge"]').exists()).toBe(false);
    }
  });
});
