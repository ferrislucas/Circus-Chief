import { describe, it, expect } from 'vitest';
import { ROUTE_PARAMS, validateRouteParams } from './routeParams.js';

describe('ROUTE_PARAMS', () => {
  it('exports PROJECT_ID constant', () => {
    expect(ROUTE_PARAMS.PROJECT_ID).toBe('projectId');
  });

  it('exports PROJECT_ID_ALT constant', () => {
    expect(ROUTE_PARAMS.PROJECT_ID_ALT).toBe('id');
  });

  it('exports BUTTON_ID constant', () => {
    expect(ROUTE_PARAMS.BUTTON_ID).toBe('buttonId');
  });

  it('exports SESSION_ID constant', () => {
    expect(ROUTE_PARAMS.SESSION_ID).toBe('id');
  });

  it('exports SESSION_TAB constant', () => {
    expect(ROUTE_PARAMS.SESSION_TAB).toBe('tab');
  });

  it('has all expected keys', () => {
    const expectedKeys = ['PROJECT_ID', 'PROJECT_ID_ALT', 'BUTTON_ID', 'SESSION_ID', 'SESSION_TAB'];
    expect(Object.keys(ROUTE_PARAMS).sort()).toEqual(expectedKeys.sort());
  });
});

describe('validateRouteParams', () => {
  it('returns true when all expected params are present', () => {
    const route = {
      path: '/projects/:projectId/buttons/:buttonId',
      params: { projectId: 'proj-1', buttonId: 'btn-1' },
    };

    expect(validateRouteParams(route, ['projectId', 'buttonId'])).toBe(true);
  });

  it('returns true when route has extra params beyond expected', () => {
    const route = {
      path: '/sessions/:id/:tab',
      params: { id: 'sess-1', tab: 'conversation', extra: 'value' },
    };

    expect(validateRouteParams(route, ['id', 'tab'])).toBe(true);
  });

  it('returns true for empty expected params array', () => {
    const route = {
      path: '/home',
      params: {},
    };

    expect(validateRouteParams(route, [])).toBe(true);
  });

  it('throws error when expected params are missing', () => {
    const route = {
      path: '/projects/:projectId/buttons/:buttonId',
      params: { projectId: 'proj-1' }, // missing buttonId
    };

    expect(() => validateRouteParams(route, ['projectId', 'buttonId'])).toThrow(
      'Route /projects/:projectId/buttons/:buttonId is missing expected params: buttonId. Got: projectId'
    );
  });

  it('throws error listing all missing params', () => {
    const route = {
      path: '/projects/:projectId/buttons/:buttonId',
      params: {}, // missing both
    };

    expect(() => validateRouteParams(route, ['projectId', 'buttonId'])).toThrow(
      'is missing expected params: projectId, buttonId'
    );
  });

  it('handles route with no params property', () => {
    const route = {
      path: '/home',
    };

    // Should handle undefined params gracefully
    expect(validateRouteParams(route, [])).toBe(true);
  });

  it('throws when params is undefined and expected params exist', () => {
    const route = {
      path: '/projects/:id',
    };

    expect(() => validateRouteParams(route, ['id'])).toThrow(
      'is missing expected params: id'
    );
  });

  it('handles null params property', () => {
    const route = {
      path: '/home',
      params: null,
    };

    expect(validateRouteParams(route, [])).toBe(true);
  });

  it('includes route path in error message', () => {
    const route = {
      path: '/custom/route/path',
      params: {},
    };

    expect(() => validateRouteParams(route, ['required'])).toThrow(
      'Route /custom/route/path is missing expected params'
    );
  });

  it('includes actual params in error message', () => {
    const route = {
      path: '/test',
      params: { actual1: 'a', actual2: 'b' },
    };

    expect(() => validateRouteParams(route, ['expected'])).toThrow(
      'Got: actual1, actual2'
    );
  });
});
