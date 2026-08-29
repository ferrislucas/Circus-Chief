<template>
  <div class="container">
    <div class="page-header">
      <h1>Projects</h1>
      <router-link to="/projects/new" class="btn btn-primary">
        <span class="add-repo-label-full">Add Project</span>
        <span class="add-repo-label-short">+ Add</span>
      </router-link>
    </div>

    <ProjectFiltersPanel
      v-if="!projectsStore.loading && !projectsStore.error && projectsStore.projects.length > 0"
      :status-facets="statusFacets"
      class="project-filters"
    />

    <div v-if="projectsStore.loading" class="skeleton-list">
      <div v-for="i in 3" :key="i" class="skeleton card" style="height: 80px" />
    </div>

    <div v-else-if="projectsStore.error" class="error-message">
      {{ projectsStore.error }}
    </div>

    <div v-else-if="projectsStore.projects.length === 0" class="empty-state">
      <div class="welcome-hero card">
        <h2 class="welcome-heading">Welcome to Circus Chief</h2>
        <p class="welcome-subtitle">
          Your command center for coding agent sessions. Point it at a codebase and start building.
        </p>
      </div>

      <div class="steps-grid">
        <div class="step-card card">
          <div class="step-number">1</div>
          <h3 class="step-title">Pick a project folder</h3>
          <p class="step-desc">Point to any codebase on your machine</p>
        </div>
        <div class="step-card card">
          <div class="step-number">2</div>
          <h3 class="step-title">Create coding sessions</h3>
          <p class="step-desc">Start tasks with your AI coding agent</p>
        </div>
        <div class="step-card card">
          <div class="step-number">3</div>
          <h3 class="step-title">Track changes &amp; artifacts</h3>
          <p class="step-desc">View diffs, canvas, and conversation history</p>
        </div>
      </div>

      <router-link to="/projects/new" class="btn btn-primary cta-button">
        Add Your First Project
      </router-link>
    </div>

    <div v-else-if="visibleProjects.length === 0" class="empty-state">
      <div class="no-match card">
        <p class="no-match-text">No projects match this filter.</p>
      </div>
    </div>

    <div v-else class="project-list">
      <section v-for="project in visibleProjects" :key="project.id" class="project-group">
        <div class="project-card card">
          <div class="project-card-header" @click="goToSessions(project.id)">
            <div class="project-info">
              <h3 class="project-name">
                {{ project.name }}
              </h3>
              <p class="project-path">
                {{ project.workingDirectory }}
              </p>
              <p v-if="project.sessionCount > 0 || project.lastActivityAt" class="project-meta">
                <span v-if="project.sessionCount > 0"
                  >{{ project.sessionCount }} session{{ project.sessionCount !== 1 ? 's' : '' }}</span
                >
                <template v-if="project.sessionCount > 0 && project.lastActivityAt">
                  <span class="meta-separator">·</span>
                </template>
                <span v-if="project.lastActivityAt">{{
                  formatRelativeTime(project.lastActivityAt)
                }}</span>
              </p>
              <div class="project-session-summary" aria-label="Session status summary">
                <span class="session-status-count status-running">
                  <span class="status-dot" aria-hidden="true" />
                  {{ project.runningSessionCount }} running
                </span>
                <span class="session-status-count status-waiting">
                  <span class="status-dot" aria-hidden="true" />
                  {{ project.waitingSessionCount }} waiting
                </span>
                <span class="session-status-count status-idle">
                  <span class="status-dot" aria-hidden="true" />
                  {{ idleSessionCount(project) }} idle
                </span>
              </div>
            </div>
            <div class="project-actions">
              <button
                v-if="projectCards[project.id]?.length"
                type="button"
                class="sessions-toggle"
                :aria-controls="`project-sessions-${project.id}`"
                :aria-expanded="areSessionsVisible(project.id)"
                @click.stop="toggleSessions(project.id)"
              >
                <span>{{ areSessionsVisible(project.id) ? 'Hide sessions' : 'Show sessions' }}</span>
                <span class="sessions-toggle-icon" :class="{ expanded: areSessionsVisible(project.id) }" aria-hidden="true">⌄</span>
              </button>
              <router-link :to="`/projects/${project.id}/edit`" class="btn edit-btn" @click.stop>
                Edit
              </router-link>
            </div>
          </div>
          <div
            v-if="projectCards[project.id]?.length && areSessionsVisible(project.id)"
            :id="`project-sessions-${project.id}`"
            class="embedded-session-list"
          >
            <SessionCard
              v-for="workspace in projectCards[project.id]"
              :key="workspace.id"
              :session="workspace"
              :show-summary="true"
              :summary="workspace.summaryPreview ? { shortSummary: workspace.summaryPreview } : null"
              :workflow-aggregate="workspace"
              :pr-url="workspace.prUrl"
              :pr-summary="workspacePrSummary(workspace)"
              :can-add-to-board="false"
              @star="handleStar"
            />
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useProjectsStore } from '../stores/projects.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useProjectFiltersStore } from '../stores/projectFilters.js';
import { useProjectListRealtime } from '../composables/useProjectListRealtime.js';
import ProjectFiltersPanel from '../components/ProjectFiltersPanel.vue';
import SessionCard from '../components/SessionCard.vue';
import { formatRelativeTime } from '../composables/useSummaryHelpers.js';
import { api } from '../api/index.js';
import { workspacePrSummary } from '../utils/workspaceCard.js';

