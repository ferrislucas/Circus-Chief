import { describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import AgentPromptCard from './AgentPromptCard.vue';

const prompt = { id: 'prompt-1', kind: 'question', payload: { questions: [{ question: 'Choose', multiSelect: true, options: [{ label: 'A', description: 'first' }, { label: 'B', description: 'second' }] }] } };

describe('AgentPromptCard', () => {
  it('makes Other mutually exclusive with selected options and preserves multi-select whitespace', async () => {
    const onRespond = vi.fn();
    const multiOtherPrompt = { id: 'multi-other', kind: 'question', payload: { questions: [{ question: 'Pick', multiSelect: true, options: [{ label: 'One', description: '' }, { label: 'Two', description: '' }] }] } };
    const wrapper = mount(AgentPromptCard, { props: { prompt: multiOtherPrompt, onRespond } });
    await wrapper.findAll('input[type="checkbox"]')[0].setValue(true);
    await wrapper.find('.other-input').setValue(' Three ');
    await wrapper.get('button.prompt-primary-action').trigger('click');
    expect(wrapper.find('input[type="checkbox"]').element.checked).toBe(false);
    await wrapper.get('button.prompt-primary-action').trigger('click');
    expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({
      answers: { Pick: [] }, customAnswers: { Pick: ' Three ' },
    }));
  });
  it('preserves meaningful single-select Other whitespace and does not submit whitespace-only input', async () => {
    const onRespond = vi.fn();
    const singleOtherPrompt = { id: 'single-other', kind: 'question', payload: { questions: [{ question: 'Pick', multiSelect: false, options: [{ label: 'One', description: '' }, { label: 'Two', description: '' }] }] } };
    const wrapper = mount(AgentPromptCard, { props: { prompt: singleOtherPrompt, onRespond } });

    await wrapper.find('.other-input').setValue('   ');
    expect(wrapper.get('button.prompt-primary-action').attributes('disabled')).toBeDefined();
    await wrapper.find('.other-input').setValue('  Custom pick  ');
    await wrapper.get('button.prompt-primary-action').trigger('click');

    expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({
      answers: { Pick: [] }, customAnswers: { Pick: '  Custom pick  ' },
    }));
  });
  it('joins multi-select values and requires every question to be answered', async () => {
    const onRespond = vi.fn();
    const wrapper = mount(AgentPromptCard, { props: { prompt, onRespond } });
    await flushPromises();
    const inputs = wrapper.findAll('input[type="checkbox"]');
    await inputs[0].setValue(true);
    await inputs[1].setValue(true);
    await nextTick();
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined();
    await wrapper.get('button').trigger('click');
    expect(onRespond).toHaveBeenCalledWith({ action: 'answer', answers: { Choose: ['A', 'B'] } });
  });

  it('does not treat an optional question note as an answer to unanswered questions', async () => {
    const wrapper = mount(AgentPromptCard, { props: { prompt } });
    await wrapper.get('.question-note').setValue('Some context');
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
  });

  it('does not apply prompt shortcuts while typing in a text field', async () => {
    const onRespond = vi.fn();
    const singleQuestion = { id: 'prompt-shortcuts', kind: 'question', payload: { questions: [{ question: 'Choose', options: [{ label: 'A', description: 'first' }] }] } };
    const wrapper = mount(AgentPromptCard, { props: { prompt: singleQuestion, onRespond } });

    const other = wrapper.get('input[placeholder="Other…"]');
    await other.trigger('keydown', { key: '1' });
    await other.trigger('keydown', { key: 'Enter' });

    expect(wrapper.get('input[type="radio"]').element.checked).toBe(false);
    expect(onRespond).not.toHaveBeenCalled();
  });

  it('keeps shortcuts inactive when no prompt is displayed', async () => {
    const onRespond = vi.fn();
    mount(AgentPromptCard, { props: { prompt: null, onRespond } });
    await document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onRespond).not.toHaveBeenCalled();
  });

  it('returns selected previews and per-question notes without mixing Other state', async () => {
    const onRespond = vi.fn();
    const annotated = { id: 'annotated', kind: 'question', payload: { questions: [{
      question: 'Choose', options: [{ label: 'A', description: 'first', preview: 'Preview A' }], multiSelect: false,
    }] } };
    const wrapper = mount(AgentPromptCard, { props: { prompt: annotated, onRespond } });

    await wrapper.get('.question-note').setValue('Because it is safer');
    await wrapper.get('input[type="radio"]').setValue(true);
    await wrapper.get('button').trigger('click');

    expect(onRespond).toHaveBeenCalledWith({
      action: 'answer', answers: { Choose: ['A'] },
      annotations: { Choose: { notes: 'Because it is safer', preview: 'Preview A' } },
    });
  });

  it('keeps Other as the answer and merges a distinct per-question note', async () => {
    const onRespond = vi.fn();
    const wrapper = mount(AgentPromptCard, { props: { prompt, onRespond } });
    await wrapper.get('.other-input').setValue('  Custom answer  ');
    await wrapper.get('.question-note').setValue('Why this is needed');
    await wrapper.get('button.prompt-primary-action').trigger('click');
    expect(onRespond).toHaveBeenCalledWith({
      action: 'answer', answers: { Choose: [] }, customAnswers: { Choose: '  Custom answer  ' },
      annotations: { Choose: { notes: 'Why this is needed' } },
    });
  });

  it('keeps blank lines in permission diff line numbers and counts', async () => {
    const permission = { id: 'diff', kind: 'permission', payload: {
      toolName: 'Edit', input: { file_path: 'example.txt', old_string: 'first\n\nthird', new_string: 'first\n\nupdated' },
    } };
    const wrapper = mount(AgentPromptCard, { props: { prompt: permission } });
    const diff = wrapper.getComponent({ name: 'DiffViewer' });

    expect(diff.props('files')[0]).toMatchObject({ additions: 3, deletions: 3 });
    expect(diff.props('files')[0].hunks[0].lines).toEqual([
      { type: 'remove', content: 'first', oldLineNumber: 1 },
      { type: 'remove', content: '', oldLineNumber: 2 },
      { type: 'remove', content: 'third', oldLineNumber: 3 },
      { type: 'add', content: 'first', newLineNumber: 1 },
      { type: 'add', content: '', newLineNumber: 2 },
      { type: 'add', content: 'updated', newLineNumber: 3 },
    ]);
  });

  it('uses semantic option cards and only reveals previews for focused or selected options', async () => {
    const withPreviews = { id: 'previews', kind: 'question', payload: { questions: [{
      question: 'Choose', options: [
        { label: 'A', description: 'first', preview: 'Preview A' },
        { label: 'B', description: 'second', preview: 'Preview B' },
      ],
    }] } };
    const wrapper = mount(AgentPromptCard, { attachTo: document.body, props: { prompt: withPreviews } });

    expect(wrapper.findAll('.option-card')).toHaveLength(3);
    await flushPromises();
    wrapper.findAll('.option-control')[1].element.focus();
    await nextTick();
    expect(wrapper.text()).toContain('Preview B');
    expect(wrapper.text()).not.toContain('Preview A');
    await wrapper.findAll('.option-control')[0].setValue(true);
    expect(wrapper.findAll('.option-card')[0].classes()).toContain('is-selected');
    expect(wrapper.text()).toContain('Preview A');
    wrapper.unmount();
  });

  it('focuses the first answer control when a question is shown', async () => {
    const wrapper = mount(AgentPromptCard, { attachTo: document.body, props: { prompt } });
    await flushPromises();
    expect(document.activeElement).toBe(wrapper.find('.option-control').element);
    wrapper.unmount();
  });

  it('reveals denial details only after Deny is chosen and disables all decision controls while pending', async () => {
    const permission = { id: 'permission', kind: 'permission', payload: { toolName: 'Bash', input: { command: 'ls' }, suggestions: [{ type: 'addRules', rules: [] }] } };
    const wrapper = mount(AgentPromptCard, { props: { prompt: permission, submitting: false } });
    expect(wrapper.find('.deny-reason').exists()).toBe(false);
    await wrapper.get('.deny-action').trigger('click');
    expect(wrapper.find('.deny-reason').exists()).toBe(true);
    expect(wrapper.find('.permission-evidence').text()).toContain('Proposed change');
    await wrapper.setProps({ submitting: true });
    expect(wrapper.get('.prompt-primary-action').attributes('disabled')).toBeDefined();
    expect(wrapper.get('.deny-reason input').attributes('disabled')).toBeDefined();
    expect(wrapper.find('.pending-state').text()).toContain('Saving decision');
  });
});
