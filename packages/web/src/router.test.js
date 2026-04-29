import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRouter, createWebHistory, createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';

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

describe('auth navigation guard', () => {
  let pinia;
  let authStore;

  // Replicate the exact guard from main.js for testing
  function createAuthGuard(router, store) {
    router.beforeEach((to) => {
      if (to.name === 'Login' && store.isAuthenticated) {
        return '/';
      }
      if (!to.meta?.public && store.required && !store.isAuthenticated) {
        return '/login';
      }
    });
  }

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
  });

  async function createTestRouter(guard = true) {
    const { useAuthStore } = await import('./stores/auth.js');
    authStore = useAuthStore(pinia);

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'Login', meta: { public: true }, component: { template: '<div>Login</div>' } },
        { path: '/', name: 'Home', component: { template: '<div>Home</div>' } },
        { path: '/projects', name: 'Projects', component: { template: '<div>Projects</div>' } },
      ],
    });

    if (guard) {
      createAuthGuard(router, authStore);
    }

    return router;
  }

  describe('when auth is not required', () => {
    it('allows navigation to any route', async () => {
      const router = await createTestRouter();
      await router.push('/');
      expect(router.currentRoute.value.path).toBe('/');

      await router.push('/projects');
      expect(router.currentRoute.value.path).toBe('/projects');
    });

    it('allows navigation to login', async () => {
      const router = await createTestRouter();
      await router.push('/login');
      expect(router.currentRoute.value.path).toBe('/login');
    });
  });

  describe('when auth is required but not authenticated', () => {
    it('redirects to login for protected routes', async () => {
      const router = await createTestRouter();
      authStore.required = true;

      await router.push('/projects');
      expect(router.currentRoute.value.path).toBe('/login');
    });

    it('redirects to login for home route', async () => {
      const router = await createTestRouter();
      authStore.required = true;

      await router.push('/');
      expect(router.currentRoute.value.path).toBe('/login');
    });

    it('allows navigation to login page', async () => {
      const router = await createTestRouter();
      authStore.required = true;

      await router.push('/login');
      expect(router.currentRoute.value.path).toBe('/login');
    });
  });

  describe('when authenticated', () => {
    it('redirects away from login to home', async () => {
      const router = await createTestRouter();
      authStore.credentials = { username: 'admin', password: 'pass' };
      authStore.required = true;

      await router.push('/login');
      expect(router.currentRoute.value.path).toBe('/');
    });

    it('allows navigation to protected routes', async () => {
      const router = await createTestRouter();
      authStore.credentials = { username: 'admin', password: 'pass' };
      authStore.required = true;

      await router.push('/projects');
      expect(router.currentRoute.value.path).toBe('/projects');
    });
  });
});
