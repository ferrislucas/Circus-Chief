import { ref, watch, nextTick } from 'vue';

/**
 * Pixels from the bottom that still count as "following" the log stream.
 * Mirrors the proven LiveWorkLogPanel threshold.
 */
export const WORK_LOG_SCROLL_THRESHOLD = 50;

/**
 * Follow-mode auto-scroll for work-log lists (FR-9). While the user is near
 * the bottom, new arrivals scroll to the newest item; any user scroll out
 * of the near-bottom zone disengages follow mode until they scroll back.
 *
 * @param {Object} [options]
 * @param {() => Element|null} [options.resolveContainer] - returns the
 *   scrollable element to move. Callers pass either a template ref lookup
 *   (`() => myRef.value`) or the legacy panel query
 *   (`() => document.querySelector('.live-logs')`).
 * @param {Array<() => unknown>} [options.watchSources] - reactive getters
 *   (log count, streaming partials) that trigger a follow check post-render.
 * @param {() => boolean} [options.isActive] - extra gate (e.g. expanded
 *   panel); collapsed panels never scroll.
 */
export function useWorkLogFollow({ resolveContainer = null, watchSources = [], isActive = () => true } = {}) {
  // Near-bottom until the user scrolls away — new panels open following.
  const isNearBottom = ref(true);

  // Derive follow state purely from current scroll geometry, so only a real
  // user scroll away from the bottom disengages follow mode. Cheap enough
  // for a passive scroll listener: three reads and one comparison.
  function handleScroll(event) {
    const container = event?.target;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    isNearBottom.value = scrollHeight - scrollTop - clientHeight < WORK_LOG_SCROLL_THRESHOLD;
  }

  // Scroll to the newest item when following (and active). Runs post-render
  // so the fresh rows are measured, and re-checks follow state at run time
  // so a scroll-away that lands before the tick is never yanked back.
  function scrollToBottom() {
    nextTick(() => {
      if (!isNearBottom.value || !isActive()) return;
      try {
        const container = resolveContainer ? resolveContainer() : null;
        if (container) container.scrollTop = container.scrollHeight;
      } catch {
        // DOM may be unavailable in some environments; silently ignore.
      }
    });
  }

  // `post` flush lets Vue batch DOM updates instead of forcing sync runs.
  for (const source of watchSources) {
    watch(source, () => {
      scrollToBottom();
    }, { flush: 'post' });
  }

  return { isNearBottom, handleScroll, scrollToBottom };
}