const router = useRouter();
const projectsStore = useProjectsStore();
const sessionsStore = useSessionsStore();
const projectFilters = useProjectFiltersStore();
const projectCards = ref({});
const sessionVisibility = ref({});
let projectCardsRequest = 0;
const sessionVisibilityStorageKey = 'circus-chief.project-list.session-visibility';

// The list and facets are client-side derivatives of the full project array.
const visibleProjects = computed(() => projectsStore.filteredProjects);
const statusFacets = computed(() => projectsStore.statusFacets);
const projectIds = computed(() => projectsStore.projects.map((p) => p.id));

function goToSessions(projectId) {
  router.push(`/projects/${projectId}/sessions`);
}

function areSessionsVisible(projectId) {
  return sessionVisibility.value[projectId] === true;
}

function idleSessionCount(project) {
  return Math.max(0, project.sessionCount - project.runningSessionCount);
}

function toggleSessions(projectId) {
  sessionVisibility.value = {
    ...sessionVisibility.value,
    [projectId]: !areSessionsVisible(projectId),
  };
  try {
    localStorage.setItem(sessionVisibilityStorageKey, JSON.stringify(sessionVisibility.value));
  } catch {
    // Session previews remain usable when browser storage is unavailable.
  }
}

function restoreSessionVisibility() {
  try {
    const savedVisibility = JSON.parse(localStorage.getItem(sessionVisibilityStorageKey) || '{}');
    if (savedVisibility && typeof savedVisibility === 'object' && !Array.isArray(savedVisibility)) {
      sessionVisibility.value = savedVisibility;
    }
  } catch {
    // Ignore malformed or unavailable browser storage.
  }
}

const hasStatusFilter = computed(() => Boolean(projectFilters.statusFilter));

function cardStatusFilter() {
  // An idle project has neither running nor waiting sessions, so all of its
  // cards match. The general card-list idle filter intentionally includes
  // waiting workspaces, which differs from the project-list definition.
  return ['running', 'waiting'].includes(projectFilters.statusFilter)
    ? projectFilters.statusFilter
    : null;
}

async function loadProjectCards() {
  const request = ++projectCardsRequest;
  const cards = await Promise.all(
    visibleProjects.value.map(async (project) => {
      const options = { status: cardStatusFilter(), limit: hasStatusFilter.value ? 500 : 3 };
      let response = await api.getWorkspaceCards(project.id, options);
      const workspaces = [...(response.workspaces || [])];

      // A selected filter promises every match, rather than a page-sized
      // preview. Cursor paging preserves the activity ordering from the API.
      while (
        hasStatusFilter.value &&
        response.pagination?.hasMore &&
        response.pagination.nextCursor
      ) {
        response = await api.getWorkspaceCards(project.id, {
          ...options,
          cursor: response.pagination.nextCursor,
        });
        workspaces.push(...(response.workspaces || []));
      }
      return [project.id, workspaces];
    })
  );
  if (request === projectCardsRequest) {
    projectCards.value = Object.fromEntries(cards);
  }
}

async function handleStar({ id, starred }) {
  const card = Object.values(projectCards.value)
    .flat()
    .find((item) => item.id === id);
  if (!card) return;
  card.starred = starred;
  try {
    await sessionsStore.toggleSessionStar(id);
  } catch {
    card.starred = !starred;
  }
}

watch(
  [visibleProjects, hasStatusFilter],
  () => {
    loadProjectCards().catch(() => {});
  },
  { immediate: true }
);

