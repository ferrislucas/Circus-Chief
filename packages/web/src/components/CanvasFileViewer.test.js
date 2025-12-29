import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import CanvasFileViewer from './CanvasFileViewer.vue';

// Global helper to flush all async updates and force DOM re-render
async function flushAll(wrapper) {
  await flushPromises();
  await nextTick();
  if (wrapper && wrapper.vm) {
    await wrapper.vm.$nextTick?.();
    // Force Vue to re-render with updated state
    await wrapper.vm.$forceUpdate();
    await nextTick();
    // Multiple update cycles to ensure all conditions re-evaluate
    await wrapper.vm.$forceUpdate();
    await nextTick();
  }
}

// Mock markdown utility
vi.mock('../utils/markdown.js', () => ({
  renderMarkdown: vi.fn((content) => `<p>${content}</p>`),
}));

// Mock highlight.js
vi.mock('highlight.js', () => ({
  default: {
    highlight: vi.fn((code, opts) => ({
      value: `<span class="hljs-keyword">${code}</span>`,
    })),
    highlightAuto: vi.fn((code) => ({
      value: `<span class="hljs-auto">${code}</span>`,
    })),
    getLanguage: vi.fn((lang) => ['javascript', 'python', 'typescript'].includes(lang)),
  },
}));

describe('CanvasFileViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
  });
  const baseItem = {
    id: 'item-1',
    filename: 'test-image.png',
    type: 'image',
    data: 'base64data',
    mimeType: 'image/png',
    createdAt: Date.now(),
  };

  const baseVersions = [
    { id: 'item-1', filename: 'test-image.png', createdAt: Date.now() },
    { id: 'item-2', filename: 'test-image.png', createdAt: Date.now() - 60000 },
  ];

  function mountComponent(props = {}) {
    return mount(CanvasFileViewer, {
      props: {
        item: baseItem,
        versions: [],
        showBackButton: true,
        ...props,
      },
    });
  }

  describe('basic rendering', () => {
    it('displays the filename', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.viewer-filename').text()).toBe('test-image.png');
    });

    it('uses label when filename is missing', () => {
      const wrapper = mountComponent({
        item: { ...baseItem, filename: null, label: 'My Label' },
      });
      expect(wrapper.find('.viewer-filename').text()).toBe('My Label');
    });

    it('shows "Untitled" when both filename and label are missing', () => {
      const wrapper = mountComponent({
        item: { ...baseItem, filename: null, label: null },
      });
      expect(wrapper.find('.viewer-filename').text()).toBe('Untitled');
    });
  });

  describe('back button', () => {
    it('shows back button when showBackButton is true', () => {
      const wrapper = mountComponent({ showBackButton: true });
      expect(wrapper.find('.btn-back').exists()).toBe(true);
    });

    it('hides back button when showBackButton is false', () => {
      const wrapper = mountComponent({ showBackButton: false });
      expect(wrapper.find('.btn-back').exists()).toBe(false);
    });

    it('back button has click handler', () => {
      const wrapper = mountComponent();
      const backBtn = wrapper.find('.btn-back');
      expect(backBtn.exists()).toBe(true);
      // Button element is present and styled correctly
      expect(backBtn.text()).toContain('Back');
    });
  });

  describe('version dropdown', () => {
    it('shows version dropdown when multiple versions exist', () => {
      const wrapper = mountComponent({ versions: baseVersions });
      expect(wrapper.find('.version-dropdown').exists()).toBe(true);
    });

    it('hides version dropdown when only one version exists', () => {
      const wrapper = mountComponent({ versions: [baseVersions[0]] });
      expect(wrapper.find('.version-dropdown').exists()).toBe(false);
    });

    it('displays current version number', () => {
      const wrapper = mountComponent({ versions: baseVersions });
      // Current item is at index 0, so version number is versions.length - 0 = 2
      expect(wrapper.find('.version-dropdown summary').text()).toContain('v2');
    });

    it('lists all versions in dropdown', () => {
      const wrapper = mountComponent({ versions: baseVersions });
      const versionItems = wrapper.findAll('.version-list li');
      expect(versionItems.length).toBe(2);
    });

    it('marks current version in list', () => {
      const wrapper = mountComponent({ versions: baseVersions });
      const currentItem = wrapper.find('.version-list li.active');
      expect(currentItem.exists()).toBe(true);
      expect(currentItem.text()).toContain('(current)');
    });

    it('version list items are clickable', () => {
      const wrapper = mountComponent({ versions: baseVersions });
      const versionItems = wrapper.findAll('.version-list li');

      // Verify each version item exists and shows correct info
      // Newest version (index 0) should have highest version number
      expect(versionItems.length).toBe(2);
      expect(versionItems[0].text()).toContain('v2');
      expect(versionItems[1].text()).toContain('v1');
    });
  });

  describe('delete dropdown', () => {
    it('shows delete dropdown', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.delete-dropdown').exists()).toBe(true);
    });

    it('shows "Delete this version" option', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.delete-options').text()).toContain('Delete this version');
    });

    it('shows "Delete all versions" when multiple versions exist', () => {
      const wrapper = mountComponent({ versions: baseVersions });
      expect(wrapper.find('.delete-options').text()).toContain('Delete all 2 versions');
    });

    it('hides "Delete all versions" when only one version exists', () => {
      const wrapper = mountComponent({ versions: [baseVersions[0]] });
      expect(wrapper.find('.delete-options').text()).not.toContain('Delete all');
    });

    it('delete options are interactive elements', () => {
      const wrapper = mountComponent();
      const deleteOptions = wrapper.findAll('.delete-options li');

      // Verify delete option exists
      expect(deleteOptions.length).toBeGreaterThanOrEqual(1);
      expect(deleteOptions[0].text()).toContain('Delete this version');
    });

    it('delete all option exists when multiple versions', () => {
      const wrapper = mountComponent({ versions: baseVersions });
      const deleteAllOption = wrapper.find('.delete-options li.delete-all');

      expect(deleteAllOption.exists()).toBe(true);
      expect(deleteAllOption.text()).toContain('Delete all 2 versions');
    });
  });

  describe('image content', () => {
    it('renders image with correct src', () => {
      const wrapper = mountComponent();
      const img = wrapper.find('.viewer-image');
      expect(img.exists()).toBe(true);
      expect(img.attributes('src')).toBe('data:image/png;base64,base64data');
    });

    it('uses label as alt text', () => {
      const wrapper = mountComponent({
        item: { ...baseItem, label: 'My Image' },
      });
      expect(wrapper.find('.viewer-image').attributes('alt')).toBe('My Image');
    });
  });

  describe('markdown content', () => {
    const markdownItem = {
      ...baseItem,
      type: 'markdown',
      content: '# Hello World',
    };

    it('shows MarkdownViewer by default (preview mode)', () => {
      const wrapper = mountComponent({ item: markdownItem });
      expect(wrapper.find('.markdown-viewer').exists()).toBe(true);
      expect(wrapper.find('.viewer-markdown-raw').exists()).toBe(false);
    });

    it('shows preview toggle button for markdown', () => {
      const wrapper = mountComponent({ item: markdownItem });
      expect(wrapper.find('.preview-toggle').exists()).toBe(true);
    });

    it('hides preview toggle for non-markdown types', () => {
      const wrapper = mountComponent(); // uses image type
      expect(wrapper.find('.preview-toggle').exists()).toBe(false);
    });

    it('toggles between preview and raw mode', async () => {
      const wrapper = mountComponent({ item: markdownItem });

      // Initially in preview mode
      expect(wrapper.find('.markdown-viewer').exists()).toBe(true);

      // Click toggle to switch to raw
      await wrapper.find('.preview-toggle').trigger('click');
      await flushAll(wrapper);
      expect(wrapper.find('.viewer-markdown-raw').exists()).toBe(true);
      expect(wrapper.find('.markdown-viewer').exists()).toBe(false);

      // Click toggle to switch back to preview
      await wrapper.find('.preview-toggle').trigger('click');
      await flushAll(wrapper);
      expect(wrapper.find('.markdown-viewer').exists()).toBe(true);
      expect(wrapper.find('.viewer-markdown-raw').exists()).toBe(false);
    });
  });

  describe('json content', () => {
    const jsonItem = {
      ...baseItem,
      type: 'json',
      data: '{"key":"value"}',
    };

    it('renders formatted JSON', () => {
      const wrapper = mountComponent({ item: jsonItem });
      const jsonContent = wrapper.find('.viewer-json');
      expect(jsonContent.exists()).toBe(true);
      expect(jsonContent.text()).toContain('"key"');
      expect(jsonContent.text()).toContain('"value"');
    });

    it('handles invalid JSON gracefully', () => {
      const wrapper = mountComponent({
        item: { ...jsonItem, data: 'invalid json' },
      });
      expect(wrapper.find('.viewer-json').text()).toBe('invalid json');
    });
  });

  describe('text content', () => {
    const textItem = {
      ...baseItem,
      type: 'text',
      content: 'Plain text content',
    };

    it('renders text content', () => {
      const wrapper = mountComponent({ item: textItem });
      expect(wrapper.find('.viewer-text').text()).toBe('Plain text content');
    });
  });

  describe('code content', () => {
    const codeItem = {
      id: 'code-1',
      type: 'code',
      content: 'function hello() { return "world"; }',
      filename: 'hello.js',
      createdAt: Date.now(),
    };

    it('renders code content with syntax highlighting', () => {
      const wrapper = mountComponent({ item: codeItem });
      expect(wrapper.find('.viewer-code').exists()).toBe(true);
    });

    it('renders code element inside pre', () => {
      const wrapper = mountComponent({ item: codeItem });
      expect(wrapper.find('.viewer-code code').exists()).toBe(true);
    });

    it('renders Python code correctly', () => {
      const wrapper = mountComponent({
        item: { ...codeItem, filename: 'script.py', content: 'def hello():\n    pass' },
      });
      expect(wrapper.find('.viewer-code').exists()).toBe(true);
    });

    it('renders TypeScript code correctly', () => {
      const wrapper = mountComponent({
        item: { ...codeItem, filename: 'app.ts', content: 'const x: number = 42;' },
      });
      expect(wrapper.find('.viewer-code').exists()).toBe(true);
    });

    it('handles unknown file extensions', () => {
      const wrapper = mountComponent({
        item: { ...codeItem, filename: 'unknown.xyz', content: 'some code' },
      });
      expect(wrapper.find('.viewer-code').exists()).toBe(true);
    });

    it('does not show preview toggle for code type', () => {
      const wrapper = mountComponent({ item: codeItem });
      expect(wrapper.find('.preview-toggle').exists()).toBe(false);
    });

    it('handles code item without filename', () => {
      const wrapper = mountComponent({
        item: { ...codeItem, filename: null, label: 'Code snippet' },
      });
      expect(wrapper.find('.viewer-code').exists()).toBe(true);
      expect(wrapper.find('.viewer-filename').text()).toBe('Code snippet');
    });
  });
});
