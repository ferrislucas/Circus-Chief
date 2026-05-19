import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import TemplateCard from './TemplateCard.vue';

describe('TemplateCard', () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/projects/:projectId/templates/:templateId', component: { template: '<div />' } },
    ],
  });

  function mountCard(templateOverrides = {}) {
    return mount(TemplateCard, {
      props: {
        projectId: 'project-1',
        template: {
          id: 'template-1',
          name: 'Test Template',
          prompt: 'Test prompt',
          showInQuickResponses: false,
          quickResponseAutoSubmit: false,
          ...templateOverrides,
        },
        getModelName: (model) => model,
        getTemplateName: (templateId) => templateId,
      },
      global: {
        plugins: [router],
      },
    });
  }

  it('renders the quick response badge for templates shown in quick responses', () => {
    const wrapper = mountCard({ showInQuickResponses: true });

    expect(wrapper.text()).toContain('Quick Response');
  });

  it('does not render an auto-submit badge for old template auto-submit values', () => {
    const wrapper = mountCard({
      showInQuickResponses: true,
      quickResponseAutoSubmit: true,
    });

    expect(wrapper.text()).toContain('Quick Response');
    expect(wrapper.text()).not.toContain('Auto-submit');
  });
});
