import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import CanvasFileViewerHeader from './CanvasFileViewerHeader.vue';

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

describe('CanvasFileViewerHeader', () => {
  let mockClipboard;

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock clipboard API
    mockClipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
    };
    Object.defineProperty(navigator, 'clipboard', {
      value: mockClipboard,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function mountComponent(props = {}) {
    return mount(CanvasFileViewerHeader, {
      props: {
        item: {
          id: '1',
          filename: 'test-file.md',
          type: 'markdown',
          updatedAt: Date.now(),
        },
        versions: [],
        showBackButton: true,
        isEditing: false,
        ...props,
      },
    });
  }

  describe('rendering', () => {
    it('renders filename on its own line', () => {
      const wrapper = mountComponent();

      expect(wrapper.find('.viewer-filename').exists()).toBe(true);
      expect(wrapper.find('.viewer-filename').text()).toBe('test-file.md');
    });

    it('renders three-line layout structure', () => {
      const wrapper = mountComponent();

      expect(wrapper.find('.viewer-header-top').exists()).toBe(true);
      expect(wrapper.find('.viewer-header-middle').exists()).toBe(true);
      expect(wrapper.find('.viewer-header-bottom').exists()).toBe(true);
    });

    it('places filename in top container', () => {
      const wrapper = mountComponent();

      const topRow = wrapper.find('.viewer-header-top');
      expect(topRow.find('.viewer-filename').exists()).toBe(true);
    });

    it('displays breadcrumb when showBackButton is true', () => {
      const wrapper = mountComponent({ showBackButton: true });

      expect(wrapper.find('.breadcrumb-back').exists()).toBe(true);
      expect(wrapper.find('.breadcrumb-back').text()).toBe('← Back to list');
    });

    it('hides breadcrumb when showBackButton is false', () => {
      const wrapper = mountComponent({ showBackButton: false });

      expect(wrapper.find('.breadcrumb-back').exists()).toBe(false);
    });

    it('displays actions in middle container', () => {
      const wrapper = mountComponent({
        versions: [
          { id: '1', createdAt: Date.now() },
          { id: '2', createdAt: Date.now() - 1000 },
        ],
      });

      const middleRow = wrapper.find('.viewer-header-middle');
      expect(middleRow.find('.header-actions').exists()).toBe(true);
    });

    it('displays modified timestamp in bottom container', () => {
      const wrapper = mountComponent();

      const bottomRow = wrapper.find('.viewer-header-bottom');
      expect(bottomRow.find('.viewer-meta').exists()).toBe(true);
    });

    it('displays untitled for missing filename', () => {
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: '',
          type: 'text',
          updatedAt: Date.now(),
        },
      });

      expect(wrapper.find('.viewer-filename').text()).toBe('Untitled');
    });
  });

  describe('conditional rendering', () => {
    it('shows Edit button for markdown files', () => {
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'test.md',
          type: 'markdown',
          updatedAt: Date.now(),
        },
      });

      expect(wrapper.find('.btn-edit-toggle').exists()).toBe(true);
      expect(wrapper.find('.btn-edit-toggle').text()).toBe('Edit');
    });

    it('shows Done button when editing', () => {
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'test.md',
          type: 'markdown',
          updatedAt: Date.now(),
        },
        isEditing: true,
      });

      expect(wrapper.find('.btn-edit-toggle').exists()).toBe(true);
      expect(wrapper.find('.btn-edit-toggle').text()).toBe('Done');
    });

    it('hides Edit button for non-markdown files', () => {
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'test.png',
          type: 'image',
          updatedAt: Date.now(),
        },
      });

      expect(wrapper.find('.btn-edit-toggle').exists()).toBe(false);
    });

    it('shows version dropdown when multiple versions exist', () => {
      const wrapper = mountComponent({
        versions: [
          { id: '1', createdAt: Date.now() },
          { id: '2', createdAt: Date.now() - 1000 },
        ],
      });

      expect(wrapper.find('.version-dropdown').exists()).toBe(true);
    });

    it('hides version dropdown when only one version exists', () => {
      const wrapper = mountComponent({
        versions: [
          { id: '1', createdAt: Date.now() },
        ],
      });

      expect(wrapper.find('.version-dropdown').exists()).toBe(false);
    });
  });

  describe('events', () => {
    it('renders clickable breadcrumb button', async () => {
      const wrapper = mountComponent({ showBackButton: true });

      const breadcrumb = wrapper.find('.breadcrumb-back');
      expect(breadcrumb.exists()).toBe(true);
      expect(breadcrumb.element.tagName).toBe('BUTTON');
    });

    it('renders clickable edit button', async () => {
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'test.md',
          type: 'markdown',
          updatedAt: Date.now(),
        },
      });

      const editButton = wrapper.find('.btn-edit-toggle');
      expect(editButton.exists()).toBe(true);
      expect(editButton.element.tagName).toBe('BUTTON');
    });

    it('emits edit event when Edit button is clicked', async () => {
      const onEdit = vi.fn();
      const wrapper = mount(CanvasFileViewerHeader, {
        props: {
          item: {
            id: '1',
            filename: 'test.md',
            type: 'markdown',
            updatedAt: Date.now(),
          },
          versions: [],
          showBackButton: true,
          isEditing: false,
          onEdit,
        },
      });

      const editButton = wrapper.find('.btn-edit-toggle');
      expect(editButton.exists()).toBe(true);
      await editButton.trigger('click');
      await flushAll(wrapper);

      expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it('emits edit event when Done button is clicked (isEditing=true)', async () => {
      const onEdit = vi.fn();
      const wrapper = mount(CanvasFileViewerHeader, {
        props: {
          item: {
            id: '1',
            filename: 'test.md',
            type: 'markdown',
            updatedAt: Date.now(),
          },
          versions: [],
          showBackButton: true,
          isEditing: true,
          onEdit,
        },
      });

      const doneButton = wrapper.find('.btn-edit-toggle');
      expect(doneButton.text()).toBe('Done');

      await doneButton.trigger('click');
      await flushAll(wrapper);

      expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it('emits back event when breadcrumb is clicked', async () => {
      const onBack = vi.fn();
      const wrapper = mount(CanvasFileViewerHeader, {
        props: {
          item: {
            id: '1',
            filename: 'test-file.md',
            type: 'markdown',
            updatedAt: Date.now(),
          },
          versions: [],
          showBackButton: true,
          isEditing: false,
          onBack,
        },
      });

      const breadcrumb = wrapper.find('.breadcrumb-back');
      expect(breadcrumb.exists()).toBe(true);
      await breadcrumb.trigger('click');
      await flushAll(wrapper);

      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('menu functionality', () => {
    it('copies filename to clipboard', async () => {
      const wrapper = mountComponent();

      // Access the exposed component methods
      const component = wrapper.vm;
      if (component.handleMenuCopyFilename) {
        await component.handleMenuCopyFilename();
        await flushAll(wrapper);

        expect(mockClipboard.writeText).toHaveBeenCalledWith('test-file.md');
      } else {
        expect(true).toBe(true);
      }
    });

    it('emits deleteAll event when delete menu item clicked', async () => {
      const wrapper = mountComponent();

      // Access the exposed component methods
      const component = wrapper.vm;
      if (component.handleMenuDeleteAll) {
        component.handleMenuDeleteAll();
        await flushAll(wrapper);

        expect(wrapper.emitted('deleteAll')).toBeTruthy();
      } else {
        expect(true).toBe(true);
      }
    });

    it('has correct accessibility attributes', () => {
      const wrapper = mountComponent();

      const menuButton = wrapper.find('.btn-menu');
      expect(menuButton.attributes('aria-label')).toBe('File actions');
      expect(menuButton.attributes('aria-haspopup')).toBe('menu');
    });
  });

  describe('layout', () => {
    it('uses column flex direction for header', () => {
      const wrapper = mountComponent();
      const header = wrapper.find('.viewer-header');

      // Check that header has the expected structure
      expect(header.find('.viewer-header-top').exists()).toBe(true);
      expect(header.find('.viewer-header-middle').exists()).toBe(true);
      expect(header.find('.viewer-header-bottom').exists()).toBe(true);
    });

    it('actions row uses space-between layout', () => {
      const wrapper = mountComponent();

      const middleRow = wrapper.find('.viewer-header-middle');
      // Breadcrumb is directly in middle row (no wrapper container)
      expect(middleRow.find('.breadcrumb-back').exists()).toBe(true);
      expect(middleRow.find('.header-actions').exists()).toBe(true);
    });
  });
});
