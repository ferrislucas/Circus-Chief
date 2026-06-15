import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import TemplateApplySelector from './TemplateApplySelector.vue';
import { useTemplatesStore } from '../stores/templates.js';

describe('TemplateApplySelector', () => {
  let store;

  const projectTemplates = [
    { id: 'project-template-1', name: 'Project Template', prompt: 'Project prompt' },
  ];
  const globalTemplates = [
    { id: 'global-template-1', name: 'Global Template', prompt: 'Global prompt' },
  ];

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useTemplatesStore();
  });

  function mountComponent(props = {}) {
    return mount(TemplateApplySelector, {
      props: {
        projectId: 'project-1',
        ...props,
      },
    });
  }

  it('renders project and global optgroups when templates exist', async () => {
    store.projectTemplates = projectTemplates;
    store.globalTemplates = globalTemplates;

    const wrapper = mountComponent();
    await flushPromises();

    expect(wrapper.find('optgroup[label="Project Templates"]').exists()).toBe(true);
    expect(wrapper.find('optgroup[label="Global Templates"]').exists()).toBe(true);
    expect(wrapper.find('option[value="project-template-1"]').text()).toBe('Project Template');
    expect(wrapper.find('option[value="global-template-1"]').text()).toBe('Global Template');
  });

  it('is hidden when there are no templates', async () => {
    const wrapper = mountComponent();
    await flushPromises();

    expect(wrapper.find('.template-apply-selector').exists()).toBe(false);
  });

  it('emits apply with the selected template id and resets to default', async () => {
    store.currentProjectId = 'project-1';
    store.projectTemplates = projectTemplates;
    const onApply = vi.fn();

    const wrapper = mount(TemplateApplySelector, {
      props: { projectId: 'project-1' },
      attrs: { onApply },
    });
    await flushPromises();

    wrapper.vm.handleChange({ target: { value: 'project-template-1' } });

    expect(onApply).toHaveBeenCalledWith('project-template-1');
    expect(wrapper.find('select').element.value).toBe('');
  });

  it('fetches templates on mount when the store is empty', () => {
    const fetchProjectTemplates = vi.spyOn(store, 'fetchProjectTemplates').mockResolvedValue(undefined);

    mountComponent();

    expect(fetchProjectTemplates).toHaveBeenCalledWith('project-1');
  });

  it('does not fetch templates when already loaded for the project', () => {
    store.currentProjectId = 'project-1';
    store.projectTemplates = projectTemplates;
    const fetchProjectTemplates = vi.spyOn(store, 'fetchProjectTemplates');

    mountComponent();

    expect(fetchProjectTemplates).not.toHaveBeenCalled();
  });
});
