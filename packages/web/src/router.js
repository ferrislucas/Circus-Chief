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
    path: '/projects/:id/sessions',
    name: 'SessionList',
    component: () => import('./views/SessionListView.vue'),
  },
  {
    path: '/projects/:id/sessions/new',
    name: 'NewSession',
    component: () => import('./views/NewSessionView.vue'),
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
