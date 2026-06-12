import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import TemplateListView from './TemplateListView.vue';

vi.mock('vue-router', () => ({
  useRoute: () => ({
    params: { id: 'project-123' },
  }),
}));

vi.mock('../components/TemplatesPanel.vue', () => ({
  default: {
    name: 'TemplatesPanel',
    props: ['projectId'],
    template: '<div class="templates-panel" :data-project-id="projectId" />',
  },
}));

describe('TemplateListView', () => {
  it('renders TemplatesPanel for the route project', () => {
    const wrapper = mount(TemplateListView);

    const panel = wrapper.find('.templates-panel');
    expect(panel.exists()).toBe(true);
    expect(panel.attributes('data-project-id')).toBe('project-123');
  });
});
