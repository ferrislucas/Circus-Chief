import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import MarkdownViewer from './MarkdownViewer.vue';

const TASK_CONTENT = '- [ ] first\n- [x] second';

function mountViewer(props = {}) {
  const onToggleTask = vi.fn();
  const wrapper = mount(MarkdownViewer, {
    props: { content: TASK_CONTENT, onToggleTask, ...props },
  });
  return { wrapper, onToggleTask };
}

function clickCheckbox(wrapper, line) {
  wrapper.find(`input[data-task-line="${line}"]`).element.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true }),
  );
}

describe('MarkdownViewer interactive task lists', () => {
  it('renders disabled checkboxes by default', () => {
    const { wrapper } = mountViewer();
    const boxes = wrapper.findAll('input[type="checkbox"][data-task-line]');
    expect(boxes).toHaveLength(2);
    expect(boxes[0].attributes('disabled')).not.toBeUndefined();
  });

  it('renders enabled checkboxes when interactive', () => {
    const { wrapper } = mountViewer({ interactive: true });
    const boxes = wrapper.findAll('input[type="checkbox"][data-task-line]');
    expect(boxes).toHaveLength(2);
    expect(boxes[0].attributes('disabled')).toBeUndefined();
  });

  it('emits toggle-task with the source line on checkbox click', async () => {
    const { wrapper, onToggleTask } = mountViewer({ interactive: true });
    clickCheckbox(wrapper, 1);
    await wrapper.vm.$nextTick();
    expect(onToggleTask).toHaveBeenCalledTimes(1);
    expect(onToggleTask.mock.calls[0][0]).toMatchObject({ line: 1 });
  });

  it('does not emit when not interactive', async () => {
    const { wrapper, onToggleTask } = mountViewer();
    clickCheckbox(wrapper, 0);
    await wrapper.vm.$nextTick();
    expect(onToggleTask).not.toHaveBeenCalled();
  });

  it('does not emit when disabled', async () => {
    const { wrapper, onToggleTask } = mountViewer({ interactive: true, disabled: true });
    expect(wrapper.find('input[data-task-line="0"]').attributes('disabled')).not.toBeUndefined();
    clickCheckbox(wrapper, 0);
    await wrapper.vm.$nextTick();
    expect(onToggleTask).not.toHaveBeenCalled();
  });

  it('keeps only the pending line disabled', () => {
    const { wrapper } = mountViewer({ interactive: true, pendingLine: 1 });
    expect(wrapper.find('input[data-task-line="0"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.find('input[data-task-line="1"]').attributes('disabled')).not.toBeUndefined();
  });

  it('emits toggle-task on Space keydown', async () => {
    const { wrapper, onToggleTask } = mountViewer({ interactive: true });
    wrapper.find('input[data-task-line="0"]').element.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
    );
    await wrapper.vm.$nextTick();
    expect(onToggleTask).toHaveBeenCalledTimes(1);
    expect(onToggleTask.mock.calls[0][0]).toMatchObject({ line: 0 });
  });

  it('ignores clicks outside checkboxes', async () => {
    const { wrapper, onToggleTask } = mountViewer({ interactive: true });
    wrapper.find('.markdown-viewer').element.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    await wrapper.vm.$nextTick();
    expect(onToggleTask).not.toHaveBeenCalled();
  });
});
