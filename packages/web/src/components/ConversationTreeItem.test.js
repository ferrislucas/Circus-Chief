import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import ConversationTreeItem from './ConversationTreeItem.vue';

describe('ConversationTreeItem', () => {
  let baseConversation;
  let allConversations;

  beforeEach(() => {
    baseConversation = {
      id: 'conv-1',
      name: 'Test Conversation',
      messageCount: 5,
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      parentConversationId: null,
      childCount: 0,
    };

    allConversations = [baseConversation];
  });

  function mountComponent(conversationOverrides = {}, componentProps = {}) {
    return mount(ConversationTreeItem, {
      props: {
        conversation: { ...baseConversation, ...conversationOverrides },
        index: 0,
        depth: 0,
        allConversations,
        activeConversationId: null,
        ...componentProps,
      },
    });
  }

  describe('basic rendering', () => {
    it('renders the component', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.tree-item').exists()).toBe(true);
      expect(wrapper.find('.tree-item-row').exists()).toBe(true);
    });

    it('displays conversation name when provided', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.conv-name').text()).toBe('Test Conversation');
    });

    it('displays ordinal name when conversation has no name', () => {
      const wrapper = mountComponent({ name: null });
      expect(wrapper.find('.conv-name').text()).toBe('1st conversation');
    });

    it('displays correct ordinal for different indices', () => {
      const wrapper2 = mount(ConversationTreeItem, {
        props: {
          conversation: { ...baseConversation, name: null },
          index: 1,
          depth: 0,
          allConversations,
          activeConversationId: null,
        },
      });
      expect(wrapper2.find('.conv-name').text()).toBe('2nd conversation');

      const wrapper3 = mount(ConversationTreeItem, {
        props: {
          conversation: { ...baseConversation, name: null },
          index: 2,
          depth: 0,
          allConversations,
          activeConversationId: null,
        },
      });
      expect(wrapper3.find('.conv-name').text()).toBe('3rd conversation');

      const wrapper4 = mount(ConversationTreeItem, {
        props: {
          conversation: { ...baseConversation, name: null },
          index: 3,
          depth: 0,
          allConversations,
          activeConversationId: null,
        },
      });
      expect(wrapper4.find('.conv-name').text()).toBe('4th conversation');

      const wrapper11 = mount(ConversationTreeItem, {
        props: {
          conversation: { ...baseConversation, name: null },
          index: 10,
          depth: 0,
          allConversations,
          activeConversationId: null,
        },
      });
      expect(wrapper11.find('.conv-name').text()).toBe('11th conversation');
    });

    it('displays message count in metadata', () => {
      const wrapper = mountComponent({ messageCount: 5 });
      expect(wrapper.find('.conv-meta').text()).toContain('5 msgs');
    });

    it('displays message count as 0 when not provided', () => {
      const wrapper = mountComponent({ messageCount: null });
      expect(wrapper.find('.conv-meta').text()).toContain('0 msgs');
    });
  });

  describe('token display', () => {
    it('displays token count in metadata when tokens exist', () => {
      const wrapper = mountComponent({
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      });
      expect(wrapper.find('.conv-meta').text()).toContain('1.5K');
    });

    it('does not display token count when all tokens are zero', () => {
      const wrapper = mountComponent({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      });
      expect(wrapper.find('.conv-tokens').exists()).toBe(false);
    });

    it('includes cache read tokens in total', () => {
      const wrapper = mountComponent({
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 500,
        cacheCreationInputTokens: 0,
      });
      // 1000 + 500 + 500 + 0 = 2000 = 2.0K
      expect(wrapper.find('.conv-meta').text()).toContain('2.0K');
    });

    it('includes cache creation tokens in total', () => {
      const wrapper = mountComponent({
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 500,
      });
      // 1000 + 500 + 0 + 500 = 2000 = 2.0K
      expect(wrapper.find('.conv-meta').text()).toContain('2.0K');
    });

    it('includes all token types in total calculation', () => {
      const wrapper = mountComponent({
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 300,
        cacheCreationInputTokens: 200,
      });
      // 1000 + 500 + 300 + 200 = 2000 = 2.0K
      expect(wrapper.find('.conv-meta').text()).toContain('2.0K');
    });

    it('formats tokens with K for thousands', () => {
      const wrapper = mountComponent({
        inputTokens: 5000,
        outputTokens: 3000,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      });
      // 5000 + 3000 = 8000 = 8.0K
      expect(wrapper.find('.conv-meta').text()).toContain('8.0K');
    });

    it('formats tokens with M for millions', () => {
      const wrapper = mountComponent({
        inputTokens: 500000,
        outputTokens: 300000,
        cacheReadInputTokens: 200000,
        cacheCreationInputTokens: 0,
      });
      // 500000 + 300000 + 200000 = 1000000 = 1.0M
      expect(wrapper.find('.conv-meta').text()).toContain('1.0M');
    });

    it('formats tokens with one decimal place for K and M', () => {
      const wrapper = mountComponent({
        inputTokens: 1500,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      });
      // 1500 = 1.5K
      expect(wrapper.find('.conv-meta').text()).toContain('1.5K');
    });

    it('handles undefined token values as 0', () => {
      const wrapper = mountComponent({
        inputTokens: undefined,
        outputTokens: 500,
        cacheReadInputTokens: undefined,
        cacheCreationInputTokens: 0,
      });
      expect(wrapper.find('.conv-meta').text()).toContain('500');
    });

    it('handles null token values as 0', () => {
      const wrapper = mountComponent({
        inputTokens: null,
        outputTokens: 500,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: 0,
      });
      expect(wrapper.find('.conv-meta').text()).toContain('500');
    });
  });

  describe('branching indicator', () => {
    it('does not show branch indicator for root conversations', () => {
      const wrapper = mountComponent({ parentConversationId: null });
      expect(wrapper.find('.branch-indicator').exists()).toBe(false);
    });

    it('shows branch indicator for child conversations', () => {
      const wrapper = mountComponent({ parentConversationId: 'conv-parent' });
      expect(wrapper.find('.branch-indicator').exists()).toBe(true);
    });

    it('applies is-branch class when conversation is a branch', () => {
      const wrapper = mountComponent({ parentConversationId: 'conv-parent' });
      expect(wrapper.find('.tree-item.is-branch').exists()).toBe(true);
    });
  });

  describe('active state', () => {
    it('highlights active conversation', () => {
      const wrapper = mountComponent(
        { id: 'conv-1' },
        { activeConversationId: 'conv-1' }
      );
      const wrapper2 = mount(ConversationTreeItem, {
        props: {
          conversation: { ...baseConversation, id: 'conv-1' },
          index: 0,
          depth: 0,
          allConversations,
          activeConversationId: 'conv-1',
        },
      });
      expect(wrapper2.find('.tree-item-row.active').exists()).toBe(true);
    });

    it('does not highlight inactive conversation', () => {
      const wrapper = mount(ConversationTreeItem, {
        props: {
          conversation: { ...baseConversation, id: 'conv-1' },
          index: 0,
          depth: 0,
          allConversations,
          activeConversationId: 'conv-2',
        },
      });
      expect(wrapper.find('.tree-item-row.active').exists()).toBe(false);
    });

    it('applies is-active class when conversation is active', () => {
      const wrapper = mount(ConversationTreeItem, {
        props: {
          conversation: { ...baseConversation, id: 'conv-1' },
          index: 0,
          depth: 0,
          allConversations,
          activeConversationId: 'conv-1',
        },
      });
      expect(wrapper.find('.tree-item.is-active').exists()).toBe(true);
    });
  });

  describe('indentation based on depth', () => {
    it('does not show indent for root conversations (depth 0)', () => {
      const wrapper = mountComponent({ depth: 0 });
      expect(wrapper.find('.tree-indent').exists()).toBe(false);
    });

    it('shows indent for child conversations', () => {
      const wrapper = mount(ConversationTreeItem, {
        props: {
          conversation: { ...baseConversation, depth: 1 },
          index: 0,
          depth: 1,
          allConversations,
          activeConversationId: null,
        },
      });
      expect(wrapper.find('.tree-indent').exists()).toBe(true);
    });

    it('sets correct indent width based on depth', () => {
      const wrapper = mount(ConversationTreeItem, {
        props: {
          conversation: { ...baseConversation },
          index: 0,
          depth: 2,
          allConversations,
          activeConversationId: null,
        },
      });
      const indent = wrapper.find('.tree-indent');
      expect(indent.attributes('style')).toContain('width: 24px');
    });
  });

  describe('children handling', () => {
    it('shows expand toggle when conversation has children', () => {
      const childConv = { ...baseConversation, id: 'conv-child', parentConversationId: 'conv-1' };
      const wrapper = mount(ConversationTreeItem, {
        props: {
          conversation: { ...baseConversation, id: 'conv-1' },
          index: 0,
          depth: 0,
          allConversations: [baseConversation, childConv],
          activeConversationId: null,
        },
      });
      expect(wrapper.find('.expand-toggle').exists()).toBe(true);
    });

    it('does not show expand toggle when conversation has no children', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.expand-toggle').exists()).toBe(false);
    });

    it('shows expand placeholder when no children and depth > 0', () => {
      const wrapper = mount(ConversationTreeItem, {
        props: {
          conversation: { ...baseConversation },
          index: 0,
          depth: 1,
          allConversations,
          activeConversationId: null,
        },
      });
      expect(wrapper.find('.expand-placeholder').exists()).toBe(true);
    });

    it('displays children count badge', () => {
      const wrapper = mountComponent({ childCount: 3 });
      expect(wrapper.find('.children-badge').exists()).toBe(true);
      expect(wrapper.find('.children-badge').text()).toBe('3');
    });

    it('does not show children badge when childCount is 0', () => {
      const wrapper = mountComponent({ childCount: 0 });
      expect(wrapper.find('.children-badge').exists()).toBe(false);
    });
  });

  describe('delete button', () => {
    it('does not show delete button for the only conversation', () => {
      const wrapper = mount(ConversationTreeItem, {
        props: {
          conversation: { ...baseConversation, id: 'conv-1' },
          index: 0,
          depth: 0,
          allConversations: [{ ...baseConversation, id: 'conv-1' }],
          activeConversationId: null,
        },
      });
      expect(wrapper.find('.delete-btn').exists()).toBe(false);
    });

    it('shows delete button when there are multiple conversations and this is not active', () => {
      const conv2 = { ...baseConversation, id: 'conv-2', name: 'Conversation 2' };
      const wrapper = mount(ConversationTreeItem, {
        props: {
          conversation: { ...baseConversation, id: 'conv-1' },
          index: 0,
          depth: 0,
          allConversations: [baseConversation, conv2],
          activeConversationId: 'conv-2',
        },
      });
      expect(wrapper.find('.delete-btn').exists()).toBe(true);
    });

    it('does not show delete button for the active conversation', () => {
      const conv2 = { ...baseConversation, id: 'conv-2', name: 'Conversation 2' };
      const wrapper = mount(ConversationTreeItem, {
        props: {
          conversation: { ...baseConversation, id: 'conv-1' },
          index: 0,
          depth: 0,
          allConversations: [baseConversation, conv2],
          activeConversationId: 'conv-1',
        },
      });
      expect(wrapper.find('.delete-btn').exists()).toBe(false);
    });
  });

  describe('interaction tests', () => {
    it('row is clickable', () => {
      const wrapper = mountComponent();
      const row = wrapper.find('.tree-item-row');
      expect(row.exists()).toBe(true);
      expect(row.classes()).not.toContain('disabled');
    });

    it('delete button is clickable when visible', async () => {
      const conv2 = { ...baseConversation, id: 'conv-2', name: 'Conversation 2' };
      const wrapper = mount(ConversationTreeItem, {
        props: {
          conversation: { ...baseConversation, id: 'conv-1' },
          index: 0,
          depth: 0,
          allConversations: [baseConversation, conv2],
          activeConversationId: 'conv-2',
        },
      });
      const deleteBtn = wrapper.find('.delete-btn');
      expect(deleteBtn.exists()).toBe(true);
      await deleteBtn.trigger('click');
      // Event should not cause errors
      expect(wrapper.find('.delete-btn').exists()).toBe(true);
    });

    it('expand toggle stops click propagation to parent', async () => {
      const childConv = { ...baseConversation, id: 'conv-child', parentConversationId: 'conv-1' };
      const wrapper = mount(ConversationTreeItem, {
        props: {
          conversation: { ...baseConversation, id: 'conv-1' },
          index: 0,
          depth: 0,
          allConversations: [baseConversation, childConv],
          activeConversationId: null,
        },
      });
      const expandBtn = wrapper.find('.expand-toggle');
      expect(expandBtn.exists()).toBe(true);
      // Click should not cause errors and should only trigger expand, not select
      await expandBtn.trigger('click');
      expect(wrapper.find('.tree-children').exists()).toBe(false);
    });
  });

  describe('token display formatting edge cases', () => {
    it('formats 0 tokens as no display', () => {
      const wrapper = mountComponent({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      });
      expect(wrapper.find('.conv-tokens').exists()).toBe(false);
    });

    it('formats small token counts without abbreviation', () => {
      const wrapper = mountComponent({
        inputTokens: 100,
        outputTokens: 200,
        cacheReadInputTokens: 50,
        cacheCreationInputTokens: 50,
      });
      // 100 + 200 + 50 + 50 = 400
      expect(wrapper.find('.conv-meta').text()).toContain('400');
    });

    it('formats token count of exactly 1000', () => {
      const wrapper = mountComponent({
        inputTokens: 1000,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      });
      expect(wrapper.find('.conv-meta').text()).toContain('1.0K');
    });

    it('formats token count of 1500000', () => {
      const wrapper = mountComponent({
        inputTokens: 1500000,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      });
      expect(wrapper.find('.conv-meta').text()).toContain('1.5M');
    });

    it('correctly sums all token types for display', () => {
      const wrapper = mountComponent({
        inputTokens: 4000,
        outputTokens: 3000,
        cacheReadInputTokens: 2000,
        cacheCreationInputTokens: 1000,
      });
      // 4000 + 3000 + 2000 + 1000 = 10000 = 10.0K
      expect(wrapper.find('.conv-meta').text()).toContain('10.0K');
    });
  });

  describe('expand/collapse functionality', () => {
    it('shows expand button when has children', async () => {
      const childConv = { ...baseConversation, id: 'conv-child', parentConversationId: 'conv-1' };
      const wrapper = mount(ConversationTreeItem, {
        props: {
          conversation: { ...baseConversation, id: 'conv-1' },
          index: 0,
          depth: 0,
          allConversations: [baseConversation, childConv],
          activeConversationId: null,
        },
      });

      expect(wrapper.find('.expand-toggle').exists()).toBe(true);
    });

    it('starts with expand-icon rotated 90 degrees (expanded by default)', async () => {
      const childConv = { ...baseConversation, id: 'conv-child', parentConversationId: 'conv-1' };
      const wrapper = mount(ConversationTreeItem, {
        props: {
          conversation: { ...baseConversation, id: 'conv-1' },
          index: 0,
          depth: 0,
          allConversations: [baseConversation, childConv],
          activeConversationId: null,
        },
      });

      // Initially expanded by default, so expanded class should exist
      expect(wrapper.find('.expand-icon.expanded').exists()).toBe(true);
    });

    it('shows children container when expanded', async () => {
      const childConv = { ...baseConversation, id: 'conv-child', parentConversationId: 'conv-1' };
      const wrapper = mount(ConversationTreeItem, {
        props: {
          conversation: { ...baseConversation, id: 'conv-1' },
          index: 0,
          depth: 0,
          allConversations: [baseConversation, childConv],
          activeConversationId: null,
        },
      });

      // Initially expanded by default
      expect(wrapper.find('.tree-children').exists()).toBe(true);
    });

    it('collapses and expands when toggle button is clicked', async () => {
      const childConv = { ...baseConversation, id: 'conv-child', parentConversationId: 'conv-1' };
      const wrapper = mount(ConversationTreeItem, {
        props: {
          conversation: { ...baseConversation, id: 'conv-1' },
          index: 0,
          depth: 0,
          allConversations: [baseConversation, childConv],
          activeConversationId: null,
        },
      });

      // Initially expanded
      expect(wrapper.find('.tree-children').exists()).toBe(true);

      // Click to collapse
      await wrapper.find('.expand-toggle').trigger('click');
      await nextTick();
      expect(wrapper.find('.tree-children').exists()).toBe(false);

      // Click to expand again
      await wrapper.find('.expand-toggle').trigger('click');
      await nextTick();
      expect(wrapper.find('.tree-children').exists()).toBe(true);
    });
  });
});
