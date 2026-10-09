import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import ModeSelector from './ModeSelector.vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useSessionPromptsStore } from '../stores/sessionPrompts.js';
import { useUiStore } from '../stores/ui.js';
import { SESSIONS_STORE_KEY } from '../composables/useOverlayStore.js';

const modes = [
  { value: 'plan', label: 'Plan' },
  { value: 'standard', label: 'Standard' },
  { value: 'yolo', label: 'YOLO' },
];

// Global helper to flush all async updates and force DOM re-render
async function flushAll(wrapper) {
  await flushPromises();
  await nextTick();
  if (wrapper && wrapper.vm) {
    await wrapper.vm.$nextTick?.();
  }
}

describe('ModeSelector', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const mountComponent = (props = {}, attrs = {}) => mount(ModeSelector, {
      props: {
        modelValue: 'yolo',
        ...props,
      },
      attrs,
    });

  describe('rendering', () => {
    it('renders a select dropdown', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('select').exists()).toBe(true);
    });

    it('renders all three mode options', () => {
      const wrapper = mountComponent();
      const options = wrapper.findAll('option');
      expect(options).toHaveLength(3);
    });

    it('displays mode labels in options', () => {
      const wrapper = mountComponent();
      const options = wrapper.findAll('option');
      expect(options[0].text()).toBe('Plan');
      expect(options[1].text()).toBe('Standard');
      expect(options[2].text()).toBe('YOLO');
    });

    it('sets correct values for options', () => {
      const wrapper = mountComponent();
      const options = wrapper.findAll('option');
      expect(options[0].element.value).toBe('plan');
      expect(options[1].element.value).toBe('standard');
      expect(options[2].element.value).toBe('yolo');
    });

    it('describes the active mode’s permission behavior', async () => {
      const wrapper = mountComponent({ modelValue: 'standard' });
      expect(wrapper.get('select').attributes('title')).toBe('Requests approval for each gated tool');
      await wrapper.get('select').setValue('yolo');
      expect(wrapper.get('select').attributes('title')).toBe('Automatically approves tool use');
    });
  });

  describe('selected state', () => {
    it('marks plan as selected when modelValue is plan', () => {
      const wrapper = mountComponent({ modelValue: 'plan' });
      const select = wrapper.find('select');
      expect(select.element.value).toBe('plan');
    });

    it('marks standard as selected when modelValue is standard', () => {
      const wrapper = mountComponent({ modelValue: 'standard' });
      const select = wrapper.find('select');
      expect(select.element.value).toBe('standard');
    });

    it('marks yolo as selected when modelValue is yolo', () => {
      const wrapper = mountComponent({ modelValue: 'yolo' });
      const select = wrapper.find('select');
      expect(select.element.value).toBe('yolo');
    });
  });

  describe('interactions', () => {
    it('emits update:modelValue when selection changes', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: 'yolo' },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      const select = wrapper.find('select');

      await select.setValue('plan');
      await flushAll(wrapper);

      expect(onUpdateModelValue).toHaveBeenCalledWith('plan');
    });

    it('emits correct mode value for each option', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: 'yolo' },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      const select = wrapper.find('select');

      // Change to plan
      await select.setValue('plan');
      await flushAll(wrapper);
      expect(onUpdateModelValue).toHaveBeenCalledWith('plan');

      // Change to standard
      await select.setValue('standard');
      await flushAll(wrapper);
      expect(onUpdateModelValue).toHaveBeenCalledWith('standard');

      expect(onUpdateModelValue).toHaveBeenCalledTimes(2);
    });

    it('does not emit when selecting the same mode', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: 'yolo' },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      const select = wrapper.find('select');

      await select.setValue('yolo');
      await flushAll(wrapper);

      expect(onUpdateModelValue).not.toHaveBeenCalled();
    });
  });

  describe('disabled state', () => {
    it('disables select when disabled prop is true', () => {
      const wrapper = mountComponent({ disabled: true });
      const select = wrapper.find('select');
      expect(select.element.disabled).toBe(true);
    });

    it('does not disable select when disabled prop is false', () => {
      const wrapper = mountComponent({ disabled: false });
      const select = wrapper.find('select');
      expect(select.element.disabled).toBe(false);
    });
  });

  describe('optimistic UI updates', () => {
    it('updates selection immediately on change (before async operation)', async () => {
      const wrapper = mountComponent({ modelValue: 'yolo' });
      let select = wrapper.find('select');

      // Initial value
      expect(select.element.value).toBe('yolo');

      // Change to plan
      await select.setValue('plan');
      await nextTick();

      select = wrapper.find('select');
      expect(select.element.value).toBe('plan');
    });

    it('emits update:modelValue immediately in form context', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: 'yolo' },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      const select = wrapper.find('select');

      await select.setValue('standard');
      await flushAll(wrapper);

      expect(onUpdateModelValue).toHaveBeenCalledWith('standard');
      expect(onUpdateModelValue).toHaveBeenCalledTimes(1);
    });
  });

  describe('workspace context with store updates', () => {
    it('updates store and maintains selection on success', async () => {
      const sessionsStore = useSessionsStore();
      const updateSessionModeSpy = vi.spyOn(sessionsStore, 'updateSessionMode').mockResolvedValue(undefined);

      // Set up the session store BEFORE creating the component
      sessionsStore.currentSession = {
        id: 'test-session',
        mode: 'yolo',
      };

      const wrapper = mountComponent({
        sessionId: 'test-session',
        modelValue: 'yolo',
      });

      await flushAll(wrapper);

      let select = wrapper.find('select');
      expect(select.element.value).toBe('yolo');

      // Change to plan
      await select.setValue('plan');
      await flushAll(wrapper);

      // Selection should be updated
      select = wrapper.find('select');
      expect(select.element.value).toBe('plan');

      // Wait for the store update to complete
      await flushAll(wrapper);

      // Store should have been called with the new mode
      expect(updateSessionModeSpy).toHaveBeenCalledWith('test-session', 'plan');

      updateSessionModeSpy.mockRestore();
    });

    it('calls store method with correct parameters on update', async () => {
      const sessionsStore = useSessionsStore();
      const updateSessionModeSpy = vi.spyOn(sessionsStore, 'updateSessionMode').mockResolvedValue(undefined);

      // Set up the session store BEFORE creating the component
      sessionsStore.currentSession = {
        id: 'test-session',
        mode: 'yolo',
      };

      const wrapper = mountComponent({
        sessionId: 'test-session',
        modelValue: 'yolo',
      });

      await flushAll(wrapper);

      const select = wrapper.find('select');

      // Change to standard
      await select.setValue('standard');
      await flushAll(wrapper);

      // Store method should have been called
      expect(updateSessionModeSpy).toHaveBeenCalledWith('test-session', 'standard');

      updateSessionModeSpy.mockRestore();
    });

    it('disables select while store update is in progress', async () => {
      const sessionsStore = useSessionsStore();
      let resolveUpdate;
      const updatePromise = new Promise(resolve => {
        resolveUpdate = resolve;
      });

      const updateSessionModeSpy = vi
        .spyOn(sessionsStore, 'updateSessionMode')
        .mockReturnValue(updatePromise);

      // Set up the session store BEFORE creating the component
      sessionsStore.currentSession = {
        id: 'test-session',
        mode: 'yolo',
      };

      const wrapper = mountComponent({
        sessionId: 'test-session',
        modelValue: 'yolo',
      });

      await flushAll(wrapper);

      let select = wrapper.find('select');
      expect(select.element.disabled).toBe(false);

      // Change to plan
      await select.setValue('plan');
      await flushAll(wrapper);

      // Re-query select to check disabled state
      select = wrapper.find('select');

      // Select should be disabled while updating
      expect(select.element.disabled).toBe(true);

      // Resolve the update
      resolveUpdate();
      await flushAll(wrapper);

      // Re-query select after update completes
      select = wrapper.find('select');

      // Select should be enabled again
      expect(select.element.disabled).toBe(false);

      updateSessionModeSpy.mockRestore();
    });
  });

  describe('watch observer for external changes', () => {
    it('renders correct selected state when mounted with different modelValue props', async () => {
      // Test mounting with plan
      const wrapper1 = mountComponent({ modelValue: 'plan' });
      await flushAll(wrapper1);
      let select = wrapper1.find('select');
      expect(select.element.value).toBe('plan');
      wrapper1.unmount();

      // Test mounting with standard
      const wrapper2 = mountComponent({ modelValue: 'standard' });
      await flushAll(wrapper2);
      select = wrapper2.find('select');
      expect(select.element.value).toBe('standard');
      wrapper2.unmount();

      // Test mounting with yolo
      const wrapper3 = mountComponent({ modelValue: 'yolo' });
      await flushAll(wrapper3);
      select = wrapper3.find('select');
      expect(select.element.value).toBe('yolo');
      wrapper3.unmount();
    });

    it('syncs selected value when workspace store updates', async () => {
      const sessionsStore = useSessionsStore();

      const wrapper = mountComponent({
        sessionId: 'test-session',
        modelValue: undefined,
      });

      sessionsStore.currentSession = {
        id: 'test-session',
        mode: 'yolo',
      };

      await flushAll(wrapper);

      let select = wrapper.find('select');
      expect(select.element.value).toBe('yolo');

      // Simulate session mode being updated in the store
      sessionsStore.currentSession.mode = 'plan';
      await flushAll(wrapper);

      select = wrapper.find('select');

      // Selection should sync with store change
      expect(select.element.value).toBe('plan');
    });
  });

  describe('muse agent copy (finding #2)', () => {
    it('says gated modes deny without prompting when agentType is muse', () => {
      const wrapper = mountComponent({ modelValue: 'standard', agentType: 'muse' });
      expect(wrapper.get('select').attributes('title')).toMatch(/denied without prompting/i);
    });

    it('says plan mode denies without prompting when agentType is muse', () => {
      const wrapper = mountComponent({ modelValue: 'plan', agentType: 'muse' });
      expect(wrapper.get('select').attributes('title')).toMatch(/denied without prompting/i);
    });

    it('keeps the auto-approve copy for muse yolo mode', () => {
      const wrapper = mountComponent({ modelValue: 'yolo', agentType: 'muse' });
      expect(wrapper.get('select').attributes('title')).toBe('Automatically approves tool use');
    });

    it('keeps generic copy for non-muse agents', () => {
      const wrapper = mountComponent({ modelValue: 'standard', agentType: 'codex' });
      expect(wrapper.get('select').attributes('title')).toBe('Requests approval for each gated tool');
    });

    it('reads muse agentType from the session store in session context', async () => {
      const sessionsStore = useSessionsStore();
      sessionsStore.currentSession = {
        id: 'muse-session',
        mode: 'standard',
        agentType: 'muse',
      };

      const wrapper = mountComponent({
        sessionId: 'muse-session',
        modelValue: undefined,
      });
      await flushAll(wrapper);

      expect(wrapper.get('select').attributes('title')).toMatch(/denied without prompting/i);
    });
  });

  describe('form context (v-model binding)', () => {
    it('works correctly with v-model in form context', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: 'yolo' },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );

      let select = wrapper.find('select');

      // Initial state
      expect(select.element.value).toBe('yolo');

      // Change to standard
      await select.setValue('standard');
      await flushAll(wrapper);

      // Should emit immediately
      expect(onUpdateModelValue).toHaveBeenCalledWith('standard');

      // Visual feedback should be immediate
      select = wrapper.find('select');
      expect(select.element.value).toBe('standard');
    });

    it('updates visual state and emits when user selects different options', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: 'yolo' },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      await flushAll(wrapper);

      let select = wrapper.find('select');
      expect(select.element.value).toBe('yolo');

      // Change to plan - visual state should update immediately
      await select.setValue('plan');
      await flushAll(wrapper);

      select = wrapper.find('select');
      expect(select.element.value).toBe('plan');

      // Emit should have been called
      expect(onUpdateModelValue).toHaveBeenCalledWith('plan');
    });
  });
});

