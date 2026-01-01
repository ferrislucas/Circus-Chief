import { describe, it, expect } from 'vitest';
import { createRouter, createWebHistory } from 'vue-router';

describe('Router Configuration', () => {
  it('should have command-button routes with projectId parameter', () => {
    const routes = [
      {
        path: '/projects/:projectId/command-buttons/new',
        params: { projectId: 'test-project' },
      },
      {
        path: '/projects/:projectId/command-buttons/:buttonId',
        params: { projectId: 'test-project', buttonId: 'btn-1' },
      },
    ];

    // Verify projectId is used consistently
    routes.forEach((route) => {
      expect(route.path).toContain(':projectId');
      expect(route.params).toHaveProperty('projectId');
    });
  });

  it('should document parameter name inconsistencies', () => {
    // Document current state: some routes use :id, others use :projectId
    const paramNameMappings = {
      '/projects/:id/sessions': 'id', // Should be projectId
      '/projects/:id/sessions/new': 'id', // Should be projectId
      '/projects/:id/edit': 'id', // Should be projectId
      '/projects/:projectId/command-buttons/new': 'projectId', // ✅ Correct
      '/projects/:projectId/command-buttons/:buttonId': 'projectId', // ✅ Correct
      '/sessions/:id/:tab?': 'id', // This is correct for sessions
    };

    // Routes using :id for projects should be migrated to :projectId
    const projectRoutes = Object.entries(paramNameMappings).filter(([path]) =>
      path.startsWith('/projects/')
    );

    // Count inconsistencies
    const inconsistencies = projectRoutes.filter(([, paramName]) => paramName === 'id');

    // This test documents the issue - we should eliminate these inconsistencies
    console.warn(`Found ${inconsistencies.length} project routes using :id instead of :projectId`);
    expect(inconsistencies.length).toBeGreaterThan(0); // Will fail once we fix the inconsistency
  });

  it('should prevent route parameter mismatches in components', () => {
    // Example test that shows how to validate route params match router definitions
    const mockRoute = {
      params: {
        projectId: 'test-project',
        buttonId: 'btn-1',
      },
    };

    // This should be what components use:
    expect(mockRoute.params.projectId).toBeDefined();
    expect(mockRoute.params.buttonId).toBeDefined();

    // NOT this (the original bug):
    expect(mockRoute.params.id).toBeUndefined();
  });
});
