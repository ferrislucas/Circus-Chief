import { describe, it, expect } from 'vitest';
import {
  renderMarkdown,
  transformTaskListTokens,
  MARKDOWN_ALLOWED_TAGS,
  MARKDOWN_ALLOWED_ATTRS,
} from './markdown.js';

function checkboxTags(html) {
  return [...html.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((m) => m[0]);
}

describe('markdown task-list checkboxes', () => {
  it('renders a checkbox for "- [ ]" and "- [x]" items', () => {
    const html = renderMarkdown('- [ ] todo\n- [x] done');
    const boxes = checkboxTags(html);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toContain('data-task-line="0"');
    expect(boxes[1]).toContain('data-task-line="1"');
    expect(boxes[0]).not.toContain('checked');
    expect(boxes[1]).toContain('checked');
  });

  it('supports [X], *, +, ordered and nested markers', () => {
    const src = [
      '* [ ] star',
      '+ [X] plus',
      '1. [ ] ordered',
      '- parent',
      '  - [ ] nested',
    ].join('\n');
    const html = renderMarkdown(src);
    const boxes = checkboxTags(html);
    expect(boxes).toHaveLength(4);
    expect(boxes.map((b) => /data-task-line="(\d+)"/.exec(b)[1])).toEqual(['0', '1', '2', '4']);
    expect(boxes[1]).toContain('checked');
  });

  it('does not render checkboxes for task-like text in fenced code blocks', () => {
    const src = '```\n- [ ] code\n```\n~~~\n- [x] tilde\n~~~';
    const html = renderMarkdown(src);
    expect(checkboxTags(html)).toHaveLength(0);
    expect(html).toContain('[ ]');
  });

  it('does not render checkboxes for inline code or plain paragraphs', () => {
    const html = renderMarkdown('Use `- [ ]` here\n\n- [ ] not a task, just text [x]');
    expect(checkboxTags(html)).toHaveLength(1);
  });

  it('renders malformed task markers as plain text', () => {
    const html = renderMarkdown('- []\n- [  ]\n- [y] nope');
    expect(checkboxTags(html)).toHaveLength(0);
  });

  it('keeps data-task-line while stripping smuggled attributes', () => {
    const html = renderMarkdown('- [ ] task');
    const boxes = checkboxTags(html);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toContain('data-task-line="0"');
    expect(boxes[0]).not.toContain('onclick');
    expect(boxes[0]).not.toContain('value=');
  });

  it('falls back to plain text when a line id cannot be assigned', () => {
    const tokens = [
      { type: 'list_item_open', map: null },
      { type: 'paragraph_open' },
      { type: 'inline', children: [{ type: 'text', content: '[ ] orphan' }] },
    ];
    transformTaskListTokens(tokens, true, []);
    expect(tokens[2].children).toHaveLength(1);
    expect(tokens[2].children[0].content).toBe('[ ] orphan');
  });

  it('never steals a nested item inline token for a text-less parent', () => {
    const nestedInline = { type: 'inline', children: [{ type: 'text', content: '[ ] child' }] };
    const tokens = [
      { type: 'list_item_open', map: [0, 2] },
      { type: 'bullet_list_open' },
      { type: 'list_item_open', map: [1, 2] },
      { type: 'paragraph_open' },
      nestedInline,
    ];
    transformTaskListTokens(tokens, true, []);
    // Checkbox attributed to the nested item's own line (1), not the parent's (0)
    expect(nestedInline.children).toHaveLength(2);
    expect(nestedInline.children[0].type).toBe('html_inline');
    expect(nestedInline.children[0].content).toContain('data-task-line="1"');
    expect(nestedInline.children[1].content).toBe('child');
  });

  it('allowlist keeps checkbox attributes but no event handlers or value', () => {
    expect(MARKDOWN_ALLOWED_TAGS).toContain('input');
    for (const attr of ['type', 'checked', 'disabled', 'data-task-line']) {
      expect(MARKDOWN_ALLOWED_ATTRS).toContain(attr);
    }
    for (const attr of ['onclick', 'onerror', 'onload', 'value', 'formaction']) {
      expect(MARKDOWN_ALLOWED_ATTRS).not.toContain(attr);
    }
  });

  it('renders blockquoted task checkboxes disabled even when interactive', () => {
    const html = renderMarkdown('> - [ ] quoted', { interactive: true });
    const boxes = checkboxTags(html);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toContain('disabled');
  });

  it('never addresses line 0 for invalid line ids', async () => {
    const { renderTaskCheckbox } = await import('./markdown.js');
    for (const bad of [-1, 'x', NaN, 1.5, null]) {
      const html = renderTaskCheckbox(bad, false);
      expect(html).toContain('disabled');
      expect(html).not.toContain('data-task-line');
      expect(html).not.toContain('data-task-line="0"');
    }
  });

  it('renders interactive checkboxes without disabled except pending lines', () => {
    const src = '- [ ] one\n- [ ] two';
    const html = renderMarkdown(src, { interactive: true });
    const boxes = checkboxTags(html);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).not.toContain('disabled');
    const pending = renderMarkdown(src, { interactive: true, disabledLines: [1] });
    const pendingBoxes = checkboxTags(pending);
    expect(pendingBoxes[0]).not.toContain('disabled');
    expect(pendingBoxes[1]).toContain('disabled');
  });
});
