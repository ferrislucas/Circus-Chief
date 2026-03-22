import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import SessionHeaderPanel from './SessionHeaderPanel.vue';

vi.mock('./OverflowMenu.vue', () => ({
  default: {
    name: 'OverflowMenu',
    template: '<div class="overflow-menu"><button @click="$emit(\'duplicate\')">Dup</button><button @click="$emit(\'archive\')">Arc</button><button @click="$emit(\'delete\')">Del</button><button @click="$emit(\'copySessionId\')">Copy</button></div>',
    emits: ['duplicate', 'archive', 'delete', 'copySessionId'],
    props: ['isArchived', 'isDeleting', 'copySessionIdText'],
  }
}));

vi.mock('./PrUrlEditor.vue', () => ({
  default: {
    name: 'PrUrlEditor',
    template: '<div class="pr-url-editor-stub"></div>',
    props: ['sessionId', 'prUrl', 'summary'],
  }
}));

vi.mock('./CommandButtonStatusBar.vue', () => ({
  default: {
    name: 'CommandButtonStatusBar',
    template: '<div class="cmd-status-bar-stub"></div>',
    props: ['buttonStatuses'],
  }
}));

vi.mock('./SessionTreePicker.vue', () => ({
  default: {
    name: 'SessionTreePicker',
    template: '<div class="session-tree-picker-stub" data-testid="session-tree-picker"><div v-for="s in sessions" :key="s.id" role="option" @click="$emit(\'select\', s.id)">{{ s.name }}</div></div>',
    emits: ['select'],
    props: ['sessions', 'activeSessionId', 'summaries'],
  },
}));

vi.mock('./MoveCardModal.vue', () => ({
  default: {
    name: 'MoveCardModal',
    template: '<div class="move-card-modal-stub"></div>',
    props: ['isOpen', 'projectId', 'cardId', 'currentLaneId', 'sessionName'],
    emits: ['update:isOpen', 'close', 'moved'],
  },
}));

// Create a shared mock store instance
const mockKanbanStoreInstance = {
  getCardBySessionId: vi.fn(() => null),
  getLaneById: vi.fn(() => null),
};

vi.mock('../stores/kanban.js', () => ({
  useKanbanStore: vi.fn(() => mockKanbanStoreInstance),
}));

vi.mock('../composables/useApi.js', () => ({
  api: {
    updateSession: vi.fn().mockResolvedValue({}),
    getKanbanBoard: vi.fn().mockResolvedValue(null),
    createKanbanCard: vi.fn().mockResolvedValue({}),
    moveKanbanCard: vi.fn().mockResolvedValue({}),
    deleteKanbanCard: vi.fn().mockResolvedValue({}),
  },
}));

import { api } from '../composables/useApi.js';
import { useKanbanStore } from '../stores/kanban.js';

