import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import KanbanLaneSelectorModal from './KanbanLaneSelectorModal.vue';

describe('KanbanLaneSelectorModal', () => {
  function mountModal(props = {}) {
    return mount(KanbanLaneSelectorModal, {
      props: {
        isOpen: true,
        sessionName: 'Test Workspace',
        lanes: [
          { id: 'lane-1', name: 'Todo', cards: [{ id: 'card-1' }] },
          { id: 'lane-2', name: 'Done', cards: [] },
        ],
        ...props,
      },
    });
  }

  it('does not render when closed', () => {
    const wrapper = mountModal({ isOpen: false });
    expect(wrapper.find('.modal-backdrop').exists()).toBe(false);
  });

  it('renders the workspace name and lane options', () => {
    const wrapper = mountModal();

    expect(wrapper.text()).toContain('Test Workspace');
    expect(wrapper.text()).toContain('Todo');
    expect(wrapper.text()).toContain('1 cards');
    expect(wrapper.text()).toContain('Done');
    expect(wrapper.text()).toContain('0 cards');
  });

  it('emits selectLane with the selected lane', async () => {
    const selectLaneSpy = vi.fn();
    const wrapper = mount(KanbanLaneSelectorModal, {
      props: {
        isOpen: true,
        sessionName: 'Test Workspace',
        lanes: [
          { id: 'lane-1', name: 'Todo', cards: [{ id: 'card-1' }] },
          { id: 'lane-2', name: 'Done', cards: [] },
        ],
      },
      attrs: {
        onSelectLane: selectLaneSpy,
      },
    });

    await wrapper.findAll('.lane-option-btn')[1].trigger('click');

    expect(selectLaneSpy).toHaveBeenCalledWith({ id: 'lane-2', name: 'Done', cards: [] });
  });

  it('marks and disables the current lane', async () => {
    const wrapper = mountModal({ currentLaneId: 'lane-1' });
    const currentLane = wrapper.findAll('.lane-option-btn')[0];

    expect(currentLane.classes()).toContain('lane-option-current');
    expect(currentLane.attributes('aria-current')).toBe('true');
    expect(currentLane.attributes('disabled')).toBeDefined();
    expect(currentLane.text()).toContain('Current lane');

    await currentLane.trigger('click');
    expect(wrapper.emitted('select-lane')).toBeUndefined();
  });

  it('emits close from close and cancel buttons', async () => {
    const closeSpy = vi.fn();
    const wrapper = mount(KanbanLaneSelectorModal, {
      props: {
        isOpen: true,
        sessionName: 'Test Workspace',
        lanes: [],
      },
      attrs: {
        onClose: closeSpy,
      },
    });

    await wrapper.find('.close-btn').trigger('click');
    await wrapper.find('.btn-secondary').trigger('click');

    expect(closeSpy).toHaveBeenCalledTimes(2);
  });

  it('shows empty copy when no lanes exist', () => {
    const wrapper = mountModal({ lanes: [] });

    expect(wrapper.find('.empty-lanes').text()).toContain('No lanes available');
    expect(wrapper.find('.lane-option-btn').exists()).toBe(false);
  });
});
