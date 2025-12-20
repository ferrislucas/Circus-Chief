import { ref, computed, watch } from 'vue';
import { api } from '../api/index.js';

/**
 * Composable for slash command autocomplete functionality
 * @param {import('vue').Ref<string>} workingDirectory - Session working directory
 * @returns {Object} Slash command state and methods
 */
export function useSlashCommands(workingDirectory) {
  const commands = ref([]);
  const loading = ref(false);
  const error = ref(null);
  const filter = ref('');
  const selectedIndex = ref(0);

  /**
   * Filtered commands based on current input
   */
  const filteredCommands = computed(() => {
    if (!filter.value) return commands.value;

    const lowerFilter = filter.value.toLowerCase();
    return commands.value.filter(cmd =>
      cmd.name.toLowerCase().includes(lowerFilter) ||
      cmd.description?.toLowerCase().includes(lowerFilter)
    );
  });

  /**
   * Currently selected command
   */
  const selectedCommand = computed(() =>
    filteredCommands.value[selectedIndex.value] || null
  );

  /**
   * Load commands from API
   */
  async function fetchCommands() {
    if (!workingDirectory.value) return;

    loading.value = true;
    error.value = null;

    try {
      const result = await api.getCommands(workingDirectory.value);
      commands.value = result.commands || [];
    } catch (err) {
      error.value = err.message;
      commands.value = [];
    } finally {
      loading.value = false;
    }
  }

  /**
   * Set filter text
   * @param {string} text - Filter text (without leading slash)
   */
  function setFilter(text) {
    filter.value = text;
  }

  /**
   * Move selection up
   */
  function moveUp() {
    if (selectedIndex.value > 0) {
      selectedIndex.value--;
    }
  }

  /**
   * Move selection down
   */
  function moveDown() {
    if (selectedIndex.value < filteredCommands.value.length - 1) {
      selectedIndex.value++;
    }
  }

  /**
   * Reset state
   */
  function reset() {
    filter.value = '';
    selectedIndex.value = 0;
    error.value = null;
  }

  // Reset selection when filter changes
  watch(filter, () => {
    selectedIndex.value = 0;
  });

  // Fetch commands when working directory changes
  watch(workingDirectory, (newDir) => {
    if (newDir) {
      fetchCommands();
    }
  }, { immediate: true });

  return {
    commands,
    filteredCommands,
    selectedCommand,
    selectedIndex,
    filter,
    loading,
    error,
    fetchCommands,
    setFilter,
    moveUp,
    moveDown,
    reset,
  };
}
