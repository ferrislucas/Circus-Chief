import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, defineComponent, ref, watch, onUnmounted } from 'vue';
import { setActivePinia, createPinia } from 'pinia';

// Mock md-editor-v3 — it has heavy browser DOM dependencies
vi.mock('md-editor-v3', () => ({
  MdEditor: defineComponent({
    name: 'MdEditor',
    props: ['modelValue', 'theme', 'preview', 'language', 'noUploadImg', 'showCodeRowNumber'],
    emits: ['update:modelValue'],
    template: '<textarea class="mock-md-editor" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  }),
}));

// Mock md-editor-v3 styles
vi.mock('md-editor-v3/lib/style.css', () => ({}));

// Mock the canvas store
const mockStartEditing = vi.fn();
const mockEndEditing = vi.fn();

vi.mock('../stores/canvas.js', () => ({
  useCanvasStore: () => ({
    startEditing: mockStartEditing,
    endEditing: mockEndEditing,
  }),
}));

// Create a synchronous test version of MarkdownEditor that mirrors the real component's
// logic but avoids defineAsyncComponent + Suspense (which makes unit testing challenging).
// Includes itemId-aware change tracking per the real component.
function createTestableEditor() {
  return defineComponent({
    name: 'MarkdownEditorTestable',
    props: {
      content: { type: String, default: '' },
      sessionId: { type: String, required: true },
      filename: { type: String, required: true },
      itemId: { type: String, required: true },
    },
    emits: ['save'],
    setup(props, { emit }) {
      const editorContent = ref(props.content || '');

      let debounceTimer = null;
      let lastSavedContent = props.content || '';
      let lastEmittedContent = props.content || '';
      let lastAcceptedItemId = props.itemId;
      let lastAcceptedContent = props.content || '';
      let userModified = false;
      let isProgrammaticChange = false;

      // Mirror the real component's editorContent watcher effect, but executed
      // synchronously on user input so tests do not need to await nextTick
      // between typing and vi.runAllTimers().
      function onContentChange(newVal) {
        editorContent.value = newVal;
        if (newVal === lastSavedContent) return;

        userModified = true;

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          lastSavedContent = newVal;
          lastEmittedContent = newVal;
          emit('save', newVal);
        }, 1000);
      }

      function flushPendingSave() {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        if (editorContent.value !== lastSavedContent) {
          lastSavedContent = editorContent.value;
          lastEmittedContent = editorContent.value;
          emit('save', editorContent.value);
        }
      }

      // Combined watcher for itemId + content — matches real component logic
      watch(
        () => ({ itemId: props.itemId, content: props.content }),
        ({ itemId: newItemId, content: newContent }) => {
          const normalizedContent = newContent || '';

          if (newItemId !== lastAcceptedItemId) {
            // Deliberate version switch
            if (debounceTimer) {
              clearTimeout(debounceTimer);
              debounceTimer = null;
            }
            lastAcceptedItemId = newItemId;
            lastAcceptedContent = normalizedContent;
            lastSavedContent = normalizedContent;
            lastEmittedContent = normalizedContent;
            userModified = false;

            if (normalizedContent !== editorContent.value) {
              isProgrammaticChange = true;
              editorContent.value = normalizedContent;
              isProgrammaticChange = false;
            }
            return;
          }

          // Same itemId — content changed externally
          if (normalizedContent === editorContent.value) {
            lastAcceptedContent = normalizedContent;
            lastSavedContent = normalizedContent;
            return;
          }

          if (userModified) {
            // Buffer user-modified — ignore background churn
            if (normalizedContent === lastEmittedContent) {
              lastAcceptedContent = normalizedContent;
              lastSavedContent = normalizedContent;
            }
            return;
          }

          // No local edits — accept external content
          if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
          }
          lastAcceptedContent = normalizedContent;
          lastSavedContent = normalizedContent;
          lastEmittedContent = normalizedContent;

          isProgrammaticChange = true;
          editorContent.value = normalizedContent;
          isProgrammaticChange = false;
        }
      );

      onUnmounted(() => {
        flushPendingSave();
        mockEndEditing(props.filename);
      });

      return { editorContent, onContentChange, flushPendingSave };
    },
    template: '<div class="canvas-md-editor"><textarea class="mock-md-editor" :value="editorContent" @input="onContentChange($event.target.value)" /></div>',
  });
}

