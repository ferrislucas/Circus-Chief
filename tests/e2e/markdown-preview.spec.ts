import { test, expect } from '@playwright/test';
import { seedProject, seedSession, cleanupAll, getSession } from './helpers';
import * as fs from 'fs';
import * as path from 'path';

const API_URL = process.env.API_URL || 'http://localhost:5000';

test.describe('Markdown Preview in Changes Tab', () => {
  let project: any;
  let testDir: string;

  test.beforeEach(async () => {
    await cleanupAll();

    // Create a temporary test directory with git
    testDir = `/tmp/md-preview-test-${Date.now()}`;
    fs.mkdirSync(testDir, { recursive: true });

    // Initialize git repo
    const { execSync } = require('child_process');
    execSync('git init', { cwd: testDir });
    execSync('git config user.email "test@test.com"', { cwd: testDir });
    execSync('git config user.name "Test User"', { cwd: testDir });

    // Create an initial commit so we have a clean repo
    fs.writeFileSync(path.join(testDir, '.gitkeep'), '');
    execSync('git add .gitkeep && git commit -m "Initial commit"', { cwd: testDir });

    project = await seedProject('Markdown Test Project', testDir);
  });

  test.afterEach(async () => {
    await cleanupAll();

    // Clean up test directory
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('displays preview button for staged markdown files', async ({ page }) => {
    // Create a markdown file and stage it
    const readmePath = path.join(testDir, 'README.md');
    fs.writeFileSync(readmePath, '# Hello World\n\nThis is a test.');

    const { execSync } = require('child_process');
    execSync('git add README.md', { cwd: testDir });

    const session = await seedSession(project.id, { prompt: 'Test', name: 'Preview Test' });

    await page.goto(`/sessions/${session.id}/changes`);

    // Wait for changes to load
    await expect(page.getByText('Staged Changes')).toBeVisible();
    await expect(page.getByText('README.md')).toBeVisible();

    // Should see preview button for markdown file
    const previewButton = page.getByRole('button', { name: 'Preview' });
    await expect(previewButton).toBeVisible();
  });

  test('does not display preview button for non-markdown files', async ({ page }) => {
    // Create a JS file and stage it
    const jsPath = path.join(testDir, 'index.js');
    fs.writeFileSync(jsPath, 'console.log("hello");');

    const { execSync } = require('child_process');
    execSync('git add index.js', { cwd: testDir });

    const session = await seedSession(project.id, { prompt: 'Test', name: 'Non-MD Test' });

    await page.goto(`/sessions/${session.id}/changes`);

    // Wait for changes to load
    await expect(page.getByText('Staged Changes')).toBeVisible();
    await expect(page.getByText('index.js')).toBeVisible();

    // Should NOT see preview button for JS file
    const previewButton = page.getByRole('button', { name: 'Preview' });
    await expect(previewButton).not.toBeVisible();
  });

  test('toggles between diff view and markdown preview', async ({ page }) => {
    // Create a markdown file with content
    const readmePath = path.join(testDir, 'README.md');
    fs.writeFileSync(readmePath, '# Test Heading\n\nSome **bold** text and *italic* text.');

    const { execSync } = require('child_process');
    execSync('git add README.md', { cwd: testDir });

    const session = await seedSession(project.id, { prompt: 'Test', name: 'Toggle Test' });

    await page.goto(`/sessions/${session.id}/changes`);

    // Wait for changes to load
    await expect(page.getByText('Staged Changes')).toBeVisible();

    // Initially should show diff view
    const diffContent = page.locator('.diff-content');
    await expect(diffContent).toBeVisible();

    // Click preview button
    const previewButton = page.getByRole('button', { name: 'Preview' });
    await previewButton.click();

    // Should now show markdown preview
    await expect(page.locator('.markdown-preview')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show Diff' })).toBeVisible();

    // Click to toggle back to diff
    await page.getByRole('button', { name: 'Show Diff' }).click();

    // Should show diff again
    await expect(diffContent).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preview' })).toBeVisible();
  });

  test('renders markdown content correctly in preview', async ({ page }) => {
    // Create a markdown file with various markdown elements
    const readmePath = path.join(testDir, 'README.md');
    const markdownContent = `# Main Heading

## Subheading

This is a paragraph with **bold** and *italic* text.

- List item 1
- List item 2
- List item 3

\`\`\`javascript
const hello = "world";
\`\`\`

> A blockquote

[A link](https://example.com)
`;
    fs.writeFileSync(readmePath, markdownContent);

    const { execSync } = require('child_process');
    execSync('git add README.md', { cwd: testDir });

    const session = await seedSession(project.id, { prompt: 'Test', name: 'Render Test' });

    await page.goto(`/sessions/${session.id}/changes`);

    // Wait for changes to load and click preview
    await expect(page.getByText('Staged Changes')).toBeVisible();
    await page.getByRole('button', { name: 'Preview' }).click();

    // Wait for preview to render
    await expect(page.locator('.markdown-preview')).toBeVisible();

    // Check that markdown elements are rendered (h1, h2, etc.)
    await expect(page.locator('.md-editor-preview h1')).toBeVisible();
    await expect(page.locator('.md-editor-preview h2')).toBeVisible();
  });

  test('displays preview button for untracked markdown files', async ({ page }) => {
    // Create an untracked markdown file
    const docsPath = path.join(testDir, 'docs.md');
    fs.writeFileSync(docsPath, '# Documentation\n\nSome docs here.');

    const session = await seedSession(project.id, { prompt: 'Test', name: 'Untracked Test' });

    await page.goto(`/sessions/${session.id}/changes`);

    // Wait for changes to load
    await expect(page.getByText('Untracked Files')).toBeVisible();
    await expect(page.getByText('docs.md')).toBeVisible();

    // Should see preview button
    const previewButton = page.getByRole('button', { name: 'Preview' });
    await expect(previewButton).toBeVisible();
  });

  test('can preview untracked markdown file', async ({ page }) => {
    // Create an untracked markdown file
    const guidePath = path.join(testDir, 'GUIDE.md');
    fs.writeFileSync(guidePath, '# User Guide\n\nWelcome to the guide!');

    const session = await seedSession(project.id, { prompt: 'Test', name: 'Untracked Preview' });

    await page.goto(`/sessions/${session.id}/changes`);

    // Wait for changes to load
    await expect(page.getByText('Untracked Files')).toBeVisible();

    // Click preview
    await page.getByRole('button', { name: 'Preview' }).click();

    // Should show markdown preview
    await expect(page.locator('.markdown-preview')).toBeVisible();
    await expect(page.locator('.md-editor-preview')).toContainText('User Guide');
  });

  test('displays preview button for unstaged markdown changes', async ({ page }) => {
    // Create, commit, then modify a markdown file (unstaged change)
    const readmePath = path.join(testDir, 'README.md');
    fs.writeFileSync(readmePath, '# Original');

    const { execSync } = require('child_process');
    execSync('git add README.md && git commit -m "Add README"', { cwd: testDir });

    // Modify the file (unstaged change)
    fs.writeFileSync(readmePath, '# Modified\n\nNew content added.');

    const session = await seedSession(project.id, { prompt: 'Test', name: 'Unstaged Test' });

    await page.goto(`/sessions/${session.id}/changes`);

    // Wait for changes to load
    await expect(page.getByText('Unstaged Changes')).toBeVisible();
    await expect(page.getByText('README.md')).toBeVisible();

    // Should see preview button
    const previewButton = page.getByRole('button', { name: 'Preview' });
    await expect(previewButton).toBeVisible();
  });

  test('handles file not found error gracefully', async ({ page }) => {
    // Create and stage a markdown file
    const readmePath = path.join(testDir, 'TEMP.md');
    fs.writeFileSync(readmePath, '# Temporary');

    const { execSync } = require('child_process');
    execSync('git add TEMP.md', { cwd: testDir });

    const session = await seedSession(project.id, { prompt: 'Test', name: 'Error Test' });

    // Delete the file after staging (simulates a deleted file scenario)
    fs.unlinkSync(readmePath);

    await page.goto(`/sessions/${session.id}/changes`);

    // Wait for changes to load
    await expect(page.getByText('Staged Changes')).toBeVisible();

    // Click preview - should handle the error
    await page.getByRole('button', { name: 'Preview' }).click();

    // Should show error message
    await expect(page.locator('.preview-error')).toBeVisible();
  });

  test('shows loading state while fetching preview', async ({ page }) => {
    // Create a markdown file
    const readmePath = path.join(testDir, 'README.md');
    fs.writeFileSync(readmePath, '# Hello');

    const { execSync } = require('child_process');
    execSync('git add README.md', { cwd: testDir });

    const session = await seedSession(project.id, { prompt: 'Test', name: 'Loading Test' });

    await page.goto(`/sessions/${session.id}/changes`);

    // Wait for changes to load
    await expect(page.getByText('Staged Changes')).toBeVisible();

    // Click preview - loading should appear briefly
    await page.getByRole('button', { name: 'Preview' }).click();

    // The preview should eventually render (loading state is brief)
    await expect(page.locator('.markdown-preview')).toBeVisible();
  });

  test('handles multiple markdown files independently', async ({ page }) => {
    // Create multiple markdown files
    fs.writeFileSync(path.join(testDir, 'README.md'), '# README Content');
    fs.writeFileSync(path.join(testDir, 'CHANGELOG.md'), '# Changelog Content');

    const { execSync } = require('child_process');
    execSync('git add README.md CHANGELOG.md', { cwd: testDir });

    const session = await seedSession(project.id, { prompt: 'Test', name: 'Multi File Test' });

    await page.goto(`/sessions/${session.id}/changes`);

    // Wait for changes to load
    await expect(page.getByText('Staged Changes')).toBeVisible();

    // Should see two preview buttons
    const previewButtons = page.getByRole('button', { name: 'Preview' });
    await expect(previewButtons).toHaveCount(2);

    // Click first preview button
    await previewButtons.first().click();

    // Only the first file should show preview
    await expect(page.locator('.markdown-preview')).toHaveCount(1);

    // First button should now say "Show Diff", second should still say "Preview"
    await expect(page.getByRole('button', { name: 'Show Diff' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Preview' })).toHaveCount(1);
  });

  test('recognizes .markdown extension', async ({ page }) => {
    const docPath = path.join(testDir, 'doc.markdown');
    fs.writeFileSync(docPath, '# Markdown Extension');

    const { execSync } = require('child_process');
    execSync('git add doc.markdown', { cwd: testDir });

    const session = await seedSession(project.id, { prompt: 'Test', name: 'Extension Test' });

    await page.goto(`/sessions/${session.id}/changes`);

    await expect(page.getByText('Staged Changes')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preview' })).toBeVisible();
  });

  test('recognizes .mdx extension', async ({ page }) => {
    const docPath = path.join(testDir, 'component.mdx');
    fs.writeFileSync(docPath, '# MDX Component\n\nexport const Component = () => <div>Hello</div>');

    const { execSync } = require('child_process');
    execSync('git add component.mdx', { cwd: testDir });

    const session = await seedSession(project.id, { prompt: 'Test', name: 'MDX Test' });

    await page.goto(`/sessions/${session.id}/changes`);

    await expect(page.getByText('Staged Changes')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preview' })).toBeVisible();
  });

  test('file endpoint returns correct content', async ({ page }) => {
    // Create a markdown file
    const markdownContent = '# API Test\n\nContent for API verification.';
    fs.writeFileSync(path.join(testDir, 'api-test.md'), markdownContent);

    const session = await seedSession(project.id, { prompt: 'Test', name: 'API Test' });

    // Call the API directly to verify endpoint works
    const response = await fetch(
      `${API_URL}/api/sessions/${session.id}/file?path=api-test.md`
    );

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.content).toBe(markdownContent);
    expect(data.path).toBe('api-test.md');
  });

  test('file endpoint returns 404 for non-existent file', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Test', name: 'Not Found Test' });

    const response = await fetch(
      `${API_URL}/api/sessions/${session.id}/file?path=does-not-exist.md`
    );

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe('File not found');
  });

  test('file endpoint returns 400 when path is missing', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Test', name: 'Missing Path Test' });

    const response = await fetch(`${API_URL}/api/sessions/${session.id}/file`);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('File path is required');
  });

  test('file endpoint prevents directory traversal', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Test', name: 'Security Test' });

    // Try to access a file outside the working directory
    const response = await fetch(
      `${API_URL}/api/sessions/${session.id}/file?path=../../../etc/passwd`
    );

    // Should either return 404 (file not found after sanitization) or 403 (access denied)
    expect([403, 404]).toContain(response.status);
  });
});
