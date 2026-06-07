import { computed, ref } from 'vue';
import { api } from './useApi.js';

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildFragments(status) {
  if (!status) return [];

  const fragments = [];
  if (status.localChangeCount > 0) {
    fragments.push(pluralize(status.localChangeCount, 'local file'));
  }
  if (status.aheadCount > 0) {
    fragments.push(pluralize(status.aheadCount, 'unpushed commit'));
  }
  if (status.behindCount > 0) {
    fragments.push(`${pluralize(status.behindCount, 'commit')} to pull`);
  }
  if (status.syncStatus === 'unpublished') {
    fragments.push('Branch not pushed');
  }
  return fragments;
}

function hasUsableStatus(status) {
  return status && status.syncStatus !== 'unknown';
}

export function formatGitStatusSummary(status, fallback = 'Git status unknown') {
  if (!status) return fallback;
  const fragments = buildFragments(status);
  if (fragments.length > 0) return fragments.join(' · ');
  if (status.syncStatus === 'clean') return 'Git clean';
  return fallback;
}

export function useSessionGitStatus({ getSessionId }) {
  const gitStatus = ref(null);
  const loading = ref(false);
  const error = ref(null);
  let requestToken = 0;

  const hasActionableGitStatus = computed(() => {
    if (hasUsableStatus(gitStatus.value)) {
      return (
        gitStatus.value.localChangeCount > 0 ||
        gitStatus.value.aheadCount > 0 ||
        gitStatus.value.behindCount > 0 ||
        gitStatus.value.syncStatus === 'unpublished'
      );
    }
    return Boolean(error.value);
  });

  const summaryText = computed(() => {
    if (error.value && !gitStatus.value) return 'Git status unknown';
    return formatGitStatusSummary(gitStatus.value, loading.value ? 'Checking Git...' : 'Git status unknown');
  });

  const shortSummaryText = computed(() => summaryText.value);

  const indicatorTitle = computed(() => {
    if (error.value && !gitStatus.value) return error.value.message || 'Git status unknown';
    const status = gitStatus.value;
    if (!status) return summaryText.value;
    const fragments = buildFragments(status);
    if (fragments.length > 0) return fragments.join(', ');
    return summaryText.value;
  });

  async function refresh(options = {}) {
    const sessionId = getSessionId();
    if (!sessionId) return null;

    const token = ++requestToken;
    loading.value = true;
    try {
      const status = await api.getSessionGitStatus(sessionId, { fetch: options.fetch === true });
      if (token !== requestToken || getSessionId() !== sessionId) {
        return gitStatus.value;
      }
      gitStatus.value = status;
      error.value = null;
      return status;
    } catch (err) {
      if (token === requestToken && getSessionId() === sessionId) {
        error.value = err;
      }
      return gitStatus.value;
    } finally {
      if (token === requestToken) {
        loading.value = false;
      }
    }
  }

  function reset() {
    requestToken += 1;
    gitStatus.value = null;
    loading.value = false;
    error.value = null;
  }

  return {
    gitStatus,
    loading,
    error,
    summaryText,
    shortSummaryText,
    indicatorTitle,
    hasActionableGitStatus,
    refresh,
    reset,
  };
}
