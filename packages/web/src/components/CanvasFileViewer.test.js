import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, defineComponent } from 'vue';
import { setActivePinia, createPinia } from 'pinia';

// Mock md-editor-v3 — used by MarkdownEditor component
vi.mock('md-editor-v3', () => ({
  MdEditor: defineComponent({
    name: 'MdEditor',
    props: ['modelValue', 'theme', 'preview', 'language', 'noUploadImg', 'showCodeRowNumber'],
    emits: ['update:modelValue'],
    template: '<textarea class="mock-md-editor" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  }),
}));
vi.mock('md-editor-v3/lib/style.css', () => ({}));

// Mock the API module before importing component
vi.mock('../composables/useApi.js', () => ({
  api: {
    getCanvasItems: vi.fn().mockResolvedValue([]),
    getAllCanvasItems: vi.fn().mockResolvedValue([]),
    getCanvasFileContent: vi.fn().mockResolvedValue({ content: null, data: null }),
    getCanvasItemContent: vi.fn().mockResolvedValue({ content: null, data: null }),
    updateCanvasItem: vi.fn(),
    uploadCanvasItem: vi.fn(),
    deleteCanvasItem: vi.fn(),
    getCanvasTrash: vi.fn().mockResolvedValue([]),
    recoverCanvasItem: vi.fn(),
    recoverCanvasFile: vi.fn(),
    permanentlyDeleteCanvasItem: vi.fn(),
  },
}));

import CanvasFileViewer from './CanvasFileViewer.vue';
import { api } from '../composables/useApi.js';
import { useUiStore } from '../stores/ui.js';

// Global helper to flush all async updates
async function flushAll(wrapper) {
  await flushPromises();
  await nextTick();
  if (wrapper && wrapper.vm) {
    await wrapper.vm.$nextTick?.();
    await wrapper.vm.$forceUpdate();
    await nextTick();
  }
}

// Stub for MarkdownViewer
const MarkdownViewerStub = defineComponent({
  name: 'MarkdownViewer',
  props: ['content'],
  template: '<div class="markdown-viewer-stub">{{ content }}</div>',
});

describe('CanvasFileViewer', () => {
  let mockClipboard;

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    // Mock clipboard API
    mockClipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
    };
    Object.defineProperty(navigator, 'clipboard', {
      value: mockClipboard,
      configurable: true,
    });
    // Mock timers for copy feedback
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mountComponent(props = {}) {
    const defaultProps = {
      item: { id: '1', filename: 'test.txt', type: 'text', content: 'Hello', createdAt: Date.now() },
      sessionId: 'test-session',
      versions: [],
      showBackButton: true,
    };
    return mount(CanvasFileViewer, {
      props: { ...defaultProps, ...props },
      global: {
        stubs: {
          MarkdownViewer: MarkdownViewerStub,
        },
      },
    });
  }

  describe('rendering', () => {
    it('displays filename in header', () => {
      const wrapper = mountComponent({
        item: { id: '1', filename: 'myfile.txt', type: 'text', content: 'Content', createdAt: Date.now() },
      });

      expect(wrapper.find('.viewer-filename').text()).toBe('myfile.txt');
    });

    it('displays Untitled when filename is missing', () => {
      const wrapper = mountComponent({
        item: { id: '1', type: 'text', content: 'Content', createdAt: Date.now() },
      });

      expect(wrapper.find('.viewer-filename').text()).toBe('Untitled');
    });

    it('always shows breadcrumb navigation', () => {
      const wrapper = mountComponent();

      expect(wrapper.find('.breadcrumb-back').exists()).toBe(true);
      expect(wrapper.find('.breadcrumb-separator').exists()).toBe(false);
      expect(wrapper.find('.breadcrumb-back').text()).toBe('← Back to list');
    });
  });

  describe('three-dot menu', () => {
    it('renders menu button in header', () => {
      const wrapper = mountComponent();

      expect(wrapper.find('.btn-menu').exists()).toBe(true);
    });

    it('opens menu when button is clicked', async () => {
      const wrapper = mountComponent();

      expect(wrapper.find('.file-menu-items').exists()).toBe(false);

      const menuButton = wrapper.find('.btn-menu');
      await menuButton.trigger('click');
      await flushAll(wrapper);

      expect(wrapper.find('.file-menu-items').exists()).toBe(true);
    });

    it('shows copy filename and delete options', async () => {
      const wrapper = mountComponent();

      const menuButton = wrapper.find('.btn-menu');
      await menuButton.trigger('click');
      await flushAll(wrapper);

      const menuItems = wrapper.findAll('.menu-item');
      expect(menuItems.length).toBe(2);
      expect(menuItems[0].text()).toContain('Copy filename');
      expect(menuItems[1].text()).toContain('Delete file');
    });

    it('copies filename when menu option is clicked', async () => {
      const wrapper = mountComponent({
        item: { id: '1', filename: 'myfile.txt', type: 'text', content: 'Content', createdAt: Date.now() },
      });

      const menuButton = wrapper.find('.btn-menu');
      await menuButton.trigger('click');
      await flushAll(wrapper);

      const menuItems = wrapper.findAll('.menu-item');
      await menuItems[0].trigger('click');
      await flushAll(wrapper);

      expect(mockClipboard.writeText).toHaveBeenCalledWith('myfile.txt');
    });

    it('shows delete file option with version count when multiple versions exist', async () => {
      const wrapper = mountComponent({
        item: { id: '2', filename: 'test.txt', type: 'text', content: 'Content', createdAt: 2000 },
        versions: [
          { id: '1', createdAt: 1000 },
          { id: '2', createdAt: 2000 },
        ],
      });

      const menuButton = wrapper.find('.btn-menu');
      await menuButton.trigger('click');
      await flushAll(wrapper);

      const menuItems = wrapper.findAll('.menu-item');
      expect(menuItems.length).toBe(2);
      expect(menuItems[1].text()).toContain('Delete file');
    });
  });

  describe('version dropdown', () => {
    it('hides version dropdown when only one version', () => {
      const wrapper = mountComponent({
        versions: [{ id: '1', createdAt: Date.now() }],
      });

      expect(wrapper.find('.version-dropdown').exists()).toBe(false);
    });

    it('shows version dropdown when multiple versions', () => {
      const wrapper = mountComponent({
        item: { id: '2', filename: 'test.txt', type: 'text', content: 'Content', createdAt: 2000 },
        versions: [
          { id: '1', createdAt: 1000 },
          { id: '2', createdAt: 2000 },
        ],
      });

      expect(wrapper.find('.version-dropdown').exists()).toBe(true);
    });
  });

  describe('content rendering', () => {
    it('renders image for image type', () => {
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'photo.png',
          type: 'image',
          data: 'base64data',
          mimeType: 'image/png',
          createdAt: Date.now(),
        },
      });

      expect(wrapper.find('.viewer-image').exists()).toBe(true);
    });

    it('renders text content for text type', () => {
      const wrapper = mountComponent({
        item: { id: '1', filename: 'test.txt', type: 'text', content: 'Hello World', createdAt: Date.now() },
      });

      expect(wrapper.find('.viewer-text').exists()).toBe(true);
      expect(wrapper.find('.viewer-text').text()).toBe('Hello World');
    });

    it('renders JSON content for json type', () => {
      const wrapper = mountComponent({
        item: { id: '1', filename: 'data.json', type: 'json', data: '{"key":"value"}', createdAt: Date.now() },
      });

      expect(wrapper.find('.viewer-json').exists()).toBe(true);
    });
  });

  describe('formatLastModified display', () => {
    it('displays empty string when updatedAt is null', () => {
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'test.txt',
          type: 'text',
          content: 'Content',
          createdAt: Date.now(),
          updatedAt: null,
        },
      });

      const metaElement = wrapper.find('.viewer-header-bottom .viewer-meta');
      expect(metaElement.exists()).toBe(true);
      expect(metaElement.text()).toBe('');
    });

    it('displays "Modified just now" for very recent timestamps', () => {
      const now = Date.now();
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'test.txt',
          type: 'text',
          content: 'Content',
          createdAt: now,
          updatedAt: now,
        },
      });

      const metaElement = wrapper.find('.viewer-header-bottom .viewer-meta');
      expect(metaElement.exists()).toBe(true);
      expect(metaElement.text()).toBe('Modified just now');
    });

    it('displays "Modified Xm ago" for minutes old', () => {
      const now = Date.now();
      const fiveMinutesAgo = now - 5 * 60 * 1000;
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'test.txt',
          type: 'text',
          content: 'Content',
          createdAt: fiveMinutesAgo,
          updatedAt: fiveMinutesAgo,
        },
      });

      const metaElement = wrapper.find('.viewer-header-bottom .viewer-meta');
      expect(metaElement.text()).toBe('Modified 5m ago');
    });

    it('displays "Modified Xh ago" for hours old', () => {
      const now = Date.now();
      const twoHoursAgo = now - 2 * 60 * 60 * 1000;
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'test.txt',
          type: 'text',
          content: 'Content',
          createdAt: twoHoursAgo,
          updatedAt: twoHoursAgo,
        },
      });

      const metaElement = wrapper.find('.viewer-header-bottom .viewer-meta');
      expect(metaElement.text()).toBe('Modified 2h ago');
    });

    it('displays "Modified Xd ago" for days old', () => {
      const now = Date.now();
      const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'test.txt',
          type: 'text',
          content: 'Content',
          createdAt: threeDaysAgo,
          updatedAt: threeDaysAgo,
        },
      });

      const metaElement = wrapper.find('.viewer-header-bottom .viewer-meta');
      expect(metaElement.text()).toBe('Modified 3d ago');
    });

    it('handles edge case of exactly 1 minute', () => {
      const now = Date.now();
      const oneMinuteAgo = now - 60 * 1000;
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'test.txt',
          type: 'text',
          content: 'Content',
          createdAt: oneMinuteAgo,
          updatedAt: oneMinuteAgo,
        },
      });

      const metaElement = wrapper.find('.viewer-header-bottom .viewer-meta');
      expect(metaElement.text()).toBe('Modified 1m ago');
    });

    it('handles edge case of exactly 1 hour', () => {
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'test.txt',
          type: 'text',
          content: 'Content',
          createdAt: oneHourAgo,
          updatedAt: oneHourAgo,
        },
      });

      const metaElement = wrapper.find('.viewer-header-bottom .viewer-meta');
      expect(metaElement.text()).toBe('Modified 1h ago');
    });

    it('updates display when item changes', async () => {
      const now = Date.now();
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'test.txt',
          type: 'text',
          content: 'Content',
          createdAt: now,
          updatedAt: now,
        },
      });

      // Initially shows "just now"
      expect(wrapper.find('.viewer-header-bottom .viewer-meta').text()).toBe('Modified just now');

      // Update to an older timestamp
      const oneHourAgo = now - 60 * 60 * 1000;
      await wrapper.setProps({
        item: {
          id: '1',
          filename: 'test.txt',
          type: 'text',
          content: 'Content',
          createdAt: oneHourAgo,
          updatedAt: oneHourAgo,
        },
      });
      await flushAll(wrapper);

      // Should now show "1h ago"
      expect(wrapper.find('.viewer-header-bottom .viewer-meta').text()).toBe('Modified 1h ago');
    });
  });

  describe('edit mode for markdown files', () => {
    it('shows Edit button for markdown items', () => {
      const wrapper = mountComponent({
        item: { id: '1', filename: 'readme.md', type: 'markdown', content: '# Hello', createdAt: Date.now() },
      });

      expect(wrapper.find('.btn-edit-toggle').exists()).toBe(true);
      expect(wrapper.find('.btn-edit-toggle').text()).toBe('Edit');
    });

    it('does NOT show Edit button for non-markdown items (text)', () => {
      const wrapper = mountComponent({
        item: { id: '1', filename: 'notes.txt', type: 'text', content: 'Hello', createdAt: Date.now() },
      });

      expect(wrapper.find('.btn-edit-toggle').exists()).toBe(false);
    });

    it('does NOT show Edit button for image items', () => {
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'photo.png',
          type: 'image',
          data: 'base64data',
          mimeType: 'image/png',
          createdAt: Date.now(),
        },
      });

      expect(wrapper.find('.btn-edit-toggle').exists()).toBe(false);
    });

    it('toggles to Done when Edit is clicked', async () => {
      const wrapper = mountComponent({
        item: { id: '1', filename: 'readme.md', type: 'markdown', content: '# Hello', createdAt: Date.now() },
      });

      const editBtn = wrapper.find('.btn-edit-toggle');
      expect(editBtn.text()).toBe('Edit');

      await editBtn.trigger('click');
      await flushAll(wrapper);

      expect(wrapper.find('.btn-edit-toggle').text()).toBe('Done');
    });

    it('shows MarkdownViewer in read mode and hides it in edit mode', async () => {
      const wrapper = mountComponent({
        item: { id: '1', filename: 'readme.md', type: 'markdown', content: '# Hello', createdAt: Date.now() },
      });

      // In read mode, the viewer-markdown element should be visible (not editing)
      expect(wrapper.find('.viewer-markdown').exists()).toBe(true);
      expect(wrapper.find('.viewer-content-editing').exists()).toBe(false);

      // Click Edit
      await wrapper.find('.btn-edit-toggle').trigger('click');
      await flushAll(wrapper);

      // In edit mode, should show editing container and hide MarkdownViewer
      expect(wrapper.find('.viewer-content-editing').exists()).toBe(true);
      expect(wrapper.find('.viewer-markdown').exists()).toBe(false);
    });

    it('returns to read mode when Done is clicked', async () => {
      const wrapper = mountComponent({
        item: { id: '1', filename: 'readme.md', type: 'markdown', content: '# Hello', createdAt: Date.now() },
      });

      // Enter edit mode
      await wrapper.find('.btn-edit-toggle').trigger('click');
      await flushAll(wrapper);
      expect(wrapper.find('.btn-edit-toggle').text()).toBe('Done');

      // Exit edit mode
      await wrapper.find('.btn-edit-toggle').trigger('click');
      await flushAll(wrapper);

      expect(wrapper.find('.btn-edit-toggle').text()).toBe('Edit');
      expect(wrapper.find('.viewer-markdown').exists()).toBe(true);
      expect(wrapper.find('.viewer-content-editing').exists()).toBe(false);
    });

    it('calls endEditing when component unmounts while in edit mode', async () => {
      const { useCanvasStore } = await import('../stores/canvas.js');
      const store = useCanvasStore();
      const endEditingSpy = vi.spyOn(store, 'endEditing');

      const wrapper = mountComponent({
        item: { id: '1', filename: 'readme.md', type: 'markdown', content: '# Hello', createdAt: Date.now() },
      });

      // Enter edit mode
      await wrapper.find('.btn-edit-toggle').trigger('click');
      await flushAll(wrapper);

      // Unmount while editing
      wrapper.unmount();

      expect(endEditingSpy).toHaveBeenCalledWith('readme.md');
    });
  });

  describe('editing-change events', () => {
    it('emits editingChange with editing:true when Edit is clicked', async () => {
      const onEditingChange = vi.fn();
      const wrapper = mount(CanvasFileViewer, {
        props: {
          item: { id: 'item-1', filename: 'readme.md', type: 'markdown', content: '# Hello', createdAt: Date.now() },
          sessionId: 'test-session',
          versions: [],
          showBackButton: true,
          onEditingChange,
        },
        global: {
          stubs: {
            MarkdownViewer: MarkdownViewerStub,
          },
        },
      });

      wrapper.vm.toggleEditing();
      await flushAll(wrapper);

      expect(onEditingChange).toHaveBeenCalledTimes(1);
      expect(onEditingChange).toHaveBeenCalledWith({
        editing: true,
        filename: 'readme.md',
        itemId: 'item-1',
      });
    });

    it('clicking Done emits editingChange with editing:false', async () => {
      const onEditingChange = vi.fn();
      const wrapper = mount(CanvasFileViewer, {
        props: {
          item: { id: 'item-1', filename: 'readme.md', type: 'markdown', content: '# Hello', createdAt: Date.now() },
          sessionId: 'test-session',
          versions: [],
          showBackButton: true,
          onEditingChange,
        },
        global: {
          stubs: {
            MarkdownViewer: MarkdownViewerStub,
          },
        },
      });

      // Enter edit mode
      wrapper.vm.toggleEditing();
      await flushAll(wrapper);

      // Exit edit mode (Done)
      wrapper.vm.toggleEditing();
      await flushAll(wrapper);

      expect(onEditingChange).toHaveBeenCalledTimes(2);
      expect(onEditingChange).toHaveBeenNthCalledWith(1, {
        editing: true,
        filename: 'readme.md',
        itemId: 'item-1',
      });
      expect(onEditingChange).toHaveBeenNthCalledWith(2, {
        editing: false,
        filename: 'readme.md',
        itemId: 'item-1',
      });
    });

    it('emits editingChange with editing:false on unmount while editing and calls endEditing', async () => {
      const { useCanvasStore } = await import('../stores/canvas.js');
      const store = useCanvasStore();
      const endEditingSpy = vi.spyOn(store, 'endEditing');

      const onEditingChange = vi.fn();
      const wrapper = mount(CanvasFileViewer, {
        props: {
          item: { id: 'item-1', filename: 'readme.md', type: 'markdown', content: '# Hello', createdAt: Date.now() },
          sessionId: 'test-session',
          versions: [],
          showBackButton: true,
          onEditingChange,
        },
        global: {
          stubs: {
            MarkdownViewer: MarkdownViewerStub,
          },
        },
      });

      // Enter edit mode
      wrapper.vm.toggleEditing();
      await flushAll(wrapper);

      // Unmount
      wrapper.unmount();

      expect(onEditingChange).toHaveBeenCalledTimes(2);
      expect(onEditingChange).toHaveBeenNthCalledWith(2, {
        editing: false,
        filename: 'readme.md',
        itemId: 'item-1',
      });
      expect(endEditingSpy).toHaveBeenCalledWith('readme.md');
    });
  });
});