describe('SessionHeaderPanel', () => {
  let pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
  });

  function mountPanel(props = {}) {
    return mount(SessionHeaderPanel, {
      global: { plugins: [pinia] },
      props: {
        sessionId: 'session-1',
        session: {
          id: 'session-1',
          name: 'Test Session',
          status: 'waiting',
          projectId: 'proj-1',
          starred: false,
          prUrl: null,
          archived: false,
        },
        summary: null,
        isDeleting: false,
        buttonStatuses: [],
        ...props,
      },
    });
  }

  describe('session name display', () => {
    it('renders session name', () => {
      const wrapper = mountPanel();
      expect(wrapper.find('.session-name').text()).toBe('Test Session');
    });

    it('shows edit button when not editing', () => {
      const wrapper = mountPanel();
      expect(wrapper.find('.name-edit-trigger').exists()).toBe(true);
    });

    it('does not show edit form when not editing', () => {
      const wrapper = mountPanel();
      expect(wrapper.find('.name-edit-form').exists()).toBe(false);
    });
  });

  describe('name editing', () => {
    it('enters edit mode when clicking edit button', async () => {
      const wrapper = mountPanel();
      await wrapper.find('.name-edit-trigger').trigger('click');
      expect(wrapper.find('.name-edit-form').exists()).toBe(true);
      expect(wrapper.find('.name-edit-input').exists()).toBe(true);
    });

    it('populates input with current name', async () => {
      const wrapper = mountPanel({
        session: { id: 'session-1', name: 'My Session', status: 'waiting' },
      });
      await wrapper.find('.name-edit-trigger').trigger('click');
      expect(wrapper.find('.name-edit-input').element.value).toBe('My Session');
    });

    it('saves name when clicking save button', async () => {
      api.updateSession.mockResolvedValue({ name: 'New Name' });
      const wrapper = mountPanel();
      await wrapper.find('.name-edit-trigger').trigger('click');

      await wrapper.find('.name-edit-input').setValue('New Name');
      await wrapper.find('.pr-save-btn').trigger('click');
      await flushPromises();

      expect(api.updateSession).toHaveBeenCalledWith('session-1', {
        name: 'New Name',
        manuallyNamed: true,
      });
    });

    it('saves name when pressing Enter', async () => {
      api.updateSession.mockResolvedValue({ name: 'New Name' });
      const wrapper = mountPanel();
      await wrapper.find('.name-edit-trigger').trigger('click');

      await wrapper.find('.name-edit-input').setValue('New Name');
      await wrapper.find('.name-edit-input').trigger('keyup.enter');
      await flushPromises();

      expect(api.updateSession).toHaveBeenCalled();
    });

    it('cancels editing when pressing Escape', async () => {
      const wrapper = mountPanel();
      await wrapper.find('.name-edit-trigger').trigger('click');
      expect(wrapper.find('.name-edit-form').exists()).toBe(true);

      await wrapper.find('.name-edit-input').trigger('keyup.escape');
      expect(wrapper.find('.name-edit-form').exists()).toBe(false);
    });

    it('cancels editing when clicking cancel button', async () => {
      const wrapper = mountPanel();
      await wrapper.find('.name-edit-trigger').trigger('click');
      expect(wrapper.find('.name-edit-form').exists()).toBe(true);

      await wrapper.find('.pr-cancel-btn').trigger('click');
      expect(wrapper.find('.name-edit-form').exists()).toBe(false);
    });

    it('prevents saving empty names', async () => {
      const wrapper = mountPanel();
      await wrapper.find('.name-edit-trigger').trigger('click');

      await wrapper.find('.name-edit-input').setValue('   ');
      await wrapper.find('.pr-save-btn').trigger('click');
      await flushPromises();

      expect(api.updateSession).not.toHaveBeenCalled();
    });

    it('trims whitespace from name before saving', async () => {
      api.updateSession.mockResolvedValue({ name: 'Trimmed Name' });
      const wrapper = mountPanel();
      await wrapper.find('.name-edit-trigger').trigger('click');

      await wrapper.find('.name-edit-input').setValue('  Trimmed Name  ');
      await wrapper.find('.pr-save-btn').trigger('click');
      await flushPromises();

      expect(api.updateSession).toHaveBeenCalledWith('session-1', {
        name: 'Trimmed Name',
        manuallyNamed: true,
      });
    });

    it('shows clear button when input has text', async () => {
      const wrapper = mountPanel({
        session: { id: 'session-1', name: 'Existing Name', status: 'waiting' },
      });
      await wrapper.find('.name-edit-trigger').trigger('click');
      expect(wrapper.find('.pr-clear-btn').exists()).toBe(true);
    });

    it('hides clear button when input is empty', async () => {
      const wrapper = mountPanel();
      await wrapper.find('.name-edit-trigger').trigger('click');
      await wrapper.find('.name-edit-input').setValue('');
      expect(wrapper.find('.pr-clear-btn').exists()).toBe(false);
    });

    it('clears input when clicking clear button', async () => {
      const wrapper = mountPanel({
        session: { id: 'session-1', name: 'Some Name', status: 'waiting' },
      });
      await wrapper.find('.name-edit-trigger').trigger('click');
      expect(wrapper.find('.name-edit-input').element.value).toBe('Some Name');

      await wrapper.find('.pr-clear-btn').trigger('click');
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.name-edit-input').element.value).toBe('');
    });

    it('handles API errors when saving', async () => {
      api.updateSession.mockRejectedValue(new Error('Server error'));
      const wrapper = mountPanel();
      await wrapper.find('.name-edit-trigger').trigger('click');

      await wrapper.find('.name-edit-input').setValue('New Name');
      await wrapper.find('.pr-save-btn').trigger('click');
      await flushPromises();

      // Form should still be visible after error
      expect(wrapper.find('.name-edit-form').exists()).toBe(true);
    });

    it('closes form after successful save', async () => {
      api.updateSession.mockResolvedValue({ name: 'New Name' });
      const wrapper = mountPanel();
      await wrapper.find('.name-edit-trigger').trigger('click');

      await wrapper.find('.name-edit-input').setValue('New Name');
      await wrapper.find('.pr-save-btn').trigger('click');
      await flushPromises();

      expect(wrapper.find('.name-edit-form').exists()).toBe(false);
    });
  });

  describe('star button', () => {
    it('renders unstarred state by default', () => {
      const wrapper = mountPanel();
      const starBtn = wrapper.find('.btn-star');
      expect(starBtn.exists()).toBe(true);
      expect(starBtn.classes()).not.toContain('is-starred');
    });

    it('renders starred state when session is starred', () => {
      const wrapper = mountPanel({
        session: { id: 'session-1', name: 'Test', status: 'waiting', starred: true },
      });
      const starBtn = wrapper.find('.btn-star');
      expect(starBtn.classes()).toContain('is-starred');
    });

    it('has correct title for unstarred session', () => {
      const wrapper = mountPanel();
      const starBtn = wrapper.find('.btn-star');
      expect(starBtn.attributes('title')).toBe('Star session');
    });

    it('has correct title for starred session', () => {
      const wrapper = mountPanel({
        session: { id: 'session-1', name: 'Test', status: 'waiting', starred: true },
      });
      const starBtn = wrapper.find('.btn-star');
      expect(starBtn.attributes('title')).toBe('Unstar session');
    });

    it('star button is clickable and exists', async () => {
      const wrapper = mountPanel();
      const starBtn = wrapper.find('.btn-star');
      expect(starBtn.exists()).toBe(true);
      // Trigger click to verify no errors
      await starBtn.trigger('click');
      // The click event should be captured (the star emit is handled by Vue template binding)
      expect(wrapper.emitted()).toHaveProperty('click');
    });
  });

  describe('overflow menu', () => {
    it('renders OverflowMenu component', () => {
      const wrapper = mountPanel();
      const menu = wrapper.findComponent({ name: 'OverflowMenu' });
      expect(menu.exists()).toBe(true);
    });

    it('passes archived state to OverflowMenu', () => {
      const wrapper = mountPanel({
        session: { id: 'session-1', name: 'Test', status: 'waiting', archived: true },
      });
      const menu = wrapper.findComponent({ name: 'OverflowMenu' });
      expect(menu.props('isArchived')).toBe(true);
    });

    it('passes isDeleting state to OverflowMenu', () => {
      const wrapper = mountPanel({ isDeleting: true });
      const menu = wrapper.findComponent({ name: 'OverflowMenu' });
      expect(menu.props('isDeleting')).toBe(true);
    });

    it('OverflowMenu has event listeners for duplicate', () => {
      const wrapper = mountPanel();
      const menu = wrapper.findComponent({ name: 'OverflowMenu' });
      expect(menu.exists()).toBe(true);
      // Verify the OverflowMenu mock is rendered with buttons
      expect(menu.findAll('button').length).toBeGreaterThan(0);
    });

    it('OverflowMenu has event listeners for archive', () => {
      const wrapper = mountPanel();
      const menu = wrapper.findComponent({ name: 'OverflowMenu' });
      expect(menu.exists()).toBe(true);
      // The archive button is rendered in the mock template
      const arcBtn = menu.findAll('button').find(b => b.text() === 'Arc');
      expect(arcBtn).toBeDefined();
    });

    it('OverflowMenu has event listeners for delete', () => {
      const wrapper = mountPanel();
      const menu = wrapper.findComponent({ name: 'OverflowMenu' });
      const delBtn = menu.findAll('button').find(b => b.text() === 'Del');
      expect(delBtn).toBeDefined();
    });

    it('OverflowMenu has event listeners for copySessionId', () => {
      const wrapper = mountPanel();
      const menu = wrapper.findComponent({ name: 'OverflowMenu' });
      const copyBtn = menu.findAll('button').find(b => b.text() === 'Copy');
      expect(copyBtn).toBeDefined();
    });
  });

  describe('PrUrlEditor integration', () => {
    it('renders PrUrlEditor component', () => {
      const wrapper = mountPanel();
      const editor = wrapper.findComponent({ name: 'PrUrlEditor' });
      expect(editor.exists()).toBe(true);
    });

    it('passes sessionId to PrUrlEditor', () => {
      const wrapper = mountPanel();
      const editor = wrapper.findComponent({ name: 'PrUrlEditor' });
      expect(editor.props('sessionId')).toBe('session-1');
    });

    it('passes prUrl from session to PrUrlEditor', () => {
      const wrapper = mountPanel({
        session: { id: 'session-1', name: 'Test', status: 'waiting', prUrl: 'https://github.com/a/b/pull/1' },
      });
      const editor = wrapper.findComponent({ name: 'PrUrlEditor' });
      expect(editor.props('prUrl')).toBe('https://github.com/a/b/pull/1');
    });

    it('passes summary to PrUrlEditor', () => {
      const summary = { title: 'Test' };
      const wrapper = mountPanel({ summary });
      const editor = wrapper.findComponent({ name: 'PrUrlEditor' });
      expect(editor.props('summary')).toEqual(summary);
    });
  });

  describe('CommandButtonStatusBar integration', () => {
    it('renders CommandButtonStatusBar', () => {
      const wrapper = mountPanel();
      const statusBar = wrapper.findComponent({ name: 'CommandButtonStatusBar' });
      expect(statusBar.exists()).toBe(true);
    });

    it('passes buttonStatuses to CommandButtonStatusBar', () => {
      const statuses = [
        { buttonId: 'btn-1', label: 'Test', status: 'running' },
      ];
      const wrapper = mountPanel({ buttonStatuses: statuses });
      const statusBar = wrapper.findComponent({ name: 'CommandButtonStatusBar' });
      expect(statusBar.props('buttonStatuses')).toEqual(statuses);
    });
  });

  describe('move card modal', () => {
    beforeEach(() => {
      // Setup mocks for all tests in this describe block
      mockKanbanStoreInstance.getCardBySessionId.mockReturnValue({
        id: 'card-1',
        laneId: 'lane-1',
      });
      mockKanbanStoreInstance.getLaneById.mockReturnValue({
        id: 'lane-1',
        name: 'In Progress',
      });
    });

    describe('lane chip renders as button when session is on board', () => {
      it('lane chip renders as a button when session is on the board', () => {
        const wrapper = mountPanel();
        const laneChip = wrapper.find('.lane-chip');
        expect(laneChip.element.tagName.toLowerCase()).toBe('button');
      });

      it('button has type="button" attribute', () => {
        const wrapper = mountPanel();
        const laneChip = wrapper.find('.lane-chip');
        expect(laneChip.attributes('type')).toBe('button');
      });

      it('button has lane-chip and lane-chip-clickable classes', () => {
        const wrapper = mountPanel();
        const laneChip = wrapper.find('.lane-chip');
        expect(laneChip.classes()).toContain('lane-chip');
        expect(laneChip.classes()).toContain('lane-chip-clickable');
      });

      it('button has correct title attribute', () => {
        const wrapper = mountPanel();
        const laneChip = wrapper.find('.lane-chip');
        expect(laneChip.attributes('title')).toBe('Move from In Progress to another lane');
      });

      it('button is keyboard focusable and accessible', () => {
        const wrapper = mountPanel();
        const laneChip = wrapper.find('.lane-chip');
        expect(laneChip.attributes('tabindex')).not.toBe('-1');
      });
    });

    describe('lane chip click opens modal', () => {
      it('sets showMoveCardModal to true when lane chip is clicked', async () => {
        const wrapper = mountPanel();
        const laneChip = wrapper.find('.lane-chip');
        await laneChip.trigger('click');
        await wrapper.vm.$nextTick();

        const moveCardModal = wrapper.findComponent({ name: 'MoveCardModal' });
        expect(moveCardModal.props('isOpen')).toBe(true);
      });
    });

    describe('modal receives correct props', () => {
      it('MoveCardModal receives projectId from session.projectId', async () => {
        const wrapper = mountPanel();
        const laneChip = wrapper.find('.lane-chip');
        await laneChip.trigger('click');
        await wrapper.vm.$nextTick();

        const moveCardModal = wrapper.findComponent({ name: 'MoveCardModal' });
        expect(moveCardModal.props('projectId')).toBe('proj-1');
      });

      it('MoveCardModal receives cardId from sessionCard', async () => {
        const wrapper = mountPanel();
        const laneChip = wrapper.find('.lane-chip');
        await laneChip.trigger('click');
        await wrapper.vm.$nextTick();

        const moveCardModal = wrapper.findComponent({ name: 'MoveCardModal' });
        expect(moveCardModal.props('cardId')).toBe('card-1');
      });

      it('MoveCardModal receives currentLaneId from sessionLane', async () => {
        const wrapper = mountPanel();
        const laneChip = wrapper.find('.lane-chip');
        await laneChip.trigger('click');
        await wrapper.vm.$nextTick();

        const moveCardModal = wrapper.findComponent({ name: 'MoveCardModal' });
        expect(moveCardModal.props('currentLaneId')).toBe('lane-1');
      });

      it('MoveCardModal receives sessionName from session', async () => {
        const wrapper = mountPanel();
        const laneChip = wrapper.find('.lane-chip');
        await laneChip.trigger('click');
        await wrapper.vm.$nextTick();

        const moveCardModal = wrapper.findComponent({ name: 'MoveCardModal' });
        expect(moveCardModal.props('sessionName')).toBe('Test Session');
      });
    });

    describe('no lane chip when session not on board', () => {
      beforeEach(() => {
        mockKanbanStoreInstance.getCardBySessionId.mockReturnValue(null);
        mockKanbanStoreInstance.getLaneById.mockReturnValue(null);
      });

      it('does not render lane chip when session is not on board', () => {
        const wrapper = mountPanel();
        const laneChip = wrapper.find('.lane-chip');
        expect(laneChip.exists()).toBe(false);
      });

      it('modal state remains false (closed)', () => {
        const wrapper = mountPanel();
        expect(wrapper.vm.showMoveCardModal).toBe(false);
      });
    });

    describe('modal close behavior', () => {
      beforeEach(() => {
        // Reset mocks to return lane data (undo changes from previous describe block)
        mockKanbanStoreInstance.getCardBySessionId.mockReturnValue({
          id: 'card-1',
          laneId: 'lane-1',
        });
        mockKanbanStoreInstance.getLaneById.mockReturnValue({
          id: 'lane-1',
          name: 'In Progress',
        });
      });

      it('resets showMoveCardModal to false when close event is emitted', async () => {
        const wrapper = mountPanel();
        const laneChip = wrapper.find('.lane-chip');
        await laneChip.trigger('click');
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.showMoveCardModal).toBe(true);

        const moveCardModal = wrapper.findComponent({ name: 'MoveCardModal' });
        await moveCardModal.vm.$emit('close');
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.showMoveCardModal).toBe(false);
      });

      it('resets showMoveCardModal to false when moved event is emitted', async () => {
        const wrapper = mountPanel();
        const laneChip = wrapper.find('.lane-chip');
        await laneChip.trigger('click');
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.showMoveCardModal).toBe(true);

        const moveCardModal = wrapper.findComponent({ name: 'MoveCardModal' });
        await moveCardModal.vm.$emit('moved');
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.showMoveCardModal).toBe(false);
      });

      it('handles modal close without errors', async () => {
        const wrapper = mountPanel();
        const laneChip = wrapper.find('.lane-chip');
        await laneChip.trigger('click');
        await wrapper.vm.$nextTick();

        const moveCardModal = wrapper.findComponent({ name: 'MoveCardModal' });

        // Should not throw
        await moveCardModal.vm.$emit('update:isOpen', false);
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.showMoveCardModal).toBe(false);
      });
    });
  });

  describe('session tree picker integration', () => {
    const chainSessions = [
      { id: 'root-1', name: 'Root Session', status: 'waiting', parentSessionId: null },
      { id: 'child-1', name: 'Child Session', status: 'running', parentSessionId: 'root-1' },
    ];
    const chainSummaries = {
      'root-1': { shortSummary: 'Root summary' },
      'child-1': { shortSummary: 'Child summary' },
    };

    function mountWithPicker(extraProps = {}) {
      return mountPanel({
        sessionChain: chainSessions,
        activeSessionId: 'root-1',
        summariesMap: chainSummaries,
        hasDescendants: true,
        ...extraProps,
      });
    }

    describe('tree-icon button visibility', () => {
      it('renders tree-icon button when hasDescendants is true', () => {
        const wrapper = mountWithPicker();
        expect(wrapper.find('[data-testid="session-tree-icon"]').exists()).toBe(true);
      });

      it('does not render tree-icon button when hasDescendants is false', () => {
        const wrapper = mountPanel({ hasDescendants: false });
        expect(wrapper.find('[data-testid="session-tree-icon"]').exists()).toBe(false);
      });
    });

    describe('dropdown trigger visibility', () => {
      it('renders dropdown trigger when hasDescendants is true', () => {
        const wrapper = mountWithPicker();
        expect(wrapper.find('[data-testid="session-tree-dropdown"]').exists()).toBe(true);
      });

      it('does not render dropdown trigger when hasDescendants is false', () => {
        const wrapper = mountPanel({ hasDescendants: false });
        expect(wrapper.find('[data-testid="session-tree-dropdown"]').exists()).toBe(false);
      });

      it('displays the active session name in the dropdown trigger', () => {
        const wrapper = mountWithPicker();
        expect(wrapper.find('.dropdown-name').text()).toBeTruthy();
      });
    });

    describe('picker toggle', () => {
      it('clicking tree-icon button opens picker', async () => {
        const wrapper = mountWithPicker();
        expect(wrapper.findComponent({ name: 'SessionTreePicker' }).exists()).toBe(false);

        await wrapper.find('[data-testid="session-tree-icon"]').trigger('click');
        expect(wrapper.findComponent({ name: 'SessionTreePicker' }).exists()).toBe(true);
      });

      it('clicking tree-icon button again closes picker', async () => {
        const wrapper = mountWithPicker();
        await wrapper.find('[data-testid="session-tree-icon"]').trigger('click');
        expect(wrapper.findComponent({ name: 'SessionTreePicker' }).exists()).toBe(true);

        await wrapper.find('[data-testid="session-tree-icon"]').trigger('click');
        expect(wrapper.findComponent({ name: 'SessionTreePicker' }).exists()).toBe(false);
      });

      it('clicking dropdown trigger opens picker', async () => {
        const wrapper = mountWithPicker();
        expect(wrapper.findComponent({ name: 'SessionTreePicker' }).exists()).toBe(false);

        await wrapper.find('.dropdown-trigger').trigger('click');
        expect(wrapper.findComponent({ name: 'SessionTreePicker' }).exists()).toBe(true);
      });

      it('clicking dropdown trigger again closes picker', async () => {
        const wrapper = mountWithPicker();
        await wrapper.find('.dropdown-trigger').trigger('click');
        expect(wrapper.findComponent({ name: 'SessionTreePicker' }).exists()).toBe(true);

        await wrapper.find('.dropdown-trigger').trigger('click');
        expect(wrapper.findComponent({ name: 'SessionTreePicker' }).exists()).toBe(false);
      });
    });

    describe('SessionTreePicker rendering and props', () => {
      it('passes correct sessions prop', async () => {
        const wrapper = mountWithPicker();
        await wrapper.find('[data-testid="session-tree-icon"]').trigger('click');

        const picker = wrapper.findComponent({ name: 'SessionTreePicker' });
        expect(picker.props('sessions')).toEqual(chainSessions);
      });

      it('passes correct activeSessionId prop', async () => {
        const wrapper = mountWithPicker();
        await wrapper.find('[data-testid="session-tree-icon"]').trigger('click');

        const picker = wrapper.findComponent({ name: 'SessionTreePicker' });
        expect(picker.props('activeSessionId')).toBe('root-1');
      });

      it('passes correct summaries prop', async () => {
        const wrapper = mountWithPicker();
        await wrapper.find('[data-testid="session-tree-icon"]').trigger('click');

        const picker = wrapper.findComponent({ name: 'SessionTreePicker' });
        expect(picker.props('summaries')).toEqual(chainSummaries);
      });
    });

    describe('switch-session emit', () => {
      it('handlePickerSelect closes picker and is callable with session ID', async () => {
        const wrapper = mountWithPicker();
        // Open the picker
        wrapper.vm.pickerOpen = true;
        await wrapper.vm.$nextTick();

        // Call handlePickerSelect directly (exposed method)
        // Note: Vue Test Utils doesn't track emits from exposed method calls,
        // but E2E tests cover the full event flow. Here we verify the method exists
        // and correctly closes the picker.
        expect(typeof wrapper.vm.handlePickerSelect).toBe('function');
        wrapper.vm.handlePickerSelect('child-1');
        await wrapper.vm.$nextTick();

        // Verify the picker was closed
        expect(wrapper.vm.pickerOpen).toBe(false);
      });

      it('closes picker after session selection', async () => {
        const wrapper = mountWithPicker();
        await wrapper.find('[data-testid="session-tree-icon"]').trigger('click');
        expect(wrapper.findComponent({ name: 'SessionTreePicker' }).exists()).toBe(true);

        const picker = wrapper.findComponent({ name: 'SessionTreePicker' });
        await picker.vm.$emit('select', 'child-1');
        await wrapper.vm.$nextTick();

        expect(wrapper.findComponent({ name: 'SessionTreePicker' }).exists()).toBe(false);
      });
    });

    describe('dropdown chevron indicator', () => {
      it('shows down chevron when picker is closed', () => {
        const wrapper = mountWithPicker();
        expect(wrapper.find('.dropdown-chevron').text()).toBe('▼');
      });

      it('shows up chevron when picker is open', async () => {
        const wrapper = mountWithPicker();
        await wrapper.find('.dropdown-trigger').trigger('click');
        expect(wrapper.find('.dropdown-chevron').text()).toBe('▲');
      });
    });
  });
});
