/**
 * Route parameter names used throughout the application
 * This file serves as a single source of truth for route parameter names
 * to prevent mismatches between route definitions and component implementations
 */

export const ROUTE_PARAMS = {
  // Projects - NOTE: Inconsistent naming - some routes use :id, others use :projectId
  // TODO: Standardize to use :projectId consistently
  PROJECT_ID: 'projectId', // Used in command-buttons routes
  PROJECT_ID_ALT: 'id', // Used in sessions, edit routes - needs migration

  // Command Buttons
  BUTTON_ID: 'buttonId',

  // Sessions
  SESSION_ID: 'id', // Used in /sessions/:id/:tab?
  SESSION_TAB: 'tab',
};

/**
 * Validates that a route has expected parameters
 * Useful for testing route configurations
 */
export function validateRouteParams(route, expectedParams) {
  const actual = Object.keys(route.params || {});
  const missing = expectedParams.filter((p) => !actual.includes(p));

  if (missing.length > 0) {
    throw new Error(
      `Route ${route.path} is missing expected params: ${missing.join(', ')}. Got: ${actual.join(', ')}`
    );
  }

  return true;
}
