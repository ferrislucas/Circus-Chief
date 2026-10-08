import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { setActivePinia, createPinia } from 'pinia';

// The production component loads md-editor-v3 through defineAsyncComponent.
// Replace that loader before MarkdownEditor is imported so this test never
// starts CodeMirror (which requires browser range-layout APIs unavailable in
// jsdom). Unlike mocking the dynamic import, this remains deterministic when
// coverage changes module-loading timing.
vi.mock('vue', async (importOriginal) => {
  const vue = await importOriginal();
  return {
    ...vue,
    defineAsyncComponent: () => ({
      name: 'MdEditorAsync',
      props: ['modelValue'],
      emits: ['update:modelValue'],
      template: '<textarea class="mock-md-editor" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    }),
  };
});

vi.mock('../stores/canvas.js', () => ({
  useCanvasStore: () => ({
    startEditing: vi.fn(),
    endEditing: vi.fn(),
  }),
}));

import MarkdownEditor from './MarkdownEditor.vue';

// Step 4 of the canvas-checkbox plan: an incoming toggle patch (same itemId,
// new content over WebSocket) must not destroy an unsaved editor buffer, but
// a clean buffer adopts it. The real component is mounted here.
describe('MarkdownEditor external toggle updates', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  async function mountEditor(content) {
    const wrapper = mount(MarkdownEditor, {
      props: { content, sessionId: 'sess-1', filename: 'plan.md', itemId: 'item-1' },
    });
    for (let i = 0; i < 50 && !wrapper.find('.mock-md-editor').exists(); i++) {
      await flushPromises();
      await nextTick();
    }
    return wrapper;
  }

  function editorValue(wrapper) {
    return wrapper.find('.mock-md-editor').element.value;
  }

  it('clean buffer adopts external content (incoming toggle)', async () => {
    const wrapper = await mountEditor('- [ ] todo');
    expect(editorValue(wrapper)).toBe('- [ ] todo');

    await wrapper.setProps({ content: '- [x] todo' });
    await flushPromises();
    await nextTick();

    expect(editorValue(wrapper)).toBe('- [x] todo');
  });

  it('dirty buffer is preserved when a toggle patch arrives', async () => {
    const wrapper = await mountEditor('- [ ] todo');
    await wrapper.find('.mock-md-editor').setValue('- [ ] user typing');
    await nextTick();
    expect(editorValue(wrapper)).toBe('- [ ] user typing');

    await wrapper.setProps({ content: '- [x] todo' });
    await nextTick();

    expect(editorValue(wrapper)).toBe('- [ ] user typing');
  });

  it('version switch replaces even a dirty buffer', async () => {
    const wrapper = await mountEditor('- [ ] todo');
    await wrapper.find('.mock-md-editor').setValue('- [ ] user typing');
    await nextTick();

    await wrapper.setProps({ itemId: 'item-2', content: '- [x] v2' });
    await nextTick();

    expect(editorValue(wrapper)).toBe('- [x] v2');
  });
});
