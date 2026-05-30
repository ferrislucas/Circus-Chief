/* eslint-disable max-lines-per-function */
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionsStore } from '../stores/sessions.js';
import { api } from './useApi.js';
import { sortSessionChain } from '../utils/sessionPickerRecency.js';
import { isSessionDetailDesktop } from './useSessionDetailBreakpoint.js';

/**
 * Composable that manages the session tree (chain of parent/child sessions),
 * overlay target resolution, and chat navigation (desktop tab vs mobile overlay).
 *
 * @param {import('vue').Ref<string>} currentSessionId
 * @param {import('vue').Ref<boolean>} sessionChainReady
 */
export function useSessionTree(currentSessionId, sessionChainReady) {
  const route = useRoute();
  const router = useRouter();
  const sessionsStore = useSessionsStore();

  const chatOverlayOpen = ref(false);
  const overlaySessionId = ref(currentSessionId.value);
  const preferredOverlaySessionId = ref(null);
  const preferredOverlaySession = ref(null);

  const sessionChain = ref([]);
  const summariesMap = ref({});

  // ── Session chain helpers ──────────────────────────────────────────

  async function mergeProjectSessionsToStore(projectId) {
    try {
      const projectSessions = await api.getProjectSessions(projectId, false, null);
      for (const s of projectSessions) {
        const idx = sessionsStore.sessions.findIndex(existing => existing.id === s.id);
        if (idx >= 0) {
          sessionsStore.sessions[idx] = s;
        } else {
          sessionsStore.sessions.push(s);
        }
      }
    } catch {
      // Not critical if project sessions fail to load
    }
  }

  function findRootSession(sessionId) {
    const root = sessionsStore.getRootSession(sessionId);
    if (root) return { root, earlyReturn: null };

    const current = sessionsStore.getSessionById(sessionId) || sessionsStore.currentSession;
    if (current && !current.parentSessionId) return { root: current, earlyReturn: null };
    if (current) return { root: null, earlyReturn: [{ session: current, depth: 0 }] };
    return { root: null, earlyReturn: null };
  }

  function collectTreeDepthFirst(root) {
    const tree = [];
    function walk(session, depth) {
      tree.push({ session, depth });
      const children = sessionsStore.getChildSessions(session.id);
      for (const child of children) walk(child, depth + 1);
    }
    walk(root, 0);
    return tree;
  }

  async function buildSessionChain() {
    const sessionId = currentSessionId.value;
    const existingSession = sessionsStore.getSessionById(sessionId) || sessionsStore.currentSession;
    if (!existingSession) {
      try { await sessionsStore.fetchSession(sessionId, false); } catch { return; }
    }

    const session = sessionsStore.getSessionById(sessionId) || sessionsStore.currentSession;
    if (session?.projectId) await mergeProjectSessionsToStore(session.projectId);

    const { root, earlyReturn } = findRootSession(sessionId);
    if (earlyReturn) { sessionChain.value = sortSessionChain(earlyReturn); return; }
    if (!root) return;

    const tree = sortSessionChain(collectTreeDepthFirst(root));
    sessionChain.value = tree;

    for (const entry of tree) {
      if (!summariesMap.value[entry.session.id]) {
        api.getSessionSummary(entry.session.id)
          .then(fetchedSummary => { if (fetchedSummary) summariesMap.value = { ...summariesMap.value, [entry.session.id]: fetchedSummary }; })
          .catch(() => { /* Summaries are not critical */ });
      }
    }
  }

  // ── Overlay target resolution ──────────────────────────────────────

  function resolveOverlayTarget() {
    const chain = sessionChain.value;

    if (preferredOverlaySessionId.value) {
      const preferred = chain.find(entry => entry.session.id === preferredOverlaySessionId.value);
      if (preferred) {
        overlaySessionId.value = preferred.session.id;
        return;
      }
      if (preferredOverlaySession.value?.id === preferredOverlaySessionId.value) {
        overlaySessionId.value = preferredOverlaySession.value.id;
        return;
      }
    }

    if (chain.length <= 1) {
      overlaySessionId.value = currentSessionId.value;
      return;
    }

    const runningChildren = chain
      .filter(entry => entry.session.status === 'running' || entry.session.status === 'starting')
      .filter(entry => entry.session.id !== currentSessionId.value);

    if (runningChildren.length > 0) {
      const sorted = sortSessionChain(runningChildren);
      overlaySessionId.value = sorted[0].session.id;
      return;
    }

    const withActivity = sortSessionChain(chain)
      .filter(entry => entry.pickerTimestamp);

    if (withActivity.length > 0) {
      overlaySessionId.value = withActivity[0].session.id;
      return;
    }

    overlaySessionId.value = currentSessionId.value;
  }

  // ── Chat navigation (desktop tab vs mobile overlay) ────────────────

  async function openChatDestination({ targetSessionId = null, replaceQuery = false } = {}) {
    if (targetSessionId) {
      preferredOverlaySessionId.value = targetSessionId;
      overlaySessionId.value = targetSessionId;
    } else {
      resolveOverlayTarget();
    }

    if (isSessionDetailDesktop()) {
      chatOverlayOpen.value = false;
      const path = `/sessions/${currentSessionId.value}/chat`;
      const navigation = { path, query: {} };
      if (replaceQuery) {
        await router.replace(navigation);
      } else if (route.path !== path) {
        await router.push(path);
      }
      return;
    }

    chatOverlayOpen.value = true;
    if (replaceQuery) {
      await router.replace({ path: route.path, query: {} });
    }
  }

  function handleOverlayOpen() {
    openChatDestination();
  }

  async function handleScheduledSessionClick(sessionId) {
    await buildSessionChain();
    await openChatDestination({ targetSessionId: sessionId });
  }

  // ── WebSocket event handlers ───────────────────────────────────────

  function handleSessionUpdated(msg) {
    const updatedSession = msg.session;
    if (!updatedSession) return;

    const idx = sessionChain.value.findIndex(
      entry => entry.session.id === updatedSession.id
    );
    if (idx >= 0) {
      const updatedEntries = [...sessionChain.value];
      updatedEntries[idx] = {
        ...sessionChain.value[idx],
        session: updatedSession,
      };
      sessionChain.value = sortSessionChain(updatedEntries);
    }
  }

  function handleSessionCreated(msg) {
    const projectId = sessionsStore.currentSession?.projectId;
    if (!projectId || msg.projectId !== projectId) return;

    const newSession = msg.session;
    if (!newSession?.parentSessionId) return;

    if (chatOverlayOpen.value) return;

    const isChildOfTree = sessionChain.value.some(
      entry => entry.session.id === newSession.parentSessionId
    );
    if (!isChildOfTree) return;

    sessionsStore.addSessionToList(newSession);

    if (newSession.status === 'running' || newSession.status === 'starting') {
      overlaySessionId.value = newSession.id;
    }

    buildSessionChain();
  }

  // ── Overlay session created / close ────────────────────────────────

  async function handleOverlaySessionCreated(session) {
    const createdSession = typeof session === 'string'
      ? sessionsStore.getSessionById(session)
      : session;
    const sessionId = typeof session === 'string' ? session : session?.id;
    if (!sessionId) return;

    preferredOverlaySessionId.value = sessionId;
    preferredOverlaySession.value = createdSession || null;
    overlaySessionId.value = sessionId;

    if (createdSession) {
      sessionsStore.addSessionToList(createdSession);
    }

    await buildSessionChain();
    if (
      preferredOverlaySession.value &&
      !sessionChain.value.some(entry => entry.session.id === sessionId)
    ) {
      const parentEntry = sessionChain.value.find(
        entry => entry.session.id === preferredOverlaySession.value.parentSessionId
      );
      sessionChain.value = sortSessionChain([
        { session: preferredOverlaySession.value, depth: parentEntry ? parentEntry.depth + 1 : 0 },
        ...sessionChain.value,
      ]);
    }
    resolveOverlayTarget();
  }

  async function handleOverlayClose() {
    chatOverlayOpen.value = false;
    sessionsStore.viewedSessionId = currentSessionId.value;
    await sessionsStore.fetchSession(currentSessionId.value, false);
  }

  // ── Computed helpers exposed to the view ────────────────────────────

  const isSessionActive = computed(() => {
    const status = sessionsStore.currentSession?.status;
    if (status === 'running' || status === 'starting') return true;
    return sessionChain.value.some(entry =>
      entry.session.status === 'running' || entry.session.status === 'starting'
    );
  });

  const activeSessionStatus = computed(() => {
    const currentStatus = sessionsStore.currentSession?.status;
    if (currentStatus === 'running' || currentStatus === 'starting') return currentStatus;
    const active = sessionChain.value.find(entry =>
      entry.session.status === 'running' || entry.session.status === 'starting'
    );
    return active?.session.status || currentStatus;
  });

  // ── Route reset helper ─────────────────────────────────────────────

  function resetPreferred() {
    preferredOverlaySessionId.value = null;
    preferredOverlaySession.value = null;
  }

  return {
    chatOverlayOpen,
    overlaySessionId,
    sessionChain,
    summariesMap,
    isSessionActive,
    activeSessionStatus,
    buildSessionChain,
    resolveOverlayTarget,
    openChatDestination,
    handleOverlayOpen,
    handleScheduledSessionClick,
    handleSessionUpdated,
    handleSessionCreated,
    handleOverlaySessionCreated,
    handleOverlayClose,
    resetPreferred,
  };
}
