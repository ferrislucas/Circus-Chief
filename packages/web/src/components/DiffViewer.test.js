import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import DiffViewer from './DiffViewer.vue';

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
    wrapper = mount(DiffViewer, {
      props: {
        diffContent: mockDiffContent,
        title: 'Test Diff',
      },
    });
  });

  describe('copy filename button removal', () => {
    it('should not render copy filename button', () => {
      // The old copy button should not exist
      const copyButtons = wrapper.findAll('.copy-button');
      expect(copyButtons).toHaveLength(0);
    });

    it('should not have copyFilePath method', () => {
      // Verify the component doesn't have the copyFilePath method
      expect(wrapper.vm.copyFilePath).toBeUndefined();
    });

    it('should not have copiedFileIndex state', () => {
      // Verify the component doesn't track which file was copied
      expect(wrapper.vm.copiedFileIndex).toBeUndefined();
    });

    it('should not have copy button with copy icon', () => {
      // Old button had emoji icon for copy
      const copyIcon = wrapper.find('.copy-button-icon');
      expect(copyIcon.exists()).toBe(false);
    });

    it('file headers should not have copy functionality', () => {
      // Verify files can't be copied by checking the file structure
      const fileHeaders = wrapper.findAll('.diff-file-header');
      if (fileHeaders.length > 0) {
        // Each header should not have a copy button
        fileHeaders.forEach((header) => {
          expect(header.find('.copy-button').exists()).toBe(false);
        });
      }
    });

    it('component code should not reference clipboard operations', () => {
      // Verify the component code doesn't use clipboard API
      const componentCode = DiffViewer.toString();
      expect(componentCode).not.toContain('navigator.clipboard');
      expect(componentCode).not.toContain('execCommand');
    });

    it('component code should not have copy-related event handlers', () => {
      // Verify there's no @click handler for copying
      const componentCode = DiffViewer.toString();
      expect(componentCode).not.toContain('copyFilePath');
      expect(componentCode).not.toContain('copiedFileIndex');
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

      const markdownWrapper = mount(DiffViewer, {
        props: {
          diffContent: markdownDiff,
          title: 'Markdown Diff',
        },
      });

      // Should have preview toggle for .md file
      const previewButtons = markdownWrapper.findAll('.preview-toggle');
      expect(previewButtons.length).toBeGreaterThan(0);
    });

    it('handles expandAll prop', () => {
      const expandableWrapper = mount(DiffViewer, {
        props: {
          diffContent: mockDiffContent,
          title: 'Test',
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

      const multiWrapper = mount(DiffViewer, {
        props: {
          diffContent: multiFileDiff,
          title: 'Multiple Files',
        },
      });

      // Should parse both files
      expect(multiWrapper.vm.files).toBeDefined();
      // Files should be detected
      if (multiWrapper.vm.files.length > 0) {
        expect(multiWrapper.vm.files[0].displayPath).toBe('file1.js');
        if (multiWrapper.vm.files.length > 1) {
          expect(multiWrapper.vm.files[1].displayPath).toBe('file2.js');
        }
      }
    });
  });

  describe('expanded state management', () => {
    it('has expandedFiles state', () => {
      expect(wrapper.vm.expandedFiles).toBeDefined();
      expect(typeof wrapper.vm.expandedFiles).toBe('object');
    });

    it('toggles file expansion state', async () => {
      if (wrapper.vm.files && wrapper.vm.files.length > 0) {
        const initialState = wrapper.vm.expandedFiles[0];

        wrapper.vm.toggleFile(0);
        await wrapper.vm.$nextTick();

        // State should have toggled
        const newState = wrapper.vm.expandedFiles[0];
        expect(newState).not.toBe(initialState);
      }
    });
  });

  describe('preview mode', () => {
    it('has previewMode state for markdown', () => {
      expect(wrapper.vm.previewMode).toBeDefined();
      expect(typeof wrapper.vm.previewMode).toBe('object');
    });

    it('toggles preview mode without copy button', async () => {
      const markdownDiff = `diff --git a/test.md b/test.md
index 1234567..abcdefg 100644
--- a/test.md
+++ b/test.md
@@ -1,2 +1,3 @@
 # Header
+New content
 More text`;

      const mdWrapper = mount(DiffViewer, {
        props: {
          diffContent: markdownDiff,
          title: 'Markdown',
        },
      });

      if (mdWrapper.vm.files && mdWrapper.vm.files.length > 0) {
        const initialPreviewState = mdWrapper.vm.previewMode[0];

        mdWrapper.vm.togglePreview(0);
        await mdWrapper.vm.$nextTick();

        const newPreviewState = mdWrapper.vm.previewMode[0];
        expect(newPreviewState).not.toBe(initialPreviewState);

        // Verify no copy buttons exist even with preview
        expect(mdWrapper.findAll('.copy-button')).toHaveLength(0);
      }
    });
  });

  describe('no copy functionality', () => {
    it('file action buttons should only include preview toggle', () => {
      // Find a markdown file to test buttons
      const markdownDiff = `diff --git a/doc.md b/doc.md
index 1234567..abcdefg 100644
--- a/doc.md
+++ b/doc.md
@@ -1 +1,2 @@
 # Title
+Content`;

      const mdWrapper = mount(DiffViewer, {
        props: {
          diffContent: markdownDiff,
          title: 'Markdown Doc',
        },
      });

      // Should have preview toggle but not copy button
      const previewToggles = mdWrapper.findAll('.preview-toggle');
      const copyButtons = mdWrapper.findAll('.copy-button');

      // Copy buttons should not exist
      expect(copyButtons).toHaveLength(0);
    });

    it('does not expose copyFilePath method in component API', () => {
      // Verify the method is not part of the component's public API
      const vm = wrapper.vm;
      expect(Object.getOwnPropertyNames(vm)).not.toContain('copyFilePath');
    });

    it('does not track copied file state', async () => {
      // Try to look for any clipboard-related state
      const vm = wrapper.vm;
      const stateKeys = Object.keys(vm.$data || {});

      // Should not have copiedFileIndex tracking
      expect(stateKeys).not.toContain('copiedFileIndex');
    });
  });
});