describe('CanvasFileViewer task-list toggles', () => {
  // NOTE: the real MarkdownViewer is used here (the file's MarkdownViewer
  // stub key does not match the script-setup child, so the real component
  // renders). Toggles are driven through real bubbling DOM events.
  function mountMarkdown(props = {}) {
    const defaultProps = {
      item: { id: 'item-1', filename: 'plan.md', type: 'markdown', content: '- [ ] todo', createdAt: Date.now() },
      sessionId: 'sess-1',
      versions: [],
      showBackButton: true,
    };
    return mount(CanvasFileViewer, {
      props: { ...defaultProps, ...props },
    });
  }

  function clickCheckbox(wrapper, line) {
    wrapper.find(`input[data-task-line="${line}"]`).element.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
  }

  function checkboxChecked(wrapper, line) {
    return wrapper.find(`input[data-task-line="${line}"]`).element.checked;
  }

  beforeEach(() => {
    api.updateCanvasItem.mockResolvedValue({ content: '- [x] todo', updatedAt: Date.now() });
  });

  it('saves toggles in place via PUT with the flipped line', async () => {
    const wrapper = mountMarkdown();
    clickCheckbox(wrapper, 0);
    await flushAll(wrapper);

    expect(api.updateCanvasItem).toHaveBeenCalledTimes(1);
    expect(api.updateCanvasItem).toHaveBeenCalledWith('sess-1', 'item-1', { content: '- [x] todo' });
    expect(checkboxChecked(wrapper, 0)).toBe(true);
  });

  it('reverts content and toasts on save failure', async () => {
    api.updateCanvasItem.mockRejectedValue(new Error('nope'));
    const wrapper = mountMarkdown();
    clickCheckbox(wrapper, 0);
    await flushAll(wrapper);

    expect(checkboxChecked(wrapper, 0)).toBe(false);
    expect(useUiStore().toasts.some((t) => t.type === 'error')).toBe(true);
  });

  it('ignores toggles for non-task lines without saving', async () => {
    const wrapper = mountMarkdown({
      item: { id: 'item-1', filename: 'plan.md', type: 'markdown', content: '# Hello', createdAt: Date.now() },
    });
    // A checkbox pointing at a non-task line (malformed DOM): no save.
    const viewer = wrapper.find('.viewer-markdown').element;
    const rogue = document.createElement('input');
    rogue.setAttribute('type', 'checkbox');
    rogue.setAttribute('data-task-line', '0');
    viewer.appendChild(rogue);
    rogue.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushAll(wrapper);

    expect(api.updateCanvasItem).not.toHaveBeenCalled();
  });

  it('renders historical versions disabled and latest enabled', async () => {
    const versions = [
      { id: 'v2', createdAt: 2000 },
      { id: 'v1', createdAt: 1000 },
    ];
    const historical = mountMarkdown({
      item: { id: 'v1', filename: 'plan.md', type: 'markdown', content: '- [ ] todo', createdAt: 1000 },
      versions,
    });
    await flushAll(historical);
    expect(historical.find('input[data-task-line="0"]').attributes('disabled')).not.toBeUndefined();

    const latest = mountMarkdown({
      item: { id: 'v2', filename: 'plan.md', type: 'markdown', content: '- [x] todo', createdAt: 2000 },
      versions,
    });
    await flushAll(latest);
    expect(latest.find('input[data-task-line="0"]').attributes('disabled')).toBeUndefined();
  });

  it('ignores toggles while viewing a historical version', async () => {
    const versions = [
      { id: 'v2', createdAt: 2000 },
      { id: 'v1', createdAt: 1000 },
    ];
    const wrapper = mountMarkdown({
      item: { id: 'v1', filename: 'plan.md', type: 'markdown', content: '- [ ] todo', createdAt: 1000 },
      versions,
    });
    clickCheckbox(wrapper, 0);
    await flushAll(wrapper);

    expect(api.updateCanvasItem).not.toHaveBeenCalled();
  });
});