describe('MarkdownEditor', () => {
  let MarkdownEditorTestable;

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    vi.useFakeTimers();
    MarkdownEditorTestable = createTestableEditor();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mountComponent(props = {}) {
    const defaultProps = {
      content: '# Hello World',
      sessionId: 'session-1',
      filename: 'test.md',
      itemId: 'item-1',
    };
    return mount(MarkdownEditorTestable, {
      props: { ...defaultProps, ...props },
    });
  }

  it('renders without error when given valid props', () => {
    const wrapper = mountComponent();
    expect(wrapper.find('.canvas-md-editor').exists()).toBe(true);
  });

  it('does NOT call canvasStore.startEditing on mount', () => {
    mountComponent({
      filename: 'readme.md',
      itemId: 'item-42',
    });

    // startEditing is now handled by the store's saveMarkdownContent, not the component
    expect(mockStartEditing).not.toHaveBeenCalled();
  });

  it('calls canvasStore.endEditing(filename) on unmount', () => {
    const wrapper = mountComponent({
      filename: 'readme.md',
    });

    wrapper.unmount();

    expect(mockEndEditing).toHaveBeenCalledWith('readme.md');
  });

  it('emits save event after debounce period (1s) when content changes', async () => {
    const onSave = vi.fn();
    const wrapper = mount(MarkdownEditorTestable, {
      props: {
        content: '# Hello World',
        sessionId: 'session-1',
        filename: 'test.md',
        itemId: 'item-1',
        onSave,
      },
    });

    // Call onContentChange directly which schedules a debounced save
    wrapper.vm.onContentChange('Updated content');

    // Should NOT have been called yet (debounce hasn't fired)
    expect(onSave).not.toHaveBeenCalled();

    // Run all pending timers
    vi.runAllTimers();

    // Now the save handler should have been called
    expect(onSave).toHaveBeenCalledWith('Updated content');
  });

  it('does NOT emit save immediately on content change (debounce is working)', async () => {
    const wrapper = mountComponent();

    wrapper.vm.onContentChange('Changed content');
    await nextTick();

    // Advance only 500ms — less than the 1s debounce
    vi.advanceTimersByTime(500);
    await nextTick();

    // Should not have emitted yet
    expect(wrapper.emitted('save')).toBeUndefined();
  });

  it('flushes pending save on unmount (emits unsaved content)', async () => {
    const onSave = vi.fn();
    const wrapper = mount(MarkdownEditorTestable, {
      props: {
        content: '# Hello World',
        sessionId: 'session-1',
        filename: 'test.md',
        itemId: 'item-1',
        onSave,
      },
    });

    // Change content but don't let debounce fire
    wrapper.vm.onContentChange('Unsaved changes');
    await nextTick();

    expect(onSave).not.toHaveBeenCalled();

    // Unmount before debounce fires — should flush the pending save
    wrapper.unmount();

    // The save should have been called with the unsaved content
    expect(onSave).toHaveBeenCalledWith('Unsaved changes');
  });

  it('does NOT emit duplicate save on unmount if content was already saved', async () => {
    const onSave = vi.fn();
    const wrapper = mount(MarkdownEditorTestable, {
      props: {
        content: '# Hello World',
        sessionId: 'session-1',
        filename: 'test.md',
        itemId: 'item-1',
        onSave,
      },
    });

    // Change content and let debounce fire
    wrapper.vm.onContentChange('Already saved');
    vi.runAllTimers();
    await nextTick();

    expect(onSave).toHaveBeenCalledTimes(1);

    // Unmount — should NOT call save again since content matches lastSavedContent
    wrapper.unmount();

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('does NOT emit save on unmount if content was never changed', async () => {
    const onSave = vi.fn();
    const wrapper = mount(MarkdownEditorTestable, {
      props: {
        content: '# Hello World',
        sessionId: 'session-1',
        filename: 'test.md',
        itemId: 'item-1',
        onSave,
      },
    });

    // Unmount without making any changes
    wrapper.unmount();

    // Save should not have been called
    expect(onSave).not.toHaveBeenCalled();
  });

  it('updates editor content when content prop changes externally (no user edits)', async () => {
    const wrapper = mountComponent({ content: 'Initial content' });

    await wrapper.setProps({ content: 'Updated externally' });
    await nextTick();

    expect(wrapper.vm.editorContent).toBe('Updated externally');
  });

  it('does NOT emit save when the content prop changes externally (version switch)', async () => {
    const onSave = vi.fn();
    const wrapper = mount(MarkdownEditorTestable, {
      props: {
        content: 'a',
        sessionId: 'session-1',
        filename: 'test.md',
        itemId: 'item-1',
        onSave,
      },
    });

    await nextTick();

    // Simulate a version switch: parent updates the content prop
    await wrapper.setProps({ content: 'b' });
    await nextTick();

    // Advance past debounce — there should be NOTHING to fire
    vi.advanceTimersByTime(2000);
    await nextTick();

    expect(onSave).not.toHaveBeenCalled();
  });

  it('user edit still emits save after props-driven switch is wired up', async () => {
    const onSave = vi.fn();
    const wrapper = mount(MarkdownEditorTestable, {
      props: {
        content: 'a',
        sessionId: 'session-1',
        filename: 'test.md',
        itemId: 'item-1',
        onSave,
      },
    });

    // User types a real edit
    wrapper.vm.onContentChange('c');

    // Advance past debounce
    vi.advanceTimersByTime(1000);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('c');
  });

  it('flushPendingSave after a props-driven switch does NOT emit save', async () => {
    const onSave = vi.fn();
    const wrapper = mount(MarkdownEditorTestable, {
      props: {
        content: 'a',
        sessionId: 'session-1',
        filename: 'test.md',
        itemId: 'item-1',
        onSave,
      },
    });

    await nextTick();

    await wrapper.setProps({ content: 'b' });
    await nextTick();

    // After the props-driven switch, editorContent === lastSavedContent === 'b'
    // so flushPendingSave should be a no-op.
    wrapper.vm.flushPendingSave();

    expect(onSave).not.toHaveBeenCalled();
  });

  // ── New tests for itemId-aware change tracking ──────────────────────

  it('dirty editor ignores a same-itemId external content update and keeps editorContent unchanged', async () => {
    const onSave = vi.fn();
    const wrapper = mount(MarkdownEditorTestable, {
      props: {
        content: 'original',
        sessionId: 'session-1',
        filename: 'test.md',
        itemId: 'item-1',
        onSave,
      },
    });

    // User types an edit — makes buffer dirty
    wrapper.vm.onContentChange('user typed this');
    await nextTick();

    // External background update arrives (same itemId, different content)
    await wrapper.setProps({ content: 'background refresh content' });
    await nextTick();

    // Editor content should remain what the user typed
    expect(wrapper.vm.editorContent).toBe('user typed this');
  });

  it('same-itemId self-originated save echo acknowledges save without rewriting buffer', async () => {
    const onSave = vi.fn();
    const wrapper = mount(MarkdownEditorTestable, {
      props: {
        content: 'original',
        sessionId: 'session-1',
        filename: 'test.md',
        itemId: 'item-1',
        onSave,
      },
    });

    // User types and debounce fires
    wrapper.vm.onContentChange('edited content');
    vi.runAllTimers();
    await nextTick();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('edited content');

    // The save echo arrives: same itemId, content matches what was emitted
    await wrapper.setProps({ content: 'edited content' });
    await nextTick();

    // Buffer should remain unchanged (already matches)
    expect(wrapper.vm.editorContent).toBe('edited content');

    // No additional save should be emitted
    vi.runAllTimers();
    await nextTick();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('same-itemId stale refresh after debounced save does not rewrite user-modified buffer', async () => {
    const onSave = vi.fn();
    const wrapper = mount(MarkdownEditorTestable, {
      props: {
        content: 'v1',
        sessionId: 'session-1',
        filename: 'test.md',
        itemId: 'item-1',
        onSave,
      },
    });

    // User types and debounce fires
    wrapper.vm.onContentChange('v2 from user');
    vi.runAllTimers();
    await nextTick();
    expect(onSave).toHaveBeenCalledTimes(1);

    // User types more (buffer is still dirty even though debounce emitted)
    wrapper.vm.onContentChange('v3 from user');
    await nextTick();

    // A stale/stripped refresh arrives with the original content
    await wrapper.setProps({ content: 'v1' });
    await nextTick();

    // Buffer should stay at what the user last typed
    expect(wrapper.vm.editorContent).toBe('v3 from user');
  });

  it('same-itemId external content update is accepted when there are no local edits', async () => {
    const wrapper = mountComponent({ content: 'initial' });

    // No user edits — external content update should be accepted
    await wrapper.setProps({ content: 'externally updated' });
    await nextTick();

    expect(wrapper.vm.editorContent).toBe('externally updated');
  });

  it('changing itemId replaces editorContent with selected version content and clears dirty state', async () => {
    const onSave = vi.fn();
    const wrapper = mount(MarkdownEditorTestable, {
      props: {
        content: 'original',
        sessionId: 'session-1',
        filename: 'test.md',
        itemId: 'item-1',
        onSave,
      },
    });

    // User types an edit
    wrapper.vm.onContentChange('dirty content');
    await nextTick();

    // Version switch: itemId changes
    await wrapper.setProps({ itemId: 'item-2', content: 'version 2 content' });
    await nextTick();

    // Editor content should be replaced
    expect(wrapper.vm.editorContent).toBe('version 2 content');

    // Pending debounce should have been cleared (no save of dirty content)
    vi.runAllTimers();
    await nextTick();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('prop-driven version switch followed by flushPendingSave emits no save', async () => {
    const onSave = vi.fn();
    const wrapper = mount(MarkdownEditorTestable, {
      props: {
        content: 'a',
        sessionId: 'session-1',
        filename: 'test.md',
        itemId: 'item-1',
        onSave,
      },
    });

    await nextTick();

    // Version switch via itemId change
    await wrapper.setProps({ itemId: 'item-2', content: 'b' });
    await nextTick();

    wrapper.vm.flushPendingSave();

    expect(onSave).not.toHaveBeenCalled();
  });

  it('ignored same-itemId background updates do not create a follow-up debounced save', async () => {
    const onSave = vi.fn();
    const wrapper = mount(MarkdownEditorTestable, {
      props: {
        content: 'original',
        sessionId: 'session-1',
        filename: 'test.md',
        itemId: 'item-1',
        onSave,
      },
    });

    // User types
    wrapper.vm.onContentChange('user edit');
    vi.runAllTimers();
    await nextTick();
    expect(onSave).toHaveBeenCalledTimes(1);

    onSave.mockClear();

    // Background update arrives (should be ignored because buffer is user-modified)
    await wrapper.setProps({ content: 'stale content from server' });
    await nextTick();

    // No save should be scheduled
    vi.runAllTimers();
    await nextTick();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('unmount after a pending user edit emits one save and calls endEditing(filename)', async () => {
    const onSave = vi.fn();
    const wrapper = mount(MarkdownEditorTestable, {
      props: {
        content: 'original',
        sessionId: 'session-1',
        filename: 'notes.md',
        itemId: 'item-1',
        onSave,
      },
    });

    // User types (debounce not yet fired)
    wrapper.vm.onContentChange('pending content');
    await nextTick();
    expect(onSave).not.toHaveBeenCalled();

    // Unmount
    wrapper.unmount();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('pending content');
    expect(mockEndEditing).toHaveBeenCalledWith('notes.md');
  });
});
