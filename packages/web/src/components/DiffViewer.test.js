import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import DiffViewer from './DiffViewer.vue';
import { parseDiff } from '../utils/diffParser.js';

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

// Mock MarkdownViewer component
vi.mock('./MarkdownViewer.vue', () => ({
  default: {
    name: 'MarkdownViewer',
    props: ['content'],
    template: '<div class="markdown-viewer">{{ content }}</div>',
  },
}));

// Mock API client
vi.mock('../api/index.js', () => ({
  api: {
    getSessionFile: vi.fn(),
  },
}));

describe('DiffViewer.vue', () => {
  let wrapper;

  const mockDiffContent = `diff --git a/src/file.js b/src/file.js
index 1234567..abcdefg 100644
--- a/src/file.js
+++ b/src/file.js
@@ -1,5 +1,6 @@
 function hello() {
+  console.log('hello');
   return 'world';
 }
-module.exports = hello;
+module.exports = hello;`;

  beforeEach(() => {
    const files = parseDiff(mockDiffContent);
    wrapper = mount(DiffViewer, {
      props: {
        files,
      },
    });
  });

  describe('copy filename button', () => {
    it('renders copy filename button for each file', () => {
      const copyButtons = wrapper.findAll('.copy-button');
      expect(copyButtons.length).toBeGreaterThan(0);
    });

    it('copy button has proper icon', () => {
      const copyButton = wrapper.find('.copy-button');
      expect(copyButton.exists()).toBe(true);
      const copyIcon = copyButton.find('.copy-button-icon');
      expect(copyIcon.exists()).toBe(true);
    });

    it('file headers have copy functionality', () => {
      const fileHeaders = wrapper.findAll('.diff-file-header');
      if (fileHeaders.length > 0) {
        // Each header should have a copy button
        fileHeaders.forEach((header) => {
          expect(header.find('.copy-button').exists()).toBe(true);
        });
      }
    });

    it('copy button has correct aria-label', () => {
      const copyButton = wrapper.find('.copy-button');
      if (copyButton.exists()) {
        const ariaLabel = copyButton.attributes('aria-label');
        expect(ariaLabel).toBeTruthy();
        expect(ariaLabel).toContain('Copy');
      }
    });
  });

  describe('basic rendering', () => {
    it('renders component', () => {
      expect(wrapper.exists()).toBe(true);
    });

    it('has markdown preview button for markdown files', () => {
      const markdownDiff = `diff --git a/README.md b/README.md
index 1234567..abcdefg 100644
--- a/README.md
+++ b/README.md
@@ -1,2 +1,3 @@
 # Title
+New line
 Content`;

      const files = parseDiff(markdownDiff);
      const markdownWrapper = mount(DiffViewer, {
        props: {
          files,
        },
      });

      // Should have preview toggle for .md file
      const previewButtons = markdownWrapper.findAll('.preview-toggle');
      expect(previewButtons.length).toBeGreaterThan(0);
    });

    it('handles expandAll prop', () => {
      const files = parseDiff(mockDiffContent);
      const expandableWrapper = mount(DiffViewer, {
        props: {
          files,
          expandAll: true,
        },
      });

      expect(expandableWrapper.exists()).toBe(true);
    });
  });

  describe('file parsing', () => {
    it('parses diff content into files', () => {
      const multiFileDiff = `diff --git a/file1.js b/file1.js
index 1234567..abcdefg 100644
--- a/file1.js
+++ b/file1.js
@@ -1,2 +1,2 @@
 const x = 1;
+const y = 2;
diff --git a/file2.js b/file2.js
index 1234567..abcdefg 100644
--- a/file2.js
+++ b/file2.js
@@ -1,2 +1,2 @@
 const a = 1;
+const b = 2;`;

      const files = parseDiff(multiFileDiff);
      const multiWrapper = mount(DiffViewer, {
        props: {
          files,
        },
      });

      // Should parse both files
      const filesProps = multiWrapper.props('files');
      expect(filesProps).toBeDefined();
      expect(filesProps.length).toBe(2);
      expect(filesProps[0].displayPath).toBe('file1.js');
      expect(filesProps[1].displayPath).toBe('file2.js');
    });
  });

  describe('expanded state management', () => {
    it('has file expansion functionality', () => {
      // Component should render file headers which can be clicked to expand/collapse
      const fileHeaders = wrapper.findAll('.diff-file-header');
      expect(fileHeaders.length).toBeGreaterThan(0);
    });

    it('toggles file expansion state', async () => {
      const fileHeaders = wrapper.findAll('.diff-file-header');
      if (fileHeaders.length > 0) {
        const initialContent = wrapper.find('.diff-file-content').exists();

        // Click the file header to toggle
        await fileHeaders[0].trigger('click');
        await flushAll(wrapper);

        const newContent = wrapper.find('.diff-file-content').exists();
        // State should have toggled
        expect(newContent).not.toBe(initialContent);
      }
    });
  });

  describe('preview mode', () => {
    it('has preview toggle for markdown files', () => {
      const markdownDiff = `diff --git a/test.md b/test.md
index 1234567..abcdefg 100644
--- a/test.md
+++ b/test.md
@@ -1,2 +1,3 @@
 # Header
+New content
 More text`;

      const files = parseDiff(markdownDiff);
      const mdWrapper = mount(DiffViewer, {
        props: {
          files,
        },
      });

      // Should have preview toggle button for markdown files
      const previewToggle = mdWrapper.find('.preview-toggle');
      expect(previewToggle.exists()).toBe(true);
    });

    it('toggles preview mode and copy button remains', async () => {
      const markdownDiff = `diff --git a/test.md b/test.md
index 1234567..abcdefg 100644
--- a/test.md
+++ b/test.md
@@ -1,2 +1,3 @@
 # Header
+New content
 More text`;

      const files = parseDiff(markdownDiff);
      const mdWrapper = mount(DiffViewer, {
        props: {
          files,
        },
      });

      const previewToggle = mdWrapper.find('.preview-toggle');
      if (previewToggle.exists()) {
        // Initially should show preview (markdown files default to preview mode)
        const initialText = previewToggle.text();
        const initialCopyButtons = mdWrapper.findAll('.copy-button').length;

        await previewToggle.trigger('click');
        await flushAll(mdWrapper);

        const newText = previewToggle.text();
        // Button text should have changed
        expect(newText).not.toBe(initialText);

        // Verify copy button still exists after toggling preview
        expect(mdWrapper.findAll('.copy-button').length).toBe(initialCopyButtons);
      }
    });
  });

  describe('copy and preview functionality together', () => {
    it('markdown files have both copy button and preview toggle', () => {
      // Find a markdown file to test buttons
      const markdownDiff = `diff --git a/doc.md b/doc.md
index 1234567..abcdefg 100644
--- a/doc.md
+++ b/doc.md
@@ -1 +1,2 @@
 # Title
+Content`;

      const files = parseDiff(markdownDiff);
      const mdWrapper = mount(DiffViewer, {
        props: {
          files,
        },
      });

      // Should have both preview toggle and copy button
      const previewToggles = mdWrapper.findAll('.preview-toggle');
      const copyButtons = mdWrapper.findAll('.copy-button');

      expect(previewToggles.length).toBeGreaterThan(0);
      expect(copyButtons.length).toBeGreaterThan(0);
    });

    it('non-markdown files have copy button but no preview toggle', () => {
      const jsFiles = parseDiff(mockDiffContent);
      const jsWrapper = mount(DiffViewer, {
        props: {
          files: jsFiles,
        },
      });

      // Should have copy button but not preview toggle
      const copyButtons = jsWrapper.findAll('.copy-button');
      const previewToggles = jsWrapper.findAll('.preview-toggle');

      expect(copyButtons.length).toBeGreaterThan(0);
      expect(previewToggles.length).toBe(0);
    });
  });

  describe('external state management', () => {
    const twoFileDiff = `diff --git a/file1.js b/file1.js
index 1234567..abcdefg 100644
--- a/file1.js
+++ b/file1.js
@@ -1,2 +1,2 @@
 const x = 1;
+const y = 2;
diff --git a/file2.js b/file2.js
index 1234567..abcdefg 100644
--- a/file2.js
+++ b/file2.js
@@ -1,2 +1,2 @@
 const a = 1;
+const b = 2;`;

    it('accepts externalExpandedState prop', () => {
      const files = parseDiff(twoFileDiff);
      const externalState = { 'file1.js': true };

      const wrapper = mount(DiffViewer, {
        props: {
          files,
          externalExpandedState: externalState,
        },
      });

      expect(wrapper.props('externalExpandedState')).toEqual(externalState);
    });

    it('uses external state when provided', async () => {
      const files = parseDiff(twoFileDiff);
      const externalState = {
        'file1.js': true, // expanded
        'file2.js': false, // collapsed
      };

      const wrapper = mount(DiffViewer, {
        props: {
          files,
          externalExpandedState: externalState,
        },
      });

      await flushAll(wrapper);

      // Check that expansion matches external state
      expect(wrapper.vm.isFileExpanded(0)).toBe(true);
      expect(wrapper.vm.isFileExpanded(1)).toBe(false);
    });

    it('emits update:expandedState when file is toggled', async () => {
      const files = parseDiff(twoFileDiff);
      const externalState = { 'file1.js': true, 'file2.js': false };

      // Track emitted events via a spy
      const emitSpy = vi.fn();
      const wrapper = mount(DiffViewer, {
        props: {
          files,
          externalExpandedState: externalState,
          'onUpdate:expandedState': emitSpy,
        },
      });

      await flushAll(wrapper);

      // Click to toggle first file
      const header = wrapper.find('.diff-file-header');
      await header.trigger('click');
      await flushAll(wrapper);

      // Should emit state change
      expect(emitSpy).toHaveBeenCalled();
      const emittedState = emitSpy.mock.calls[0][0];
      expect(emittedState['file1.js']).toBe(false);
    });

    it('falls back to internal state when externalExpandedState is null', async () => {
      const files = parseDiff(twoFileDiff);

      const wrapper = mount(DiffViewer, {
        props: {
          files,
          externalExpandedState: null,
          expandAll: true, // default expand
        },
      });

      await flushAll(wrapper);

      // Should use internal state with expandAll default
      expect(wrapper.vm.isFileExpanded(0)).toBe(true);
    });
  });

  describe('defaultExpanded prop', () => {
    const twoFileDiff = `diff --git a/file1.js b/file1.js
index 1234567..abcdefg 100644
--- a/file1.js
+++ b/file1.js
@@ -1,2 +1,2 @@
 const x = 1;
+const y = 2;
diff --git a/file2.js b/file2.js
index 1234567..abcdefg 100644
--- a/file2.js
+++ b/file2.js
@@ -1,2 +1,2 @@
 const a = 1;
+const b = 2;`;

    it('accepts defaultExpanded prop', () => {
      const files = parseDiff(twoFileDiff);

      const wrapper = mount(DiffViewer, {
        props: {
          files,
          defaultExpanded: false,
        },
      });

      expect(wrapper.props('defaultExpanded')).toBe(false);
    });

    it('uses defaultExpanded for files not in external state', async () => {
      const files = parseDiff(twoFileDiff);
      // Only file1.js is in state, file2.js should use defaultExpanded
      const externalState = { 'file1.js': true };

      const wrapper = mount(DiffViewer, {
        props: {
          files,
          externalExpandedState: externalState,
          defaultExpanded: false,
        },
      });

      await flushAll(wrapper);

      expect(wrapper.vm.isFileExpanded(0)).toBe(true); // from externalState
      expect(wrapper.vm.isFileExpanded(1)).toBe(false); // from defaultExpanded
    });

    it('initializes files as collapsed when defaultExpanded is false (no external state)', async () => {
      const files = parseDiff(twoFileDiff);

      const wrapper = mount(DiffViewer, {
        props: {
          files,
          defaultExpanded: false,
        },
      });

      await flushAll(wrapper);

      // With no external state and defaultExpanded: false, files should be collapsed
      expect(wrapper.vm.isFileExpanded(0)).toBe(false);
      expect(wrapper.vm.isFileExpanded(1)).toBe(false);
    });
  });

  describe('expand/collapse all with external state', () => {
    const twoFileDiff = `diff --git a/file1.js b/file1.js
index 1234567..abcdefg 100644
--- a/file1.js
+++ b/file1.js
@@ -1,2 +1,2 @@
 const x = 1;
+const y = 2;
diff --git a/file2.js b/file2.js
index 1234567..abcdefg 100644
--- a/file2.js
+++ b/file2.js
@@ -1,2 +1,2 @@
 const a = 1;
+const b = 2;`;

    it('expandAll emits update:expandedState with all files expanded', async () => {
      const files = parseDiff(twoFileDiff);
      const externalState = { 'file1.js': false, 'file2.js': false };

      // Track emitted events via a spy
      const emitSpy = vi.fn();
      const wrapper = mount(DiffViewer, {
        props: {
          files,
          externalExpandedState: externalState,
          'onUpdate:expandedState': emitSpy,
        },
      });

      await flushAll(wrapper);

      // Call expandAll exposed method
      wrapper.vm.expandAll();
      await flushAll(wrapper);

      expect(emitSpy).toHaveBeenCalled();
      const emittedState = emitSpy.mock.calls[0][0];
      expect(emittedState['file1.js']).toBe(true);
      expect(emittedState['file2.js']).toBe(true);
    });

    it('collapseAll emits update:expandedState with all files collapsed', async () => {
      const files = parseDiff(twoFileDiff);
      const externalState = { 'file1.js': true, 'file2.js': true };

      // Track emitted events via a spy
      const emitSpy = vi.fn();
      const wrapper = mount(DiffViewer, {
        props: {
          files,
          externalExpandedState: externalState,
          'onUpdate:expandedState': emitSpy,
        },
      });

      await flushAll(wrapper);

      // Call collapseAll exposed method
      wrapper.vm.collapseAll();
      await flushAll(wrapper);

      expect(emitSpy).toHaveBeenCalled();
      const emittedState = emitSpy.mock.calls[0][0];
      expect(emittedState['file1.js']).toBe(false);
      expect(emittedState['file2.js']).toBe(false);
    });
  });

  describe('image file handling', () => {
    it('renders image preview container for PNG files when expanded', async () => {
      const imageDiff = `diff --git a/image.png b/image.png
Binary files a/image.png and b/image.png differ`;
      const files = parseDiff(imageDiff);
      const wrapper = mount(DiffViewer, {
        props: {
          files,
          sessionId: 'sess-123',
          externalExpandedState: { 'image.png': true },
        },
      });

      await flushAll(wrapper);
      // Check that image preview container is rendered
      expect(wrapper.find('.image-preview-container').exists()).toBe(true);
    });

    it('renders image preview container for JPEG files when expanded', async () => {
      const jpegDiff = `diff --git a/photo.jpg b/photo.jpg
Binary files a/photo.jpg and b/photo.jpg differ`;
      const files = parseDiff(jpegDiff);
      const wrapper = mount(DiffViewer, {
        props: {
          files,
          sessionId: 'sess-123',
          externalExpandedState: { 'photo.jpg': true },
        },
      });

      await flushAll(wrapper);
      expect(wrapper.find('.image-preview-container').exists()).toBe(true);
    });

    it('renders image preview container for GIF files when expanded', async () => {
      const gifDiff = `diff --git a/animation.gif b/animation.gif
Binary files a/animation.gif and b/animation.gif differ`;
      const files = parseDiff(gifDiff);
      const wrapper = mount(DiffViewer, {
        props: {
          files,
          sessionId: 'sess-123',
          externalExpandedState: { 'animation.gif': true },
        },
      });

      await flushAll(wrapper);
      expect(wrapper.find('.image-preview-container').exists()).toBe(true);
    });

    it('renders image preview container for SVG files when expanded', async () => {
      const svgDiff = `diff --git a/icon.svg b/icon.svg
Binary files a/icon.svg and b/icon.svg differ`;
      const files = parseDiff(svgDiff);
      const wrapper = mount(DiffViewer, {
        props: {
          files,
          sessionId: 'sess-123',
          externalExpandedState: { 'icon.svg': true },
        },
      });

      await flushAll(wrapper);
      expect(wrapper.find('.image-preview-container').exists()).toBe(true);
    });

    it('renders image preview container for WebP files when expanded', async () => {
      const webpDiff = `diff --git a/modern.webp b/modern.webp
Binary files a/modern.webp and b/modern.webp differ`;
      const files = parseDiff(webpDiff);
      const wrapper = mount(DiffViewer, {
        props: {
          files,
          sessionId: 'sess-123',
          externalExpandedState: { 'modern.webp': true },
        },
      });

      await flushAll(wrapper);
      expect(wrapper.find('.image-preview-container').exists()).toBe(true);
    });

    it('accepts sessionId prop for image loading', () => {
      const imageDiff = `diff --git a/image.png b/image.png
Binary files a/image.png and b/image.png differ`;
      const files = parseDiff(imageDiff);

      // Mount with sessionId
      const wrapper = mount(DiffViewer, {
        props: {
          files,
          sessionId: 'sess-123',
        },
      });

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.props('sessionId')).toBe('sess-123');
    });

    it('mounts without sessionId prop', () => {
      const imageDiff = `diff --git a/image.png b/image.png
Binary files a/image.png and b/image.png differ`;
      const files = parseDiff(imageDiff);

      const wrapper = mount(DiffViewer, {
        props: {
          files,
          sessionId: null,
        },
      });

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.props('sessionId')).toBeNull();
    });

    it('displays binary file notice for non-image binary files', async () => {
      const binaryDiff = `diff --git a/archive.zip b/archive.zip
Binary files a/archive.zip and b/archive.zip differ`;
      const files = parseDiff(binaryDiff);

      const wrapper = mount(DiffViewer, {
        props: {
          files,
          sessionId: 'sess-123',
          externalExpandedState: { 'archive.zip': true },
        },
      });

      await flushAll(wrapper);

      // The component should render a binary file notice
      const binaryNotice = wrapper.find('.binary-file-notice');
      expect(binaryNotice.exists()).toBe(true);
    });

    it('supports image file preview when expanded', async () => {
      const imageDiff = `diff --git a/screenshot.png b/screenshot.png
new file mode 100644
Binary files /dev/null and b/screenshot.png differ`;
      const files = parseDiff(imageDiff);

      const wrapper = mount(DiffViewer, {
        props: {
          files,
          sessionId: 'sess-123',
          externalExpandedState: { 'screenshot.png': true },
        },
      });

      await flushAll(wrapper);

      // Check that image preview container exists for PNG files
      const imagePreview = wrapper.find('.image-preview-container');
      expect(imagePreview.exists()).toBe(true);
    });
  });
});
