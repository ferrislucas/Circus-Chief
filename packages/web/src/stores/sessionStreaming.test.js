import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSessionStreamingStore } from './sessionStreaming.js';

describe('SessionStreaming Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('has empty defaults', () => {
      const store = useSessionStreamingStore();
      expect(store.partialText).toBe('');
      expect(store.partialThinkingBySession).toEqual({});
    });
  });

  describe('setPartialText', () => {
    it('updates partialText immediately on first call', () => {
      const store = useSessionStreamingStore();
      store.setPartialText('hello');
      expect(store.partialText).toBe('hello');
    });

    it('throttles subsequent updates within 150ms window', () => {
      const store = useSessionStreamingStore();
      store.setPartialText('first');
      expect(store.partialText).toBe('first');

      store.setPartialText('second');
      // Should still be 'first' because of throttle
      expect(store.partialText).toBe('first');

      // After throttle timer fires, should update to latest
      vi.advanceTimersByTime(150);
      expect(store.partialText).toBe('second');
    });

    it('applies latest pending text after throttle period', () => {
      const store = useSessionStreamingStore();
      store.setPartialText('a');
      store.setPartialText('b');
      store.setPartialText('c');

      // Only 'a' should have been applied immediately
      expect(store.partialText).toBe('a');

      vi.advanceTimersByTime(150);
      // Should apply 'c' (latest pending)
      expect(store.partialText).toBe('c');
    });
  });

  describe('clearPartialText', () => {
    it('resets partialText and cancels throttle timer', () => {
      const store = useSessionStreamingStore();
      store.setPartialText('something');
      store.clearPartialText();
      expect(store.partialText).toBe('');
    });

    it('clears pending partial text', () => {
      const store = useSessionStreamingStore();
      store.setPartialText('first');
      store.setPartialText('pending');
      store.clearPartialText();
      vi.advanceTimersByTime(200);
      expect(store.partialText).toBe('');
    });
  });

  describe('partialThinking per session', () => {
    it('setPartialThinking stores thinking for a session', () => {
      const store = useSessionStreamingStore();
      store.setPartialThinking('thinking...', 'session-1');
      expect(store.getPartialThinking('session-1')).toBe('thinking...');
    });

    it('getPartialThinking returns null for unknown session', () => {
      const store = useSessionStreamingStore();
      expect(store.getPartialThinking('unknown')).toBeNull();
    });

    it('getPartialThinking returns null for null sessionId', () => {
      const store = useSessionStreamingStore();
      expect(store.getPartialThinking(null)).toBeNull();
    });

    it('clearPartialThinking sets session thinking to null', () => {
      const store = useSessionStreamingStore();
      store.setPartialThinking('thinking...', 'session-1');
      store.clearPartialThinking('session-1');
      expect(store.getPartialThinking('session-1')).toBeNull();
    });

    it('clearAllPartialThinking resets all sessions', () => {
      const store = useSessionStreamingStore();
      store.setPartialThinking('think1', 'session-1');
      store.setPartialThinking('think2', 'session-2');
      store.clearAllPartialThinking();
      expect(store.partialThinkingBySession).toEqual({});
    });

    it('does not set thinking without sessionId', () => {
      const store = useSessionStreamingStore();
      store.setPartialThinking('thinking...');
      expect(store.partialThinkingBySession).toEqual({});
    });

    it('ignores null updates — keeps the previous thinking value', () => {
      const store = useSessionStreamingStore();
      store.setPartialThinking('Previous thinking', 'session-1');
      store.setPartialThinking(null, 'session-1');
      expect(store.getPartialThinking('session-1')).toBe('Previous thinking');
    });

    it('ignores empty string updates — keeps the previous thinking value', () => {
      const store = useSessionStreamingStore();
      store.setPartialThinking('Previous thinking', 'session-1');
      store.setPartialThinking('', 'session-1');
      expect(store.getPartialThinking('session-1')).toBe('Previous thinking');
    });

    it('updates thinking normally for non-null non-empty strings', () => {
      const store = useSessionStreamingStore();
      store.setPartialThinking('First thought', 'session-1');
      store.setPartialThinking('Second thought', 'session-1');
      expect(store.getPartialThinking('session-1')).toBe('Second thought');
    });
  });

  describe('addSessionWorkLog', () => {
    it('adds a log entry to the correct sessionId', () => {
      const store = useSessionStreamingStore();
      const log = { id: '1', type: 'tool_use', tool: 'Read', summary: 'Reading file' };
      store.addSessionWorkLog('session-1', log);

      expect(store.getSessionWorkLogs('session-1')).toHaveLength(1);
      expect(store.getSessionWorkLogs('session-1')[0]).toEqual(log);
    });

    it('caps at 15 entries', () => {
      const store = useSessionStreamingStore();
      for (let i = 0; i < 20; i++) {
        store.addSessionWorkLog('session-1', { id: String(i), type: 'tool_use', tool: `Tool${i}` });
      }

      const logs = store.getSessionWorkLogs('session-1');
      expect(logs).toHaveLength(15);
      // Should keep the last 15 (indices 5-19)
      expect(logs[0].id).toBe('5');
      expect(logs[14].id).toBe('19');
    });

    it('creates array for new sessionId', () => {
      const store = useSessionStreamingStore();
      expect(store.getSessionWorkLogs('new-session')).toEqual([]);

      store.addSessionWorkLog('new-session', { id: '1', type: 'tool_use' });
      expect(store.getSessionWorkLogs('new-session')).toHaveLength(1);
    });

    it('does not affect other sessions', () => {
      const store = useSessionStreamingStore();
      store.addSessionWorkLog('session-1', { id: '1', type: 'tool_use' });
      store.addSessionWorkLog('session-2', { id: '2', type: 'tool_use' });

      expect(store.getSessionWorkLogs('session-1')).toHaveLength(1);
      expect(store.getSessionWorkLogs('session-2')).toHaveLength(1);
    });
  });

  describe('setSessionPartialText', () => {
    it('sets text for a sessionId', () => {
      const store = useSessionStreamingStore();
      store.setSessionPartialText('session-1', 'Hello world');
      expect(store.getSessionPartialText('session-1')).toBe('Hello world');
    });

    it('overwrites previous text for same sessionId', () => {
      const store = useSessionStreamingStore();
      store.setSessionPartialText('session-1', 'First');
      store.setSessionPartialText('session-1', 'Second');
      expect(store.getSessionPartialText('session-1')).toBe('Second');
    });

    it('does not affect other sessions', () => {
      const store = useSessionStreamingStore();
      store.setSessionPartialText('session-1', 'Text 1');
      store.setSessionPartialText('session-2', 'Text 2');
      expect(store.getSessionPartialText('session-1')).toBe('Text 1');
      expect(store.getSessionPartialText('session-2')).toBe('Text 2');
    });

    it('ignores empty string updates — keeps the previous value', () => {
      const store = useSessionStreamingStore();
      store.setSessionPartialText('session-1', 'Visible text');
      store.setSessionPartialText('session-1', '');
      expect(store.getSessionPartialText('session-1')).toBe('Visible text');
    });

    it('sets text normally for non-empty strings', () => {
      const store = useSessionStreamingStore();
      store.setSessionPartialText('session-1', 'Initial');
      store.setSessionPartialText('session-1', 'Updated text');
      expect(store.getSessionPartialText('session-1')).toBe('Updated text');
    });
  });

  describe('clearSessionStreamingState', () => {
    it('clears workLogs, partialText, and partialThinking for a session', () => {
      const store = useSessionStreamingStore();
      store.addSessionWorkLog('session-1', { id: '1', type: 'tool_use' });
      store.setSessionPartialText('session-1', 'Partial text');
      store.setPartialThinking('Thinking...', 'session-1');

      store.clearSessionStreamingState('session-1');

      expect(store.getSessionWorkLogs('session-1')).toEqual([]);
      expect(store.getSessionPartialText('session-1')).toBe('');
      expect(store.getPartialThinking('session-1')).toBeNull();
    });

    it('clears file count for the session', () => {
      const store = useSessionStreamingStore();
      store.setSessionFileCount('session-1', 7);
      expect(store.getSessionFileCount('session-1')).toBe(7);

      store.clearSessionStreamingState('session-1');

      expect(store.getSessionFileCount('session-1')).toBe(0);
    });

    it('does not affect other sessions', () => {
      const store = useSessionStreamingStore();
      store.addSessionWorkLog('session-1', { id: '1', type: 'tool_use' });
      store.addSessionWorkLog('session-2', { id: '2', type: 'tool_use' });
      store.setSessionPartialText('session-1', 'Text 1');
      store.setSessionPartialText('session-2', 'Text 2');
      store.setSessionFileCount('session-1', 3);
      store.setSessionFileCount('session-2', 5);

      store.clearSessionStreamingState('session-1');

      expect(store.getSessionWorkLogs('session-1')).toEqual([]);
      expect(store.getSessionWorkLogs('session-2')).toHaveLength(1);
      expect(store.getSessionPartialText('session-1')).toBe('');
      expect(store.getSessionPartialText('session-2')).toBe('Text 2');
      expect(store.getSessionFileCount('session-1')).toBe(0);
      expect(store.getSessionFileCount('session-2')).toBe(5);
    });
  });

  describe('setSessionFileCount', () => {
    it('stores count per session', () => {
      const store = useSessionStreamingStore();
      store.setSessionFileCount('session-1', 4);
      expect(store.getSessionFileCount('session-1')).toBe(4);
    });

    it('overwrites previous count for same sessionId', () => {
      const store = useSessionStreamingStore();
      store.setSessionFileCount('session-1', 2);
      store.setSessionFileCount('session-1', 9);
      expect(store.getSessionFileCount('session-1')).toBe(9);
    });

    it('does not affect other sessions', () => {
      const store = useSessionStreamingStore();
      store.setSessionFileCount('session-1', 3);
      store.setSessionFileCount('session-2', 6);
      expect(store.getSessionFileCount('session-1')).toBe(3);
      expect(store.getSessionFileCount('session-2')).toBe(6);
    });
  });

  describe('getSessionFileCount', () => {
    it('returns 0 for unknown session', () => {
      const store = useSessionStreamingStore();
      expect(store.getSessionFileCount('nonexistent')).toBe(0);
    });

    it('returns the stored count for a known session', () => {
      const store = useSessionStreamingStore();
      store.setSessionFileCount('session-1', 12);
      expect(store.getSessionFileCount('session-1')).toBe(12);
    });
  });

  describe('toggleSessionLogCollapsed', () => {
    it('adds sessionId to collapsed set', () => {
      const store = useSessionStreamingStore();
      expect(store.isSessionLogCollapsed('session-1')).toBe(false);
      store.toggleSessionLogCollapsed('session-1');
      expect(store.isSessionLogCollapsed('session-1')).toBe(true);
    });

    it('removes sessionId from collapsed set if already present', () => {
      const store = useSessionStreamingStore();
      store.toggleSessionLogCollapsed('session-1');
      expect(store.isSessionLogCollapsed('session-1')).toBe(true);

      store.toggleSessionLogCollapsed('session-1');
      expect(store.isSessionLogCollapsed('session-1')).toBe(false);
    });
  });

  describe('saveCollapsedLogState', () => {
    it('persists to localStorage', () => {
      const store = useSessionStreamingStore();
      store.toggleSessionLogCollapsed('session-1');
      store.toggleSessionLogCollapsed('session-2');

      const saved = JSON.parse(localStorage.getItem('collapsedSessionLogs'));
      expect(saved).toContain('session-1');
      expect(saved).toContain('session-2');
    });
  });

  describe('restoreCollapsedLogState', () => {
    it('restores from localStorage', () => {
      const store = useSessionStreamingStore();
      localStorage.setItem('collapsedSessionLogs', JSON.stringify(['session-1', 'session-2']));

      store.restoreCollapsedLogState();

      expect(store.isSessionLogCollapsed('session-1')).toBe(true);
      expect(store.isSessionLogCollapsed('session-2')).toBe(true);
      expect(store.isSessionLogCollapsed('session-3')).toBe(false);
    });

    it('handles missing localStorage gracefully', () => {
      const store = useSessionStreamingStore();
      store.restoreCollapsedLogState();
      expect(store.isSessionLogCollapsed('session-1')).toBe(false);
    });

    it('handles corrupt localStorage gracefully', () => {
      const store = useSessionStreamingStore();
      localStorage.setItem('collapsedSessionLogs', 'not-valid-json{{{');
      store.restoreCollapsedLogState();
      expect(store.isSessionLogCollapsed('session-1')).toBe(false);
    });
  });

  describe('getSessionWorkLogs getter', () => {
    it('returns empty array for unknown session', () => {
      const store = useSessionStreamingStore();
      expect(store.getSessionWorkLogs('nonexistent')).toEqual([]);
    });
  });

  describe('getSessionPartialText getter', () => {
    it('returns empty string for unknown session', () => {
      const store = useSessionStreamingStore();
      expect(store.getSessionPartialText('nonexistent')).toBe('');
    });
  });

  describe('isSessionLogCollapsed getter', () => {
    it('returns false for uncollapsed session', () => {
      const store = useSessionStreamingStore();
      expect(store.isSessionLogCollapsed('session-1')).toBe(false);
    });
  });
});
