<template>
  <div class="command-grid">
    <!-- Search box -->
    <div class="search-box">
      <input
        ref="searchInput"
        v-model="searchQuery"
        type="text"
        placeholder="Search commands..."
        class="search-input"
        data-testid="command-search"
        @keydown.escape="emit('close')"
      >
    </div>

    <!-- Loading state -->
    <div
      v-if="loading"
      class="loading-state"
    >
      <span class="loading-spinner" />
      <span>Loading commands...</span>
    </div>

    <!-- Error state -->
    <div
      v-else-if="error"
      class="error-state"
    >
      <span class="error-icon">⚠️</span>
      <span>{{ error }}</span>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="filteredCommands.length === 0"
      class="empty-state"
    >
      <span v-if="searchQuery">No commands match "{{ searchQuery }}"</span>
      <span v-else>No slash commands available</span>
    </div>

    <!-- Command sections -->
    <div
      v-else
      class="command-sections"
    >
      <!-- Built-in Commands -->
      <div
        v-if="filteredBuiltinCommands.length > 0 && !hideBuiltin"
        class="command-section"
      >
        <h3 class="section-title">
          Built-in Commands
        </h3>
        <div class="command-cards">
          <button
            v-for="cmd in filteredBuiltinCommands"
            :key="cmd.name"
            type="button"
            class="command-card"
            :data-testid="`command-${cmd.name}`"
            @click="selectCommand(cmd)"
          >
            <span class="command-name">/{{ cmd.name }}</span>
            <span class="command-description">{{ cmd.description || 'No description' }}</span>
          </button>
        </div>
      </div>

      <!-- Project Commands -->
      <div
        v-if="filteredProjectCommands.length > 0"
        class="command-section"
      >
        <h3 class="section-title">
          Project Commands
        </h3>
        <div class="command-cards">
          <button
            v-for="cmd in filteredProjectCommands"
            :key="cmd.name"
            type="button"
            class="command-card"
            :data-testid="`command-${cmd.name}`"
            @click="selectCommand(cmd)"
          >
            <span class="command-name">/{{ cmd.name }}</span>
            <span class="command-description">{{ cmd.description || 'No description' }}</span>
            <span
              v-if="cmd.arguments.length > 0"
              class="command-args-badge"
            >
              {{ cmd.arguments.length }} arg{{ cmd.arguments.length > 1 ? 's' : '' }}
            </span>
          </button>
        </div>
      </div>

      <!-- User Commands -->
      <div
        v-if="filteredUserCommands.length > 0"
        class="command-section"
      >
        <h3 class="section-title">
          User Commands
        </h3>
        <div class="command-cards">
          <button
            v-for="cmd in filteredUserCommands"
            :key="cmd.name"
            type="button"
            class="command-card"
            :data-testid="`command-${cmd.name}`"
            @click="selectCommand(cmd)"
          >
            <span class="command-name">/{{ cmd.name }}</span>
            <span class="command-description">{{ cmd.description || 'No description' }}</span>
            <span
              v-if="cmd.arguments.length > 0"
              class="command-args-badge"
            >
              {{ cmd.arguments.length }} arg{{ cmd.arguments.length > 1 ? 's' : '' }}
            </span>
          </button>
        </div>
      </div>

      <!-- Plugin Commands -->
      <div
        v-if="filteredPluginCommands.length > 0"
        class="command-section"
      >
        <h3 class="section-title">
          Plugin Commands
        </h3>
        <div class="command-cards">
          <button
            v-for="cmd in filteredPluginCommands"
            :key="cmd.name"
            type="button"
            class="command-card"
            :data-testid="`command-${cmd.name}`"
            @click="selectCommand(cmd)"
          >
            <span class="command-name">/{{ cmd.name }}</span>
            <span class="command-description">{{ cmd.description || 'No description' }}</span>
            <span
              v-if="cmd.arguments.length > 0"
              class="command-args-badge"
            >
              {{ cmd.arguments.length }} arg{{ cmd.arguments.length > 1 ? 's' : '' }}
            </span>
          </button>
        </div>
      </div>

      <!-- Project Skills -->
      <div
        v-if="filteredProjectSkills.length > 0"
        class="command-section"
      >
        <h3 class="section-title">
          Project Skills
        </h3>
        <div class="command-cards">
          <button
            v-for="skill in filteredProjectSkills"
            :key="skill.name"
            type="button"
            class="command-card"
            :data-testid="`skill-${skill.name}`"
            @click="selectCommand(skill)"
          >
            <span class="command-name">/{{ skill.name }}</span>
            <span class="command-description">{{ skill.description || 'No description' }}</span>
            <span
              v-if="skill.argumentHint"
              class="command-args-badge"
            >
              {{ skill.argumentHint }}
            </span>
          </button>
        </div>
      </div>

      <!-- User Skills -->
      <div
        v-if="filteredUserSkills.length > 0"
        class="command-section"
      >
        <h3 class="section-title">
          User Skills
        </h3>
        <div class="command-cards">
          <button
            v-for="skill in filteredUserSkills"
            :key="skill.name"
            type="button"
            class="command-card"
            :data-testid="`skill-${skill.name}`"
            @click="selectCommand(skill)"
          >
            <span class="command-name">/{{ skill.name }}</span>
            <span class="command-description">{{ skill.description || 'No description' }}</span>
            <span
              v-if="skill.argumentHint"
              class="command-args-badge"
            >
              {{ skill.argumentHint }}
            </span>
          </button>
        </div>
      </div>

      <!-- Plugin Skills -->
      <div
        v-if="filteredPluginSkills.length > 0"
        class="command-section"
      >
        <h3 class="section-title">
          Plugin Skills
        </h3>
        <div class="command-cards">
          <button
            v-for="skill in filteredPluginSkills"
            :key="skill.name"
            type="button"
            class="command-card"
            :data-testid="`skill-${skill.name}`"
            @click="selectCommand(skill)"
          >
            <span class="command-name">/{{ skill.name }}</span>
            <span class="command-description">{{ skill.description || 'No description' }}</span>
            <span
              v-if="skill.argumentHint"
              class="command-args-badge"
            >
              {{ skill.argumentHint }}
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue';

