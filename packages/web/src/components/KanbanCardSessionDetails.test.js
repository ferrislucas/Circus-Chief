import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import KanbanCardSessionDetails from './KanbanCardSessionDetails.vue';

describe('KanbanCardSessionDetails', () => {
  const session = {
    id: 'session-1', name: 'Prompted session', status: 'running', mode: 'standard',
  };

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
});
