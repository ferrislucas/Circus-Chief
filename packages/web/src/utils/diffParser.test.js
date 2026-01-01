import { describe, it, expect } from 'vitest';
import { parseDiff } from './diffParser.js';

describe('diffParser', () => {
  describe('binary file detection', () => {
    it('marks files as binary when git reports binary files', () => {
      const diffText = `diff --git a/image.png b/image.png
index 1234567..abcdefg 100644
Binary files a/image.png and b/image.png differ`;

      const files = parseDiff(diffText);
      expect(files).toHaveLength(1);
      expect(files[0].isBinary).toBe(true);
      expect(files[0].displayPath).toContain('image.png');
    });

    it('detects binary changes in mixed diff', () => {
      const diffText = `diff --git a/file.js b/file.js
index 1234567..abcdefg 100644
--- a/file.js
+++ b/file.js
@@ -1,2 +1,3 @@
 const x = 1;
+const y = 2;
diff --git a/image.png b/image.png
index 1234567..abcdefg 100644
Binary files a/image.png and b/image.png differ`;

      const files = parseDiff(diffText);
      expect(files).toHaveLength(2);

      // First file is text
      expect(files[0].displayPath).toContain('file.js');
      expect(files[0].isBinary).toBe(false);
      expect(files[0].hunks).toHaveLength(1);

      // Second file is binary
      expect(files[1].displayPath).toContain('image.png');
      expect(files[1].isBinary).toBe(true);
      expect(files[1].hunks).toHaveLength(0);
    });

    it('handles binary files that are deleted', () => {
      const diffText = `diff --git a/old_image.jpg b/old_image.jpg
deleted file mode 100644
index 1234567..0000000
Binary files a/old_image.jpg and /dev/null differ`;

      const files = parseDiff(diffText);
      expect(files).toHaveLength(1);
      expect(files[0].isBinary).toBe(true);
      expect(files[0].isDeleted).toBe(true);
    });

    it('handles binary files that are newly added', () => {
      const diffText = `diff --git a/new_image.gif b/new_image.gif
new file mode 100644
index 0000000..abcdefg
Binary files /dev/null and b/new_image.gif differ`;

      const files = parseDiff(diffText);
      expect(files).toHaveLength(1);
      expect(files[0].isBinary).toBe(true);
      expect(files[0].isNew).toBe(true);
    });

    it('does not mark text files as binary', () => {
      const diffText = `diff --git a/README.md b/README.md
index 1234567..abcdefg 100644
--- a/README.md
+++ b/README.md
@@ -1,2 +1,3 @@
 # Title
+New section`;

      const files = parseDiff(diffText);
      expect(files).toHaveLength(1);
      expect(files[0].isBinary).toBe(false);
    });

    it('initializes isBinary as false by default', () => {
      const diffText = `diff --git a/script.js b/script.js
index 1234567..abcdefg 100644
--- a/script.js
+++ b/script.js
@@ -1 +1 @@
-const x = 1;
+const x = 2;`;

      const files = parseDiff(diffText);
      expect(files).toHaveLength(1);
      expect(files[0]).toHaveProperty('isBinary');
      expect(files[0].isBinary).toBe(false);
    });

    it('handles multiple binary files in sequence', () => {
      const diffText = `diff --git a/image1.png b/image1.png
index 1234567..abcdefg 100644
Binary files a/image1.png and b/image1.png differ
diff --git a/image2.jpg b/image2.jpg
index 2345678..bcdefgh 100644
Binary files a/image2.jpg and b/image2.jpg differ
diff --git a/image3.gif b/image3.gif
index 3456789..cdefghi 100644
Binary files a/image3.gif and b/image3.gif differ`;

      const files = parseDiff(diffText);
      expect(files).toHaveLength(3);
      files.forEach((file) => {
        expect(file.isBinary).toBe(true);
      });
    });

    it('preserves file metadata for binary files', () => {
      const diffText = `diff --git a/logo.png b/logo.png
index 1234567..abcdefg 100644
Binary files a/logo.png and b/logo.png differ`;

      const files = parseDiff(diffText);
      expect(files[0].displayPath).toContain('logo.png');
      expect(files[0]).toHaveProperty('oldPath');
      expect(files[0]).toHaveProperty('newPath');
      expect(files[0]).toHaveProperty('isNew');
      expect(files[0]).toHaveProperty('isDeleted');
    });
  });

  describe('basic diff parsing', () => {
    it('parses simple text diff correctly', () => {
      const diffText = `diff --git a/file.js b/file.js
index 1234567..abcdefg 100644
--- a/file.js
+++ b/file.js
@@ -1,3 +1,4 @@
 function hello() {
+  console.log('hello');
   return 'world';
 }`;

      const files = parseDiff(diffText);
      expect(files).toHaveLength(1);
      expect(files[0].displayPath).toContain('file.js');
      expect(files[0].hunks).toHaveLength(1);
      expect(files[0].additions).toBeGreaterThan(0);
    });

    it('parses multiple files in one diff', () => {
      const diffText = `diff --git a/file1.js b/file1.js
index 1234567..abcdefg 100644
--- a/file1.js
+++ b/file1.js
@@ -1 +1 @@
-old
+new
diff --git a/file2.js b/file2.js
index 2345678..bcdefgh 100644
--- a/file2.js
+++ b/file2.js
@@ -1 +1 @@
-old2
+new2`;

      const files = parseDiff(diffText);
      expect(files).toHaveLength(2);
    });

    it('handles empty diff input', () => {
      const files = parseDiff('');
      expect(files).toEqual([]);
    });

    it('handles null or undefined input', () => {
      expect(parseDiff(null)).toEqual([]);
      expect(parseDiff(undefined)).toEqual([]);
    });
  });
});
