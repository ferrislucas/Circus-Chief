import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import AgentLogsView from './AgentLogsView.vue';

// Mock the agent logs store
vi.mock('../stores/agentLogs.js', () => ({
  useAgentLogsStore: vi.fn(),
}));

import { useAgentLogsStore } from '../stores/agentLogs.js';

describe('AgentLogsView - Effort Level Display', () => {
  let mockStore;

  beforeEach(() => {
    setActivePinia(createPinia());

    mockStore = {
      logs: [],
      pagination: { total: 0, offset: 0 },
      filters: {},
      filterOptions: { agentTypes: [], callTypes: [], statuses: [], models: [] },
      perPage: 25,
      currentPage: 1,
      totalPages: 1,
      sortBy: 'started_at',
      sortOrder: 'DESC',
      loading: false,
      error: null,
      fetchLogs: vi.fn(),
      fetchFilterOptions: vi.fn(),
      setFilter: vi.fn(),
      setSort: vi.fn(),
      setPage: vi.fn(),
      setPerPage: vi.fn(),
      clearFilters: vi.fn(),
      clearAllLogs: vi.fn(),
    };

    useAgentLogsStore.mockReturnValue(mockStore);
  });

  describe('Effort column display', () => {
    it('displays effort badge when metadata contains effortLevel', () => {
      mockStore.logs = [
        {
          id: 'log-1',
          status: 'completed',
          agentType: 'claude-code',
          callType: 'runSession',
          model: 'claude-sonnet-4-20250514',
          sessionId: 'session-1',
          sessionName: 'Test Session',
          totalTokens: 1000,
          durationMs: 5000,
          startedAt: Date.now(),
          metadata: '{"effortLevel": "high"}',
        },
      ];

      const wrapper = mount(AgentLogsView);
      expect(wrapper.html()).toContain('effort-badge');
      expect(wrapper.html()).toContain('High');
    });

    it('displays dash when metadata is null', () => {
      mockStore.logs = [
        {
          id: 'log-1',
          status: 'completed',
          agentType: 'claude-code',
          callType: 'runSession',
          model: 'claude-sonnet-4-20250514',
          sessionId: 'session-1',
          sessionName: 'Test Session',
          totalTokens: 1000,
          durationMs: 5000,
          startedAt: Date.now(),
          metadata: null,
        },
      ];

      const wrapper = mount(AgentLogsView);
      expect(wrapper.text()).toContain('—');
    });

    it('displays effort level for all valid values', () => {
      const labels = {
        'auto': 'Auto',
        'low': 'Low',
        'medium': 'Med',
        'high': 'High',
        'max': 'Max',
      };

      for (const [level, label] of Object.entries(labels)) {
        mockStore.logs = [
          {
            id: 'log-1',
            status: 'completed',
            agentType: 'claude-code',
            callType: 'runSession',
            model: 'claude-sonnet-4-20250514',
            sessionId: 'session-1',
            sessionName: 'Test Session',
            totalTokens: 1000,
            durationMs: 5000,
            startedAt: Date.now(),
            metadata: JSON.stringify({ effortLevel: level }),
          },
        ];

        const wrapper = mount(AgentLogsView);
        expect(wrapper.html()).toContain(`effort-${level}`);
        expect(wrapper.html()).toContain(label);
      }
    });

    it('handles metadata as object', () => {
      mockStore.logs = [
        {
          id: 'log-1',
          status: 'completed',
          agentType: 'claude-code',
          callType: 'runSession',
          model: 'claude-sonnet-4-20250514',
          sessionId: 'session-1',
          sessionName: 'Test Session',
          totalTokens: 1000,
          durationMs: 5000,
          startedAt: Date.now(),
          metadata: { effortLevel: 'max' },
        },
      ];

      const wrapper = mount(AgentLogsView);
      expect(wrapper.html()).toContain('effort-max');
      expect(wrapper.html()).toContain('Max');
    });

    it('handles invalid JSON gracefully', () => {
      mockStore.logs = [
        {
          id: 'log-1',
          status: 'completed',
          agentType: 'claude-code',
          callType: 'runSession',
          model: 'claude-sonnet-4-20250514',
          sessionId: 'session-1',
          sessionName: 'Test Session',
          totalTokens: 1000,
          durationMs: 5000,
          startedAt: Date.now(),
          metadata: 'invalid json{',
        },
      ];

      const wrapper = mount(AgentLogsView);
      expect(wrapper.text()).toContain('—');
    });

    it('handles empty metadata object', () => {
      mockStore.logs = [
        {
          id: 'log-1',
          status: 'completed',
          agentType: 'claude-code',
          callType: 'runSession',
          model: 'claude-sonnet-4-20250514',
          sessionId: 'session-1',
          sessionName: 'Test Session',
          totalTokens: 1000,
          durationMs: 5000,
          startedAt: Date.now(),
          metadata: '{}',
        },
      ];

      const wrapper = mount(AgentLogsView);
      expect(wrapper.text()).toContain('—');
    });

    it('handles metadata without effortLevel', () => {
      mockStore.logs = [
        {
          id: 'log-1',
          status: 'completed',
          agentType: 'claude-code',
          callType: 'runSession',
          model: 'claude-sonnet-4-20250514',
          sessionId: 'session-1',
          sessionName: 'Test Session',
          totalTokens: 1000,
          durationMs: 5000,
          startedAt: Date.now(),
          metadata: JSON.stringify({ thinkingEnabled: true }),
        },
      ];

      const wrapper = mount(AgentLogsView);
      expect(wrapper.text()).toContain('—');
    });
  });
});
