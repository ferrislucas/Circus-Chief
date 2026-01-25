import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  {
    path: '/',
    name: 'ProjectList',
    component: () => import('./views/ProjectListView.vue'),
  },
  {
    path: '/projects/new',
    name: 'ProjectNew',
    component: () => import('./views/ProjectNewView.vue'),
  },
  {
    path: '/projects/:id/edit',
    name: 'ProjectEdit',
    component: () => import('./views/ProjectEditView.vue'),
  },
  {
    path: '/projects/:projectId/command-buttons/new',
    name: 'CommandButtonNew',
    component: () => import('./views/CommandButtonDetailView.vue'),
  },
  {
    path: '/projects/:projectId/command-buttons/:buttonId',
    name: 'CommandButtonEdit',
    component: () => import('./views/CommandButtonDetailView.vue'),
  },
  {
    path: '/projects/:id/sessions',
    name: 'SessionList',
    component: () => import('./views/SessionListView.vue'),
  },
  {
    path: '/projects/:id/archived',
    name: 'ArchivedSessions',
    component: () => import('./views/SessionListView.vue'),
  },
  {
    path: '/projects/:id/templates',
    name: 'ProjectTemplates',
    component: () => import('./views/SessionListView.vue'),
  },
  {
    path: '/projects/:id/commands',
    name: 'ProjectCommands',
    component: () => import('./views/SessionListView.vue'),
  },
  {
    path: '/projects/:id/scheduled',
    name: 'ScheduledSessions',
    component: () => import('./views/SessionListView.vue'),
  },
  {
    path: '/projects/:projectId/templates/:templateId',
    name: 'TemplateDetail',
    component: () => import('./views/TemplateDetailView.vue'),
  },
  {
    path: '/projects/:id/sessions/new',
    name: 'NewSession',
    component: () => import('./views/NewSessionView.vue'),
  },
  {
    path: '/sessions/active',
    name: 'ActiveSessions',
    component: () => import('./views/ActiveSessionsView.vue'),
  },
  {
    path: '/sessions/:id/:tab?',
    name: 'SessionDetail',
    component: () => import('./views/SessionDetailView.vue'),
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
