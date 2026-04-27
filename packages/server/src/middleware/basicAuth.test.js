import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBasicAuthMiddleware } from './basicAuth.js';

describe('createBasicAuthMiddleware', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    mockReq = {
      headers: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    };
    mockNext = vi.fn();
    vi.clearAllMocks();
  });

  describe('when no credentials configured', () => {
    it('should pass through when credentials is null', () => {
      const middleware = createBasicAuthMiddleware(null);
      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should pass through when credentials is undefined', () => {
      const middleware = createBasicAuthMiddleware(undefined);
      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  describe('when credentials are configured', () => {
    const credentials = { username: 'admin', password: 'secret123' };

    it('should call next() for valid credentials', () => {
      const middleware = createBasicAuthMiddleware(credentials);
      const token = Buffer.from('admin:secret123').toString('base64');
      mockReq.headers.authorization = `Basic ${token}`;

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should return 401 when Authorization header is missing', () => {
      const middleware = createBasicAuthMiddleware(credentials);

      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Authentication required' });
      expect(mockRes.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'xBasic realm="Circus Chief"');
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 for wrong credentials', () => {
      const middleware = createBasicAuthMiddleware(credentials);
      const token = Buffer.from('admin:wrongpassword').toString('base64');
      mockReq.headers.authorization = `Basic ${token}`;

      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Authentication required' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 for malformed Authorization header', () => {
      const middleware = createBasicAuthMiddleware(credentials);
      mockReq.headers.authorization = 'Bearer some-token';

      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Authentication required' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 for Authorization header with no scheme', () => {
      const middleware = createBasicAuthMiddleware(credentials);
      mockReq.headers.authorization = 'just-a-string';

      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Authentication required' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should use xBasic scheme in WWW-Authenticate to suppress browser dialog', () => {
      const middleware = createBasicAuthMiddleware(credentials);

      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'xBasic realm="Circus Chief"');
    });
  });
});
