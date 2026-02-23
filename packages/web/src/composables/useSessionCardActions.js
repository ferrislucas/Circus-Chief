import { computed, ref, onMounted } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { api } from './useApi.js';

/**
 * Composable for SessionCard action handlers and button status logic.
 *
 * @param {import('vue').Ref<Object>} props - Component props (session, summary, showArchive, showUnarchive, isChild)
 * @param {Function} emit - Component emit function
 * @returns {Object} Action handlers, button statuses, and related state
 */
export function useSessionCardActions(props, emit) {
  const sessionsStore = useSessionsStore();
  const commandButtonsStore = useCommandButtonsStore();
  const selectedButtonForModal = ref(null);
  const filesCount = ref(0);

  // Show archive for statuses that are no longer active (not running or starting)
  const canArchive = computed(() => {
    return props.session.status !== 'running' && props.session.status !== 'starting';
  });

  const buttonStatusesToDisplay = computed(() => {
    const projectId = props.session.projectId;
    if (!projectId) return [];

    // Access commandRunVersion to establish Vue dependency tracking.
    // This forces the computed to re-evaluate whenever updateSessionCommandRun is called,
    // ensuring real-time updates on the session list view.
    // eslint-disable-next-line no-unused-vars
    const _version = sessionsStore.commandRunVersion;

    const buttons = commandButtonsStore.getButtonsByProjectId(projectId);
    const buttonMap = Object.fromEntries(buttons.map(b => [b.id, b]));

    // Get latestCommandRuns from the store session.
    const sessionId = props.session.id;
    const sessions = sessionsStore.sessions;
    const storeSession = sessions.find(s => s.id === sessionId);
    const latestRuns = storeSession?.latestCommandRuns || props.session.latestCommandRuns || [];

    return latestRuns
      .filter(run => buttonMap[run.buttonId]?.showOnList)
      .map(run => ({
        buttonId: run.buttonId,
        label: buttonMap[run.buttonId].label,
        command: buttonMap[run.buttonId].command,
        status: run.status,
        latestRun: run,
      }));
  });

  const commandButtons = computed(() => {
    const projectId = props.session.projectId;
    if (!projectId) return [];
    return commandButtonsStore.getButtonsByProjectId(projectId);
  });

  const getStatusIcon = (status) => {
    switch (status) {
      case 'running':
        return '\u2299';
      case 'success':
        return '\u2713';
      case 'error':
        return '\u2715';
      case 'killed':
        return '\u2715';
      default:
        return '';
    }
  };

  const onArchiveClick = () => {
    if (confirm('Archive this session?')) {
      emit('archive', props.session.id);
    }
  };

  const onUnarchiveClick = () => {
    if (confirm('Restore this session to active?')) {
      emit('unarchive', props.session.id);
    }
  };

  const onStarClick = () => {
    sessionsStore.toggleSessionStar(props.session.id);
  };

  // Fetch modified files count on mount
  onMounted(async () => {
    try {
      const result = await api.getSessionFilesCount(props.session.id);
      filesCount.value = result.count || 0;
    } catch (error) {
      console.warn('Failed to fetch files count:', error);
      // If API fails, fall back to LLM summary count
      if (props.summary?.filesModified?.length) {
        filesCount.value = props.summary.filesModified.length;
      }
    }
  });

  return {
    selectedButtonForModal,
    filesCount,
    canArchive,
    buttonStatusesToDisplay,
    commandButtons,
    getStatusIcon,
    onArchiveClick,
    onUnarchiveClick,
    onStarClick,
  };
}
