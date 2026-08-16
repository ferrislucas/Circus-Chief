import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';
import { useSessionFiltering } from './useSessionFiltering.js';

// Mock the sessions store
const mockSessionsStore = reactive({
  statusFilter: null,
  starredFilter: null,
  scheduledFilter: null,
  groupedSessions: [],
  setStatusFilter: vi.fn(function (filter) {
    this.statusFilter = filter;
  }),
  setStarredFilter: vi.fn(function (filter) {
    this.starredFilter = filter;
  }),
  setScheduledFilter: vi.fn(function (filter) {
    this.scheduledFilter = filter;
  }),
  getWorkflowAggregatedStatus: vi.fn((sessionId) => ({
    effectiveStatus: 'idle',
    runningCount: 0,
    scheduledCount: 0,
  })),
});

vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(() => mockSessionsStore),
}));

describe('useSessionFiltering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionsStore.statusFilter = null;
    mockSessionsStore.starredFilter = null;
    mockSessionsStore.scheduledFilter = null;
    mockSessionsStore.groupedSessions = [];
    mockSessionsStore.getWorkflowAggregatedStatus.mockReset();
  });

  describe('toggleFilter', () => {
    it('sets status filter when not currently active', () => {
      const { toggleFilter } = useSessionFiltering();
      toggleFilter('running');
      expect(mockSessionsStore.setStatusFilter).toHaveBeenCalledWith('running');
    });

    it('clears status filter when already active', () => {
      mockSessionsStore.statusFilter = 'running';
      const { toggleFilter } = useSessionFiltering();
      toggleFilter('running');
      expect(mockSessionsStore.setStatusFilter).toHaveBeenCalledWith(null);
    });

    it('switches from running to idle', () => {
      mockSessionsStore.statusFilter = 'running';
      const { toggleFilter } = useSessionFiltering();
      toggleFilter('idle');
      expect(mockSessionsStore.setStatusFilter).toHaveBeenCalledWith('idle');
    });
  });

  describe('toggleStarredFilter', () => {
    it('sets starred filter when not currently active', () => {
      const { toggleStarredFilter } = useSessionFiltering();
      toggleStarredFilter('starred');
      expect(mockSessionsStore.setStarredFilter).toHaveBeenCalledWith('starred');
    });

    it('clears starred filter when already active', () => {
      mockSessionsStore.starredFilter = 'starred';
      const { toggleStarredFilter } = useSessionFiltering();
      toggleStarredFilter('starred');
      expect(mockSessionsStore.setStarredFilter).toHaveBeenCalledWith(null);
    });
  });

  describe('toggleStarFilterIcon', () => {
    it('cycles null → starred', () => {
      mockSessionsStore.starredFilter = null;
      const { toggleStarFilterIcon } = useSessionFiltering();
      toggleStarFilterIcon();
      expect(mockSessionsStore.setStarredFilter).toHaveBeenCalledWith('starred');
    });

    it('cycles starred → unstarred', () => {
      mockSessionsStore.starredFilter = 'starred';
      const { toggleStarFilterIcon } = useSessionFiltering();
      toggleStarFilterIcon();
      expect(mockSessionsStore.setStarredFilter).toHaveBeenCalledWith('unstarred');
    });

    it('cycles unstarred → null', () => {
      mockSessionsStore.starredFilter = 'unstarred';
      const { toggleStarFilterIcon } = useSessionFiltering();
      toggleStarFilterIcon();
      expect(mockSessionsStore.setStarredFilter).toHaveBeenCalledWith(null);
    });
  });

  describe('starFilterTooltip', () => {
    it('returns correct tooltip when no filter active', () => {
      mockSessionsStore.starredFilter = null;
      const { starFilterTooltip } = useSessionFiltering();
      expect(starFilterTooltip.value).toBe('Showing all sessions. Click to filter by starred.');
    });

    it('returns correct tooltip when starred filter active', () => {
      mockSessionsStore.starredFilter = 'starred';
      const { starFilterTooltip } = useSessionFiltering();
      expect(starFilterTooltip.value).toBe('Showing starred sessions only. Click to filter unstarred.');
    });

    it('returns correct tooltip when unstarred filter active', () => {
      mockSessionsStore.starredFilter = 'unstarred';
      const { starFilterTooltip } = useSessionFiltering();
      expect(starFilterTooltip.value).toBe('Showing unstarred sessions only. Click to show all.');
    });
  });

  describe('toggleScheduledFilterIcon', () => {
    it('cycles null → scheduled', () => {
      mockSessionsStore.scheduledFilter = null;
      const { toggleScheduledFilterIcon } = useSessionFiltering();
      toggleScheduledFilterIcon();
      expect(mockSessionsStore.setScheduledFilter).toHaveBeenCalledWith('scheduled');
    });

    it('cycles scheduled → not-scheduled', () => {
      mockSessionsStore.scheduledFilter = 'scheduled';
      const { toggleScheduledFilterIcon } = useSessionFiltering();
      toggleScheduledFilterIcon();
      expect(mockSessionsStore.setScheduledFilter).toHaveBeenCalledWith('not-scheduled');
    });

    it('cycles not-scheduled → null', () => {
      mockSessionsStore.scheduledFilter = 'not-scheduled';
      const { toggleScheduledFilterIcon } = useSessionFiltering();
      toggleScheduledFilterIcon();
      expect(mockSessionsStore.setScheduledFilter).toHaveBeenCalledWith(null);
    });
  });

  describe('scheduledFilterTooltip', () => {
    it('returns correct tooltip when no filter active', () => {
      mockSessionsStore.scheduledFilter = null;
      const { scheduledFilterTooltip } = useSessionFiltering();
      expect(scheduledFilterTooltip.value).toBe('Showing all workflows. Click to filter by scheduled.');
    });

    it('returns correct tooltip when scheduled filter active', () => {
      mockSessionsStore.scheduledFilter = 'scheduled';
      const { scheduledFilterTooltip } = useSessionFiltering();
      expect(scheduledFilterTooltip.value).toBe('Showing workflows with scheduled sessions. Click to filter non-scheduled.');
    });

    it('returns correct tooltip when not-scheduled filter active', () => {
      mockSessionsStore.scheduledFilter = 'not-scheduled';
      const { scheduledFilterTooltip } = useSessionFiltering();
      expect(scheduledFilterTooltip.value).toBe('Showing workflows without scheduled sessions. Click to show all.');
    });
  });


});