onMounted(() => {
  projectFilters.restoreStatusFilter();
  restoreSessionVisibility();
  projectsStore.fetchProjects();
  useProjectListRealtime(projectIds);
});
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.page-header h1 {
  margin: 0;
}

.add-repo-label-short {
  display: none;
}

.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.error-message {
  color: var(--color-error);
  padding: 1rem;
  background-color: rgba(248, 81, 73, 0.1);
  border-radius: var(--border-radius);
}

/* Empty state / Welcome hero */
.empty-state {
  text-align: center;
  padding: 3rem 1rem;
}

.welcome-hero {
  padding: 2rem;
  margin-bottom: 2rem;
}

.welcome-heading {
  margin: 0 0 0.75rem;
  font-size: 1.5rem;
}

.welcome-subtitle {
  margin: 0;
  color: var(--color-text-soft);
  font-size: 1rem;
  line-height: 1.5;
}

.steps-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-bottom: 2rem;
}

.step-card {
  padding: 1.5rem;
  text-align: center;
}

.step-number {
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  background-color: var(--color-primary);
  color: var(--color-background);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 0.875rem;
  margin-bottom: 0.75rem;
}

.step-title {
  margin: 0 0 0.5rem;
  font-size: 0.9375rem;
}

.step-desc {
  margin: 0;
  color: var(--color-text-soft);
  font-size: 0.875rem;
  line-height: 1.4;
}

.cta-button {
  display: inline-block;
}

/* Populated state */
.project-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.project-group {
  min-width: 0;
}

.project-card {
  padding: 0;
  overflow: hidden;
}

.project-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.project-card-header:hover {
  background-color: var(--color-background-soft);
}

.project-info {
  min-width: 0;
  flex: 1;
}

.project-name {
  margin: 0 0 0.25rem;
  font-size: 1rem;
}

.project-path {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text-soft);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-meta {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  color: var(--color-text-soft);
}

.meta-separator {
  margin: 0 0.375rem;
}

.embedded-session-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.875rem 1rem 1rem;
  border-top: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-background-soft) 58%, transparent);
}

.no-match {
  padding: 2rem;
}

.no-match-text {
  margin: 0;
  color: var(--color-text-soft);
}

.project-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
  margin-left: 1rem;
}

.sessions-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.35rem 0.45rem;
  border: 0;
  border-radius: calc(var(--border-radius) * 0.75);
  color: var(--color-text-soft);
  background: transparent;
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
}

.sessions-toggle:hover {
  color: var(--color-text);
  background-color: var(--color-background-soft);
}

.sessions-toggle:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.sessions-toggle-icon {
  display: inline-block;
  font-size: 1rem;
  line-height: 1;
  transform: rotate(-90deg);
  transition: transform 0.15s ease;
}

.sessions-toggle-icon.expanded {
  transform: rotate(0deg);
}

.project-session-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem 0.75rem;
  margin-top: 0.625rem;
}

.session-status-count {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--color-text-soft);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.status-dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: currentColor;
}

.status-running {
  color: var(--color-success);
}

.status-waiting {
  color: var(--color-warning);
}

/* Mobile breakpoints */
@media (max-width: 640px) {
  .empty-state {
    padding: 2rem 0.5rem;
  }
}

@media (max-width: 480px) {
  .add-repo-label-full {
    display: none;
  }
  .add-repo-label-short {
    display: inline;
  }

  /* Welcome hero mobile */
  .welcome-hero {
    padding: 1rem;
  }
  .welcome-heading {
    font-size: 1.25rem;
  }

  /* Steps grid: stack vertically, merge into single card */
  .steps-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }
  .step-card {
    border-radius: 0;
    border-bottom: 1px solid var(--color-border);
    text-align: left;
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
  }
  .step-card:first-child {
    border-radius: var(--border-radius) var(--border-radius) 0 0;
  }
  .step-card:last-child {
    border-radius: 0 0 var(--border-radius) var(--border-radius);
    border-bottom: none;
  }
  .step-number {
    margin-bottom: 0;
    flex-shrink: 0;
  }
  .step-title,
  .step-desc {
    text-align: left;
  }

  .cta-button {
    width: 100%;
    text-align: center;
  }

  /* Project cards mobile */
  .project-card-header {
    padding: 0.75rem;
  }
  .embedded-session-list {
    padding: 0.75rem;
  }
  .sessions-toggle span:first-child {
    display: none;
  }
  .sessions-toggle {
    padding: 0.35rem;
  }
}
</style>
