<template>
  <div class="container">
    <div class="page-header">
      <h1>Projects</h1>
      <router-link
        to="/projects/new"
        class="btn btn-primary"
      >
        New Project
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
      <p>No projects yet. Create your first project to get started.</p>
      <router-link
        to="/projects/new"
        class="btn btn-primary"
      >
        Create Project
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
        </div>
        <div class="project-actions">
          <router-link
            :to="`/projects/${project.id}/edit`"
            class="btn"
            @click.stop
          >
            Edit
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

.empty-state {
  text-align: center;
  padding: 3rem;
  color: var(--color-text-soft);
}

.empty-state p {
  margin-bottom: 1rem;
}

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

.project-name {
  margin: 0 0 0.25rem;
  font-size: 1rem;
}

.project-path {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text-soft);
  font-family: var(--font-mono);
}

.project-actions {
  display: flex;
  gap: 0.5rem;
}
</style>