describe('native planning badge', () => {
  // Mirrors the mount helper inside the outer describe (which is not in scope here).
  const mountBadge = (props = {}) => mount(ModeSelector, { props: { modelValue: 'yolo', ...props } });

  it('shows the badge when the session mirrors agent-initiated plan mode', async () => {
    const sessionsStore = useSessionsStore();
    sessionsStore.currentSession = { id: 'sess-1', mode: 'yolo', agentPermissionMode: 'plan' };

    const wrapper = mountBadge({ sessionId: 'sess-1' });
    await flushAll(wrapper);

    expect(wrapper.find('.planning-badge').exists()).toBe(true);
    expect(wrapper.text()).toContain('Planning');
  });

  it('hides the badge without a session context or when the agent is not planning', async () => {
    const sessionsStore = useSessionsStore();
    sessionsStore.currentSession = { id: 'sess-2', mode: 'plan', agentPermissionMode: null };

    const formContext = mountBadge();
    await flushAll(formContext);
    expect(formContext.find('.planning-badge').exists()).toBe(false);

    const notPlanning = mountBadge({ sessionId: 'sess-2' });
    await flushAll(notPlanning);
    expect(notPlanning.find('.planning-badge').exists()).toBe(false);
  });

  it('navigates to the pending plan card when the badge is activated', async () => {
    const sessionsStore = useSessionsStore();
    sessionsStore.currentSession = { id: 'sess-1', mode: 'yolo', agentPermissionMode: 'plan' };
    const promptsStore = useSessionPromptsStore();
    promptsStore.prompts['sess-1'] = {
      id: 'plan-1',
      sessionId: 'sess-1',
      kind: 'plan',
      payload: { toolName: 'ExitPlanMode', input: { plan: '# the plan' } },
    };

    // The badge resolves its card inside its own conversation view, so the
    // wrapper mounts attached within one.
    const view = document.createElement('div');
    view.className = 'conversation-tab';
    document.body.appendChild(view);
    const wrapper = mount(ModeSelector, {
      props: { modelValue: 'yolo', sessionId: 'sess-1' },
      attachTo: view,
    });
    await flushAll(wrapper);

    const badge = wrapper.find('.planning-badge');
    expect(badge.element.tagName).toBe('BUTTON');

    const card = document.createElement('section');
    card.className = 'agent-prompt-card agent-prompt-card--plan';
    const approve = document.createElement('button');
    approve.className = 'btn prompt-primary-action';
    card.appendChild(approve);
    view.appendChild(card);
    // jsdom does not implement scrollIntoView — stub it on the instance.
    card.scrollIntoView = vi.fn();
    const focusSpy = vi.spyOn(approve, 'focus').mockImplementation(() => {});
    try {
      await badge.trigger('click');
      expect(card.scrollIntoView).toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalled();
    } finally {
      focusSpy.mockRestore();
      wrapper.unmount();
      view.remove();
    }
  });

  it('keeps the badge non-interactive when no plan card is pending', async () => {
    const sessionsStore = useSessionsStore();
    sessionsStore.currentSession = { id: 'sess-1', mode: 'yolo', agentPermissionMode: 'plan' };

    const wrapper = mountBadge({ sessionId: 'sess-1' });
    await flushAll(wrapper);

    const badge = wrapper.find('.planning-badge');
    expect(badge.exists()).toBe(true);
    expect(badge.element.tagName).toBe('SPAN');
  });
});

