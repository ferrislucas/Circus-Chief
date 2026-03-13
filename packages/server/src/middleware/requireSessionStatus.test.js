import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requireSessionStatus } from './sessionLookup.js';

describe('requireSessionStatus middleware', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    mockReq = {
      params: { id: 'session-123' },
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    mockNext = vi.fn();
    vi.clearAllMocks();
  });

  it('should return 500 if req.session_ is not set (middleware ordering error)', () => {
    const middleware = requireSessionStatus(['waiting']);

    middleware(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'requireSessionStatus must be used after requireSession',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should call next when session status is in the allowed list', () => {
    mockReq.session_ = { id: 'session-123', status: 'waiting' };
    const middleware = requireSessionStatus(['waiting', 'stopped', 'error']);

    middleware(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('should return 400 when session status is not in the allowed list', () => {
    mockReq.session_ = { id: 'session-123', status: 'running' };
    const middleware = requireSessionStatus(['waiting', 'stopped', 'error']);

    middleware(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Session status must be one of: waiting, stopped, error',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should use custom error message when provided', () => {
    mockReq.session_ = { id: 'session-123', status: 'running' };
    const middleware = requireSessionStatus(['waiting'], 'Session is not ready for input');

    middleware(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Session is not ready for input',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should work with a single allowed status', () => {
    mockReq.session_ = { id: 'session-123', status: 'waiting' };
    const middleware = requireSessionStatus(['waiting']);

    middleware(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should reject when status matches none of multiple allowed statuses', () => {
    mockReq.session_ = { id: 'session-123', status: 'scheduled' };
    const middleware = requireSessionStatus(['waiting', 'stopped', 'error']);

    middleware(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should accept each status in the allowed list', () => {
    const allowedStatuses = ['waiting', 'stopped', 'error'];

    for (const status of allowedStatuses) {
      vi.clearAllMocks();
      mockReq.session_ = { id: 'session-123', status };
      const middleware = requireSessionStatus(allowedStatuses);

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    }
  });
});