const props = defineProps({
  commands: { type: Array, required: true },
  loading: { type: Boolean, default: false },
  error: { type: String, default: null },
  hideBuiltin: { type: Boolean, default: false },
});

const emit = defineEmits(['select', 'close']);

const searchQuery = ref('');
const searchInput = ref(null);

// Computed lists
const builtinCommands = computed(() =>
  props.commands.filter((c) => c.source === 'builtin')
);
const projectCommands = computed(() =>
  props.commands.filter((c) => c.source === 'project')
);
const userCommands = computed(() =>
  props.commands.filter((c) => c.source === 'user')
);
const pluginCommands = computed(() =>
  props.commands.filter((c) => c.source === 'plugin')
);
const projectSkills = computed(() =>
  props.commands.filter((c) => c.source === 'project-skill')
);
const userSkills = computed(() =>
  props.commands.filter((c) => c.source === 'user-skill')
);
const pluginSkills = computed(() =>
  props.commands.filter((c) => c.source === 'plugin-skill')
);

// Filtered by search
function filterBySearch(commands) {
  if (!searchQuery.value.trim()) {
    return commands;
  }
  const query = searchQuery.value.toLowerCase();
  return commands.filter(
    (c) =>
      c.name.toLowerCase().includes(query) ||
      (c.description && c.description.toLowerCase().includes(query))
  );
}

const filteredBuiltinCommands = computed(() => filterBySearch(builtinCommands.value));
const filteredProjectCommands = computed(() => filterBySearch(projectCommands.value));
const filteredUserCommands = computed(() => filterBySearch(userCommands.value));
const filteredPluginCommands = computed(() => filterBySearch(pluginCommands.value));
const filteredProjectSkills = computed(() => filterBySearch(projectSkills.value));
const filteredUserSkills = computed(() => filterBySearch(userSkills.value));
const filteredPluginSkills = computed(() => filterBySearch(pluginSkills.value));
const filteredCommands = computed(() => [
  ...filteredBuiltinCommands.value,
  ...filteredProjectCommands.value,
  ...filteredUserCommands.value,
  ...filteredPluginCommands.value,
  ...filteredProjectSkills.value,
  ...filteredUserSkills.value,
  ...filteredPluginSkills.value,
]);

function selectCommand(cmd) {
  emit('select', cmd);
}

onMounted(() => {
  // Focus search input when mounted
  nextTick(() => {
    searchInput.value?.focus();
  });
});
</script>

<style scoped>
.command-grid {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-height: 60vh;
  overflow-y: auto;
}

.search-box {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--color-background);
  padding-bottom: 0.5rem;
}

.search-input {
  width: 100%;
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  color: var(--color-text);
  outline: none;
  transition: border-color 0.15s;
}

.search-input:focus {
  border-color: var(--color-accent);
}

.search-input::placeholder {
  color: var(--color-text-soft);
}

.loading-state,
.error-state,
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2rem;
  color: var(--color-text-soft);
  text-align: center;
}

.error-state {
  color: var(--color-danger, #ef4444);
}

.loading-spinner {
  width: 1.25rem;
  height: 1.25rem;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.command-sections {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.command-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.section-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-soft);
  margin: 0;
  padding: 0 0.25rem;
}

.command-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.5rem;
}

.command-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem 1rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s, transform 0.1s;
}

.command-card:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-accent);
}

.command-card:active {
  transform: scale(0.98);
}

.command-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-accent);
  font-family: ui-monospace, monospace;
}

.command-description {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  line-height: 1.4;
  /* Limit to 2 lines */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.command-args-badge {
  display: inline-block;
  margin-top: 0.25rem;
  padding: 0.125rem 0.375rem;
  font-size: 0.625rem;
  font-weight: 500;
  text-transform: uppercase;
  background: rgba(var(--color-accent-rgb, 88, 166, 255), 0.15);
  color: var(--color-accent);
  border-radius: 0.25rem;
  width: fit-content;
}

/* Mobile responsive */
@media (max-width: 480px) {
  .command-cards {
    grid-template-columns: 1fr;
  }
}
</style>
