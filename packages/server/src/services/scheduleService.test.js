import { describe, it, expect, beforeEach, vi } from 'vitest';
import { configureSchedule, ScheduleError } from './scheduleService.js';
import { sessions } from '../database.js';

// Mock database
vi.mock('../database.js', () => ({
  sessions: {
    update: vi.fn(),
  },
}));

// Mock websocket
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

describe('scheduleService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('configureSchedule', () => {
    const baseSession = {
      id: 's1',
      projectId: 'p1',
      status: 'waiting',
      pendingPrompt: 'Continue working on the feature',
    };

    const futureTimestamp = Date.now() + 60_000; // 1 minute from now

    it('schedules a session with valid data', () => {
      const updatedSession = { ...baseSession, status: 'scheduled', scheduledAt: futureTimestamp };
      sessions.update.mockReturnValue(updatedSession);

      const result = configureSchedule(baseSession, { scheduledAt: futureTimestamp });

      expect(sessions.update).toHaveBeenCalledWith('s1', expect.objectContaining({
        status: 'scheduled',
        scheduledAt: futureTimestamp,
      }));
      expect(result).toEqual(updatedSession);
    });

    it('throws ScheduleError when session is not in an allowed status', () => {
      const runningSession = { ...baseSession, status: 'running' };

      expect(() => configureSchedule(runningSession, { scheduledAt: futureTimestamp }))
        .toThrow(ScheduleError);

      try {
        configureSchedule(runningSession, { scheduledAt: futureTimestamp });
      } catch (error) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toBe('Session must be in waiting, stopped, or error state to schedule');
      }
    });

    it('allows scheduling from waiting status', () => {
      sessions.update.mockReturnValue({ ...baseSession, status: 'scheduled' });

      expect(() => configureSchedule(
        { ...baseSession, status: 'waiting' },
        { scheduledAt: futureTimestamp }
      )).not.toThrow();
    });

    it('allows scheduling from stopped status', () => {
      sessions.update.mockReturnValue({ ...baseSession, status: 'scheduled' });

      expect(() => configureSchedule(
        { ...baseSession, status: 'stopped' },
        { scheduledAt: futureTimestamp }
      )).not.toThrow();
    });

    it('allows scheduling from error status', () => {
      sessions.update.mockReturnValue({ ...baseSession, status: 'scheduled' });

      expect(() => configureSchedule(
        { ...baseSession, status: 'error' },
        { scheduledAt: futureTimestamp }
      )).not.toThrow();
    });

    it('throws ScheduleError when scheduledAt is missing', () => {
      expect(() => configureSchedule(baseSession, {}))
        .toThrow(ScheduleError);

      try {
        configureSchedule(baseSession, {});
      } catch (error) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toBe('scheduledAt must be a future timestamp');
      }
    });

    it('throws ScheduleError when scheduledAt is in the past', () => {
      const pastTimestamp = Date.now() - 60_000;

      expect(() => configureSchedule(baseSession, { scheduledAt: pastTimestamp }))
        .toThrow(ScheduleError);

      try {
        configureSchedule(baseSession, { scheduledAt: pastTimestamp });
      } catch (error) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toBe('scheduledAt must be a future timestamp');
      }
    });

    it('throws ScheduleError when pendingPrompt is empty', () => {
      const sessionWithoutPrompt = { ...baseSession, pendingPrompt: '' };

      expect(() => configureSchedule(sessionWithoutPrompt, { scheduledAt: futureTimestamp }))
        .toThrow(ScheduleError);

      try {
        configureSchedule(sessionWithoutPrompt, { scheduledAt: futureTimestamp });
      } catch (error) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toBe('pendingPrompt must be set before scheduling');
      }
    });

    it('throws ScheduleError when pendingPrompt is null', () => {
      const sessionWithoutPrompt = { ...baseSession, pendingPrompt: null };

      expect(() => configureSchedule(sessionWithoutPrompt, { scheduledAt: futureTimestamp }))
        .toThrow(ScheduleError);
    });

    it('applies autoRescheduleEnabled option', () => {
      sessions.update.mockReturnValue({ ...baseSession, status: 'scheduled' });

      configureSchedule(baseSession, {
        scheduledAt: futureTimestamp,
        autoRescheduleEnabled: true,
      });

      expect(sessions.update).toHaveBeenCalledWith('s1', expect.objectContaining({
        autoRescheduleEnabled: true,
      }));
    });

    it('applies rescheduleDelayMinutes option', () => {
      sessions.update.mockReturnValue({ ...baseSession, status: 'scheduled' });

      configureSchedule(baseSession, {
        scheduledAt: futureTimestamp,
        rescheduleDelayMinutes: 30,
      });

      expect(sessions.update).toHaveBeenCalledWith('s1', expect.objectContaining({
        rescheduleDelayMinutes: 30,
      }));
    });

    it('applies rescheduleOnTokenLimit option', () => {
      sessions.update.mockReturnValue({ ...baseSession, status: 'scheduled' });

      configureSchedule(baseSession, {
        scheduledAt: futureTimestamp,
        rescheduleOnTokenLimit: true,
      });

      expect(sessions.update).toHaveBeenCalledWith('s1', expect.objectContaining({
        rescheduleOnTokenLimit: true,
      }));
    });

    it('applies rescheduleOnServiceError option', () => {
      sessions.update.mockReturnValue({ ...baseSession, status: 'scheduled' });

      configureSchedule(baseSession, {
        scheduledAt: futureTimestamp,
        rescheduleOnServiceError: true,
      });

      expect(sessions.update).toHaveBeenCalledWith('s1', expect.objectContaining({
        rescheduleOnServiceError: true,
      }));
    });

    it('applies maxRescheduleCount option as integer', () => {
      sessions.update.mockReturnValue({ ...baseSession, status: 'scheduled' });

      configureSchedule(baseSession, {
        scheduledAt: futureTimestamp,
        maxRescheduleCount: 5,
      });

      expect(sessions.update).toHaveBeenCalledWith('s1', expect.objectContaining({
        maxRescheduleCount: 5,
      }));
    });

    it('sets maxRescheduleCount to null when falsy', () => {
      sessions.update.mockReturnValue({ ...baseSession, status: 'scheduled' });

      configureSchedule(baseSession, {
        scheduledAt: futureTimestamp,
        maxRescheduleCount: 0,
      });

      expect(sessions.update).toHaveBeenCalledWith('s1', expect.objectContaining({
        maxRescheduleCount: null,
      }));
    });

    it('applies maxTotalTokens option', () => {
      sessions.update.mockReturnValue({ ...baseSession, status: 'scheduled' });

      configureSchedule(baseSession, {
        scheduledAt: futureTimestamp,
        maxTotalTokens: 100000,
      });

      expect(sessions.update).toHaveBeenCalledWith('s1', expect.objectContaining({
        maxTotalTokens: 100000,
      }));
    });

    it('applies rescheduleAtTokenCount option', () => {
      sessions.update.mockReturnValue({ ...baseSession, status: 'scheduled' });

      configureSchedule(baseSession, {
        scheduledAt: futureTimestamp,
        rescheduleAtTokenCount: 50000,
      });

      expect(sessions.update).toHaveBeenCalledWith('s1', expect.objectContaining({
        rescheduleAtTokenCount: 50000,
      }));
    });

    it('applies pendingModel option', () => {
      sessions.update.mockReturnValue({ ...baseSession, status: 'scheduled' });

      configureSchedule(baseSession, {
        scheduledAt: futureTimestamp,
        pendingModel: 'claude-3-opus',
      });

      expect(sessions.update).toHaveBeenCalledWith('s1', expect.objectContaining({
        pendingModel: 'claude-3-opus',
      }));
    });

    it('broadcasts status and session updates', async () => {
      sessions.update.mockReturnValue({ ...baseSession, status: 'scheduled' });
      const { broadcastToSession, broadcastToProject } = await import('../websocket.js');

      configureSchedule(baseSession, { scheduledAt: futureTimestamp });

      expect(broadcastToSession).toHaveBeenCalledWith('s1', expect.any(String), expect.objectContaining({
        sessionId: 's1',
        status: 'scheduled',
      }));

      expect(broadcastToProject).toHaveBeenCalledWith('p1', expect.any(String), expect.objectContaining({
        projectId: 'p1',
        sessionId: 's1',
      }));
    });
  });

  describe('ScheduleError', () => {
    it('has correct name', () => {
      const error = new ScheduleError('test', 400);
      expect(error.name).toBe('ScheduleError');
    });

    it('carries statusCode', () => {
      const error = new ScheduleError('bad request', 400);
      expect(error.statusCode).toBe(400);
      expect(error.message).toBe('bad request');
    });

    it('is an instance of Error', () => {
      const error = new ScheduleError('test', 400);
      expect(error).toBeInstanceOf(Error);
    });
  });
});
