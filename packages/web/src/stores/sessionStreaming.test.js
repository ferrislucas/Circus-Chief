import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSessionStreamingStore } from './sessionStreaming.js';

describe('SessionStreaming Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
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
  });
});
