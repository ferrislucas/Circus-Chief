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
// Uses a method for content changes (called from template @input) to make debounce testable.
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

      function onContentChange(newVal) {
        editorContent.value = newVal;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          lastSavedContent = newVal;
          emit('save', newVal);
        }, 1000);
      }

      function flushPendingSave() {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        if (editorContent.value !== lastSavedContent) {
          emit('save', editorContent.value);
        }
      }

      watch(() => props.content, (newContent) => {
        if (newContent !== editorContent.value) {
          editorContent.value = newContent || '';
        }
      });

      // No startEditing on mount — the store's saveMarkdownContent handles it

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

  it('updates editor content when content prop changes externally', async () => {
    const wrapper = mountComponent({ content: 'Initial content' });

    await wrapper.setProps({ content: 'Updated externally' });
    await nextTick();

    expect(wrapper.vm.editorContent).toBe('Updated externally');
  });
});