describe('planning badge view scoping (finding #8)', () => {
  const planPrompt = (sessionId, id) => ({
    id,
    sessionId,
    kind: 'plan',
    payload: { toolName: 'ExitPlanMode', input: { plan: '# the plan' } },
  });

  const scopedSession = (sessionId) => ({
    currentSession: { id: sessionId, mode: 'yolo', agentPermissionMode: 'plan' },
  });

  function makeCard() {
    const card = document.createElement('section');
    card.className = 'agent-prompt-card agent-prompt-card--plan';
    const approve = document.createElement('button');
    approve.className = 'btn prompt-primary-action';
    approve.textContent = 'Approve plan';
    card.appendChild(approve);
    document.body.appendChild(card);
    card.scrollIntoView = vi.fn();
    const focusSpy = vi.spyOn(approve, 'focus').mockImplementation(() => {});
    return { card, approve, focusSpy };
  }

  function makeView() {
    const view = document.createElement('div');
    view.className = 'conversation-tab';
    document.body.appendChild(view);
    return view;
  }

  const mountInView = (sessionId, view) => mount(ModeSelector, {
    props: { sessionId, modelValue: 'yolo' },
    attachTo: view,
    global: { provide: { [SESSIONS_STORE_KEY]: scopedSession(sessionId) } },
  });

  it("targets only its own view's plan card with two concurrent conversations", async () => {
    const promptsStore = useSessionPromptsStore();
    promptsStore.prompts['sess-a'] = planPrompt('sess-a', 'plan-a');
    promptsStore.prompts['sess-b'] = planPrompt('sess-b', 'plan-b');

    // Session A's card is first in document order, so a global
    // querySelector would resolve to it from either badge.
    const viewA = makeView();
    const viewB = makeView();
    const a = makeCard();
    const b = makeCard();
    viewA.appendChild(a.card);
    viewB.appendChild(b.card);

    const wrapperA = mountInView('sess-a', viewA);
    const wrapperB = mountInView('sess-b', viewB);
    await flushAll(wrapperA);
    await flushAll(wrapperB);
    try {
      expect(wrapperA.find('.planning-badge').element.tagName).toBe('BUTTON');
      expect(wrapperB.find('.planning-badge').element.tagName).toBe('BUTTON');

      await wrapperB.find('.planning-badge').trigger('click');
      expect(b.card.scrollIntoView).toHaveBeenCalled();
      expect(b.focusSpy).toHaveBeenCalled();
      expect(a.card.scrollIntoView).not.toHaveBeenCalled();
      expect(a.focusSpy).not.toHaveBeenCalled();

      a.card.scrollIntoView.mockClear();
      b.card.scrollIntoView.mockClear();
      a.focusSpy.mockClear();
      b.focusSpy.mockClear();

      await wrapperA.find('.planning-badge').trigger('click');
      expect(a.card.scrollIntoView).toHaveBeenCalled();
      expect(a.focusSpy).toHaveBeenCalled();
      expect(b.card.scrollIntoView).not.toHaveBeenCalled();
      expect(b.focusSpy).not.toHaveBeenCalled();
    } finally {
      wrapperA.unmount();
      wrapperB.unmount();
      a.focusSpy.mockRestore();
      b.focusSpy.mockRestore();
      viewA.remove();
      viewB.remove();
      a.card.remove();
      b.card.remove();
    }
  });

  it('does not fall back to another view’s card when its own view has none', async () => {
    const promptsStore = useSessionPromptsStore();
    promptsStore.prompts['sess-c'] = planPrompt('sess-c', 'plan-c');
    promptsStore.prompts['sess-d'] = planPrompt('sess-d', 'plan-d');

    const viewC = makeView();
    const viewD = makeView();
    const d = makeCard();
    viewD.appendChild(d.card);

    const wrapperC = mountInView('sess-c', viewC);
    const wrapperD = mountInView('sess-d', viewD);
    await flushAll(wrapperC);
    await flushAll(wrapperD);
    try {
      // C's badge is actionable (its prompt is pending) but its view renders
      // no card — activation must be a safe no-op, not a jump to D's card.
      expect(wrapperC.find('.planning-badge').element.tagName).toBe('BUTTON');
      await wrapperC.find('.planning-badge').trigger('click');
      expect(d.card.scrollIntoView).not.toHaveBeenCalled();
      expect(d.focusSpy).not.toHaveBeenCalled();
    } finally {
      wrapperC.unmount();
      wrapperD.unmount();
      d.focusSpy.mockRestore();
      viewC.remove();
      viewD.remove();
      d.card.remove();
    }
  });

  it('stays local when the same session appears in two views', async () => {
    const promptsStore = useSessionPromptsStore();
    promptsStore.prompts['sess-s'] = planPrompt('sess-s', 'plan-s');

    const viewOne = makeView();
    const viewTwo = makeView();
    const one = makeCard();
    const two = makeCard();
    viewOne.appendChild(one.card);
    viewTwo.appendChild(two.card);

    const wrapperOne = mountInView('sess-s', viewOne);
    const wrapperTwo = mountInView('sess-s', viewTwo);
    await flushAll(wrapperOne);
    await flushAll(wrapperTwo);
    try {
      await wrapperTwo.find('.planning-badge').trigger('click');
      expect(two.card.scrollIntoView).toHaveBeenCalled();
      expect(two.focusSpy).toHaveBeenCalled();
      expect(one.card.scrollIntoView).not.toHaveBeenCalled();
      expect(one.focusSpy).not.toHaveBeenCalled();
    } finally {
      wrapperOne.unmount();
      wrapperTwo.unmount();
      one.focusSpy.mockRestore();
      two.focusSpy.mockRestore();
      viewOne.remove();
      viewTwo.remove();
      one.card.remove();
      two.card.remove();
    }
  });
});
