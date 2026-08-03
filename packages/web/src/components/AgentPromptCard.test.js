import { describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import AgentPromptCard from './AgentPromptCard.vue';

const prompt = { id: 'prompt-1', kind: 'question', payload: { questions: [{ question: 'Choose', multiSelect: true, options: [{ label: 'A', description: 'first' }, { label: 'B', description: 'second' }] }] } };

describe('AgentPromptCard', () => {
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
    expect(onRespond).toHaveBeenCalledWith({ action: 'answer', answers: { Choose: 'A, B' } });
  });

  it('does not treat free response as an answer to unanswered questions', async () => {
    const wrapper = mount(AgentPromptCard, { props: { prompt } });
    await wrapper.get('textarea').setValue('Some context');
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
});
