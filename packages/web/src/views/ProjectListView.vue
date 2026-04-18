<template>
  <div class="container">
    <div class="page-header">
      <h1>Repositories</h1>
      <router-link
        to="/projects/new"
        class="btn btn-primary"
      >
        <span class="add-repo-label-full">Add Repository</span>
        <span class="add-repo-label-short">+ Add</span>
      </router-link>
    </div>

    <div
      v-if="projectsStore.loading"
      class="skeleton-list"
    >
      <div
        v-for="i in 3"
        :key="i"
        class="skeleton card"
        style="height: 80px"
      />
    </div>

    <div
      v-else-if="projectsStore.error"
      class="error-message"
    >
      {{ projectsStore.error }}
    </div>

    <div
      v-else-if="projectsStore.projects.length === 0"
      class="empty-state"
    >
      <div class="welcome-hero card">
        <h2 class="welcome-heading">
          Welcome to Circus Chief
        </h2>
        <p class="welcome-subtitle">
          Your command center for coding agent sessions.
          Point it at a codebase and start building.
        </p>
      </div>

      <div class="steps-grid">
        <div class="step-card card">
          <div class="step-number">
            1
          </div>
          <h3 class="step-title">
            Pick a repo folder
          </h3>
          <p class="step-desc">
            Point to any codebase on your machine
          </p>
        </div>
        <div class="step-card card">
          <div class="step-number">
            2
          </div>
          <h3 class="step-title">
            Create coding sessions
          </h3>
          <p class="step-desc">
            Start tasks with your AI coding agent
          </p>
        </div>
        <div class="step-card card">
          <div class="step-number">
            3
          </div>
          <h3 class="step-title">
            Track changes &amp; artifacts
          </h3>
          <p class="step-desc">
            View diffs, canvas, and conversation history
          </p>
        </div>
      </div>

      <router-link
        to="/projects/new"
        class="btn btn-primary cta-button"
      >
        Add Your First Repository
      </router-link>
    </div>

    <div
      v-else
      class="project-list"
    >
      <div
        v-for="project in projectsStore.projects"
        :key="project.id"
        class="project-card card"
        @click="goToSessions(project.id)"
      >
        <div class="project-info">
          <h3 class="project-name">
            {{ project.name }}
          </h3>
          <p class="project-path">
            {{ project.workingDirectory }}
          </p>
          <p
            v-if="project.sessionCount > 0 || project.lastActivityAt"
            class="project-meta"
          >
            <span v-if="project.sessionCount > 0">{{ project.sessionCount }} session{{ project.sessionCount !== 1 ? 's' : '' }}</span>
            <template v-if="project.sessionCount > 0 && project.lastActivityAt">
              <span class="meta-separator">·</span>
            </template>
            <span v-if="project.lastActivityAt">{{ formatRelativeTime(project.lastActivityAt) }}</span>
          </p>
        </div>
        <div class="project-actions">
          <router-link
            :to="`/projects/${project.id}/edit`"
            class="btn edit-btn"
            @click.stop
          >
            <span class="edit-label-full">Edit</span>
            <span
              class="edit-label-short"
              aria-hidden="true"
            >&#9881;</span>
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useProjectsStore } from '../stores/projects.js';
import { formatRelativeTime } from '../composables/useSummaryHelpers.js';

const router = useRouter();
const projectsStore = useProjectsStore();

function goToSessions(projectId) {
  router.push(`/projects/${projectId}/sessions`);
}

onMounted(() => {
  projectsStore.fetchProjects();
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

.project-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.project-card:hover {
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

.project-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
  margin-left: 1rem;
}

.edit-label-short {
  display: none;
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
  .project-card {
    padding: 0.75rem;
  }
  .edit-label-full {
    display: none;
  }
  .edit-label-short {
    display: inline;
  }
}
</style>
