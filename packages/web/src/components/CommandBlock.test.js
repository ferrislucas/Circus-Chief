import { describe, it, expect } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import CommandBlock from './CommandBlock.vue';

async function flushAll(wrapper) {
  await flushPromises();
  await nextTick();
  if (wrapper && wrapper.vm) {
    await wrapper.vm.$nextTick?.();
    await wrapper.vm.$forceUpdate();
    await nextTick();
    await wrapper.vm.$forceUpdate();
    await nextTick();
  }
}

describe('CommandBlock', () => {
  function mountComponent(log) {
    return mount(CommandBlock, {
      props: { log },
    });
  }

  describe('tool output display', () => {
    it('displays raw content for tool_output logs', () => {
      const wrapper = mountComponent({
        type: 'tool_output',
        toolName: 'Bash',
        content: 'command output here',
        timestamp: Date.now(),
      });

      expect(wrapper.find('.command-summary').exists()).toBe(false);
      expect(wrapper.find('.raw-json-details').exists()).toBe(false);
      expect(wrapper.find('.command-pre').text()).toBe('command output here');
    });

    it('shows Output label for tool_output', () => {
      const wrapper = mountComponent({
        type: 'tool_output',
        toolName: 'Bash',
        content: 'output',
        timestamp: Date.now(),
      });

      expect(wrapper.find('.command-label').text()).toBe('Output');
    });
  });

  describe('command summary extraction', () => {
    it('extracts command from Bash tool input', () => {
      const wrapper = mountComponent({
        type: 'tool_input',
        toolName: 'Bash',
        content: JSON.stringify({ command: 'git status', timeout: 30000 }),
        timestamp: Date.now(),
      });

      expect(wrapper.find('.command-summary code').text()).toBe('git status');
      expect(wrapper.find('.raw-json-details').exists()).toBe(true);
    });

    it('extracts file_path from Read tool input', () => {
      const wrapper = mountComponent({
        type: 'tool_input',
        toolName: 'Read',
        content: JSON.stringify({ file_path: '/src/index.js' }),
        timestamp: Date.now(),
      });

      expect(wrapper.find('.command-summary code').text()).toBe('/src/index.js');
    });

    it('extracts file_path from Edit tool input', () => {
      const wrapper = mountComponent({
        type: 'tool_input',
        toolName: 'Edit',
        content: JSON.stringify({
          file_path: '/src/app.js',
          old_string: 'foo',
          new_string: 'bar',
        }),
        timestamp: Date.now(),
      });

      expect(wrapper.find('.command-summary code').text()).toBe('/src/app.js');
    });

    it('extracts file_path from Write tool input', () => {
      const wrapper = mountComponent({
        type: 'tool_input',
        toolName: 'Write',
        content: JSON.stringify({ file_path: '/new-file.js', content: 'file content' }),
        timestamp: Date.now(),
      });

      expect(wrapper.find('.command-summary code').text()).toBe('/new-file.js');
    });

    it('extracts pattern from Grep tool input without path', () => {
      const wrapper = mountComponent({
        type: 'tool_input',
        toolName: 'Grep',
        content: JSON.stringify({ pattern: 'TODO' }),
        timestamp: Date.now(),
      });

      expect(wrapper.find('.command-summary code').text()).toBe('"TODO"');
    });

    it('extracts pattern and path from Grep tool input', () => {
      const wrapper = mountComponent({
        type: 'tool_input',
        toolName: 'Grep',
        content: JSON.stringify({ pattern: 'import.*vue', path: '/src' }),
        timestamp: Date.now(),
      });

      expect(wrapper.find('.command-summary code').text()).toBe('"import.*vue" in /src');
    });

    it('extracts pattern from Glob tool input', () => {
      const wrapper = mountComponent({
        type: 'tool_input',
        toolName: 'Glob',
        content: JSON.stringify({ pattern: '**/*.vue' }),
        timestamp: Date.now(),
      });

      expect(wrapper.find('.command-summary code').text()).toBe('**/*.vue');
    });

    it('extracts description from Task tool input', () => {
      const wrapper = mountComponent({
        type: 'tool_input',
        toolName: 'Task',
        content: JSON.stringify({
          description: 'Find all Vue components',
          prompt: 'Search for Vue components...',
        }),
        timestamp: Date.now(),
      });

      expect(wrapper.find('.command-summary code').text()).toBe('Find all Vue components');
    });

    it('extracts prompt when Task has no description', () => {
      const prompt = 'A'.repeat(150);
      const wrapper = mountComponent({
        type: 'tool_input',
        toolName: 'Task',
        content: JSON.stringify({ prompt }),
        timestamp: Date.now(),
      });

      // Should truncate to 100 characters
      expect(wrapper.find('.command-summary code').text()).toBe(prompt.slice(0, 100));
    });

    it('extracts url from WebFetch tool input', () => {
      const wrapper = mountComponent({
        type: 'tool_input',
        toolName: 'WebFetch',
        content: JSON.stringify({ url: 'https://example.com/docs', prompt: 'get info' }),
        timestamp: Date.now(),
      });

      expect(wrapper.find('.command-summary code').text()).toBe('https://example.com/docs');
    });

    it('extracts query from WebSearch tool input', () => {
      const wrapper = mountComponent({
        type: 'tool_input',
        toolName: 'WebSearch',
        content: JSON.stringify({ query: 'vue 3 composition api' }),
        timestamp: Date.now(),
      });

      expect(wrapper.find('.command-summary code').text()).toBe('vue 3 composition api');
    });

    it('handles case-insensitive tool names', () => {
      const wrapper = mountComponent({
        type: 'tool_input',
        toolName: 'BASH',
        content: JSON.stringify({ command: 'npm test' }),
        timestamp: Date.now(),
      });

      expect(wrapper.find('.command-summary code').text()).toBe('npm test');
    });
  });

  describe('fallback to raw JSON display', () => {
    it('shows raw JSON for unknown tool types', () => {
      const content = JSON.stringify({ some: 'data' });
      const wrapper = mountComponent({
        type: 'tool_input',
        toolName: 'UnknownTool',
        content,
        timestamp: Date.now(),
      });

      expect(wrapper.find('.command-summary').exists()).toBe(false);
      expect(wrapper.find('.command-pre').text()).toBe(content);
    });

    it('shows raw content when JSON parsing fails', () => {
      const wrapper = mountComponent({
        type: 'tool_input',
        toolName: 'Bash',
        content: 'not valid json',
        timestamp: Date.now(),
      });

      expect(wrapper.find('.command-summary').exists()).toBe(false);
      expect(wrapper.find('.command-pre').text()).toBe('not valid json');
    });

    it('shows raw JSON when tool input lacks expected field', () => {
      const content = JSON.stringify({ other_field: 'value' });
      const wrapper = mountComponent({
        type: 'tool_input',
        toolName: 'Bash',
        content,
        timestamp: Date.now(),
      });

      // command field is undefined, so commandSummary returns undefined/null
      expect(wrapper.find('.command-summary').exists()).toBe(false);
    });
  });

  describe('collapsible raw JSON', () => {
    it('hides raw JSON by default when summary is shown', () => {
      const wrapper = mountComponent({
        type: 'tool_input',
        toolName: 'Bash',
        content: JSON.stringify({ command: 'ls -la' }),
        timestamp: Date.now(),
      });

      const details = wrapper.find('.raw-json-details');
      expect(details.exists()).toBe(true);
      expect(details.attributes('open')).toBeUndefined();
    });

    it('contains Show raw JSON summary text', () => {
      const wrapper = mountComponent({
        type: 'tool_input',
        toolName: 'Bash',
        content: JSON.stringify({ command: 'ls -la' }),
        timestamp: Date.now(),
      });

      expect(wrapper.find('.raw-json-details summary').text()).toBe('Show raw JSON');
    });

    it('shows full JSON content in details', () => {
      const inputJson = { command: 'ls -la', timeout: 5000 };
      const wrapper = mountComponent({
        type: 'tool_input',
        toolName: 'Bash',
        content: JSON.stringify(inputJson, null, 2),
        timestamp: Date.now(),
      });

      expect(wrapper.find('.raw-json-details .command-pre').text()).toBe(
        JSON.stringify(inputJson, null, 2)
      );
    });
  });

  describe('header display', () => {
    it('shows Input label for tool_input', () => {
      const wrapper = mountComponent({
        type: 'tool_input',
        toolName: 'Bash',
        content: JSON.stringify({ command: 'test' }),
        timestamp: Date.now(),
      });

      expect(wrapper.find('.command-label').text()).toBe('Input');
    });

    it('displays tool name', () => {
      const wrapper = mountComponent({
        type: 'tool_input',
        toolName: 'Grep',
        content: JSON.stringify({ pattern: 'test' }),
        timestamp: Date.now(),
      });

      expect(wrapper.find('.command-tool-name').text()).toBe('Grep');
    });

    it('displays formatted timestamp', () => {
      const timestamp = new Date('2024-01-15T10:30:00').getTime();
      const wrapper = mountComponent({
        type: 'tool_input',
        toolName: 'Bash',
        content: JSON.stringify({ command: 'test' }),
        timestamp,
      });

      const timeText = wrapper.find('.command-time').text();
      expect(timeText).toMatch(/10:30/);
    });
  });

  describe('content truncation for outputs', () => {
    it('truncates long output content', async () => {
      const longContent = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n');
      const wrapper = mountComponent({
        type: 'tool_output',
        toolName: 'Bash',
        content: longContent,
        timestamp: Date.now(),
      });

      // Should be truncated to 10 lines + "..."
      const displayedLines = wrapper.find('.command-pre').text().split('\n');
      expect(displayedLines.length).toBe(11); // 10 lines + "..."
      expect(displayedLines[10]).toBe('...');
    });

    it('shows "Show more" button for truncated content', () => {
      const longContent = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n');
      const wrapper = mountComponent({
        type: 'tool_output',
        toolName: 'Bash',
        content: longContent,
        timestamp: Date.now(),
      });

      expect(wrapper.find('.show-more-btn').text()).toContain('Show more');
      expect(wrapper.find('.show-more-btn').text()).toContain('20 lines');
    });

    it('expands content when "Show more" is clicked', async () => {
      const longContent = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n');
      const wrapper = mountComponent({
        type: 'tool_output',
        toolName: 'Bash',
        content: longContent,
        timestamp: Date.now(),
      });

      const button = wrapper.find('.show-more-btn');
      await button.trigger('click');
      await flushAll(wrapper);

      expect(wrapper.find('.command-pre').text()).toBe(longContent);
      expect(wrapper.find('.show-more-btn').text()).toBe('Show less');
    });
  });

  describe('styling classes', () => {
    it('applies tool_input class for input logs', () => {
      const wrapper = mountComponent({
        type: 'tool_input',
        toolName: 'Bash',
        content: JSON.stringify({ command: 'test' }),
        timestamp: Date.now(),
      });

      expect(wrapper.find('.command-block').classes()).toContain('command-tool_input');
    });

    it('applies tool_output class for output logs', () => {
      const wrapper = mountComponent({
        type: 'tool_output',
        toolName: 'Bash',
        content: 'output',
        timestamp: Date.now(),
      });

      expect(wrapper.find('.command-block').classes()).toContain('command-tool_output');
    });
  });
});
