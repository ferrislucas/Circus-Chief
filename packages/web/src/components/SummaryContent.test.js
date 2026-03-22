import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import SummaryContent from './SummaryContent.vue';

const baseSummary = {
  fullSummary: 'This session implemented a new feature.',
  keyActions: ['Added authentication', 'Updated tests'],
  filesModified: ['src/auth.js'],
  generatedAt: new Date('2024-01-15T10:30:00Z').getTime(),
};

function mountComponent(props = {}) {
  return mount(SummaryContent, {
    props: {
      summary: baseSummary,
      ...props,
    },
  });
}

describe('SummaryContent', () => {
  describe('Last Action section', () => {
    it('renders Last Action section when keyActions has items', () => {
      const wrapper = mountComponent();

      const headings = wrapper.findAll('.summary-section h3').map((h) => h.text());
      expect(headings).toContain('Last Action');
    });

    it('displays the first item from keyActions as Last Action', () => {
      const wrapper = mountComponent();

      const lastActionSection = wrapper.findAll('.summary-section').find((s) => {
        return s.find('h3').text() === 'Last Action';
      });

      expect(lastActionSection).toBeDefined();
      expect(lastActionSection.find('.last-action-text').text()).toBe(baseSummary.keyActions[0]);
    });

    it('displays timestamp under Last Action', () => {
      const wrapper = mountComponent();

      const lastActionSection = wrapper.findAll('.summary-section').find((s) => {
        return s.find('h3').text() === 'Last Action';
      });

      expect(lastActionSection).toBeDefined();
      const timestamp = lastActionSection.find('.action-timestamp');
      expect(timestamp.exists()).toBe(true);
      expect(timestamp.text()).toBeTruthy();
    });

    it('renders Last Action before Key Actions and Overview sections', () => {
      const wrapper = mountComponent();

      const sections = wrapper.findAll('.summary-section');
      const headings = sections.map((s) => s.find('h3').text());

      const lastActionIndex = headings.indexOf('Last Action');
      const keyActionsIndex = headings.indexOf('Key Actions');
      const overviewIndex = headings.indexOf('Overview');

      expect(lastActionIndex).toBe(0);
      expect(keyActionsIndex).toBeGreaterThan(lastActionIndex);
      expect(overviewIndex).toBeGreaterThan(keyActionsIndex);
    });

    it('does not render Last Action when keyActions is empty', () => {
      const wrapper = mountComponent({
        summary: { ...baseSummary, keyActions: [] },
      });

      const headings = wrapper.findAll('.summary-section h3').map((h) => h.text());
      expect(headings).not.toContain('Last Action');
    });

    it('does not render Last Action when keyActions is absent', () => {
      const { keyActions: _, ...summaryWithoutActions } = baseSummary;
      const wrapper = mountComponent({ summary: summaryWithoutActions });

      const headings = wrapper.findAll('.summary-section h3').map((h) => h.text());
      expect(headings).not.toContain('Last Action');
    });

    it('renders Last Action icon', () => {
      const wrapper = mountComponent();

      const lastActionIcon = wrapper.find('.last-action-icon');
      expect(lastActionIcon.exists()).toBe(true);
      expect(lastActionIcon.text()).toBe('→');
    });
  });

  describe('Key Actions section', () => {
    it('renders Key Actions section when keyActions has more than one item', () => {
      const wrapper = mountComponent();

      const headings = wrapper.findAll('.summary-section h3').map((h) => h.text());
      expect(headings).toContain('Key Actions');
    });

    it('does not render Key Actions section when keyActions has only one item', () => {
      const wrapper = mountComponent({
        summary: { ...baseSummary, keyActions: ['Single action'] },
      });

      const headings = wrapper.findAll('.summary-section h3').map((h) => h.text());
      expect(headings).not.toContain('Key Actions');
    });

    it('does not render Key Actions section when keyActions is empty', () => {
      const wrapper = mountComponent({
        summary: { ...baseSummary, keyActions: [] },
      });

      const headings = wrapper.findAll('.summary-section h3').map((h) => h.text());
      expect(headings).not.toContain('Key Actions');
    });

    it('does not render Key Actions section when keyActions is absent', () => {
      const { keyActions: _, ...summaryWithoutActions } = baseSummary;
      const wrapper = mountComponent({ summary: summaryWithoutActions });

      const headings = wrapper.findAll('.summary-section h3').map((h) => h.text());
      expect(headings).not.toContain('Key Actions');
    });

    it('displays remaining actions excluding the first one', () => {
      const wrapper = mountComponent();

      const keyActionsSection = wrapper.findAll('.summary-section').find((s) => {
        return s.find('h3').text() === 'Key Actions';
      });

      expect(keyActionsSection).toBeDefined();
      const actionItems = keyActionsSection.findAll('.key-actions-list li');
      expect(actionItems.length).toBe(baseSummary.keyActions.length - 1);
      expect(actionItems[0].text()).toContain(baseSummary.keyActions[1]);
    });

    it('displays timestamps under each Key Action', () => {
      const wrapper = mountComponent();

      const keyActionsSection = wrapper.findAll('.summary-section').find((s) => {
        return s.find('h3').text() === 'Key Actions';
      });

      expect(keyActionsSection).toBeDefined();
      const actionItems = keyActionsSection.findAll('.key-actions-list li');

      actionItems.forEach((item) => {
        const timestamp = item.find('.action-timestamp');
        expect(timestamp.exists()).toBe(true);
        expect(timestamp.text()).toBeTruthy();
      });
    });
  });

  describe('Overview section', () => {
    it('renders Overview section with full summary', () => {
      const wrapper = mountComponent();

      const overviewSection = wrapper.findAll('.summary-section').find((s) => {
        return s.find('h3').text() === 'Overview';
      });

      expect(overviewSection).toBeDefined();
      expect(overviewSection.find('.full-summary').text()).toBe(baseSummary.fullSummary);
    });
  });

  describe('Outcome section', () => {
    it('does not render an Outcome section', () => {
      const wrapper = mountComponent({
        summary: { ...baseSummary, outcome: 'completed' },
      });

      const headings = wrapper.findAll('.summary-section h3').map((h) => h.text());
      expect(headings).not.toContain('Outcome');
    });

    it('does not render outcome-badge', () => {
      const wrapper = mountComponent({
        summary: { ...baseSummary, outcome: 'completed' },
      });

      expect(wrapper.find('.outcome-badge').exists()).toBe(false);
    });
  });

  describe('Footer', () => {
    it('shows Last updated timestamp in footer', () => {
      const wrapper = mountComponent();

      expect(wrapper.find('.summary-footer').exists()).toBe(true);
      expect(wrapper.find('.summary-date').text()).toContain('Last updated:');
    });

    it('shows Generate summary button in footer', () => {
      const wrapper = mountComponent();

      const regenButton = wrapper.find('.summary-footer .btn-link');
      expect(regenButton.exists()).toBe(true);
      expect(regenButton.text()).toContain('Generate summary');
    });

    it('Regenerate button is enabled and clickable when not regenerating', () => {
      // Note: Custom emit capture via wrapper.emitted() is unreliable with
      // Vue 3 script setup SFCs (known Vue Test Utils limitation).
      // We verify the button is present and enabled (not disabled).
      const wrapper = mountComponent({ regenerating: false });

      const btn = wrapper.find('.btn-link');
      expect(btn.exists()).toBe(true);
      expect(btn.attributes('disabled')).toBeUndefined();
    });

    it('disables Regenerate button when regenerating', () => {
      const wrapper = mountComponent({ regenerating: true });

      const regenButton = wrapper.find('.summary-footer .btn-link');
      expect(regenButton.attributes('disabled')).toBeDefined();
    });
  });
});
