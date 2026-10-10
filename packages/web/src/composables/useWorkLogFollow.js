import { ref, watch, nextTick, onBeforeUnmount } from 'vue';

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

  // Last scrollTop we set ourselves (read back clamped). A scroll event
  // that echoes our own pin must not disengage follow mode: a tall wrapped
  // tail can render taller after the pin ran (late fonts, wrap reflow,
  // deferred rendering), and treating that echo as a scroll-away would
  // strand the newest line below the fold with nothing re-pinning it.
  let lastPinnedTop = null;

  // Derive follow state purely from current scroll geometry, so only a real
  // user scroll away from the bottom disengages follow mode. Cheap enough
  // for a passive scroll listener: three reads and one comparison.
  function handleScroll(event) {
    const container = event?.target;
    if (!container) return;
    if (lastPinnedTop !== null && Math.abs(container.scrollTop - lastPinnedTop) < 2) {
      return; // Echo of our own pin — still following.
    }
    lastPinnedTop = null;
    const { scrollTop, scrollHeight, clientHeight } = container;
    isNearBottom.value = scrollHeight - scrollTop - clientHeight < WORK_LOG_SCROLL_THRESHOLD;
  }

  // Convergent re-pin watch after each follow scroll. Rendered content
  // routinely grows after the pin ran (late wrap reflow, overlay settling,
  // deferred rendering), and at pin time it still measures its placeholder
  // height and looks settled — so every pin arms a frame watch that only
  // stops after several consecutive settled frames (or the frame budget, or
  // the moment follow disengages). Each frame re-checks follow state, so a
  // scrolled-up user is never yanked.
  const REPIN_MAX_FRAMES = 60; // ~1s outer bound for late growth
  const REPIN_SETTLED_FRAMES = 5; // consecutive settled frames to stop

  // Scroll to the newest item when following (and active). Runs post-render
  // so the fresh rows are measured, and re-checks follow state at run time
  // so a scroll-away that lands before the tick is never yanked back.
  function scrollToBottom(remaining = REPIN_MAX_FRAMES, settledStreak = 0) {
    nextTick(() => {
      if (!isNearBottom.value || !isActive()) return;
      let container = null;
      try {
        container = resolveContainer ? resolveContainer() : null;
        if (!container) return;
        container.scrollTop = container.scrollHeight;
        // Only a real pin arms echo-suppression: recording a no-op pin at
        // the top of an unscrollable container would later swallow the
        // user's genuine scroll-away as an "echo".
        lastPinnedTop = container.scrollHeight > container.clientHeight ? container.scrollTop : null;
      } catch {
        // DOM may be unavailable in some environments; silently ignore.
        return;
      }
      if (remaining <= 0 || typeof requestAnimationFrame === 'undefined') return;
      const settled =
        container.scrollHeight - container.scrollTop - container.clientHeight <=
        WORK_LOG_SCROLL_THRESHOLD;
      if ((settled ? settledStreak + 1 : 0) < REPIN_SETTLED_FRAMES) {
        requestAnimationFrame(() => scrollToBottom(remaining - 1, settled ? settledStreak + 1 : 0));
      }
    });
  }

  // `post` flush lets Vue batch DOM updates instead of forcing sync runs.
  for (const source of watchSources) {
    watch(source, () => {
      scrollToBottom();
    }, { flush: 'post' });
  }

  // Re-pin when the container box itself resizes (viewport or overlay width
  // changes re-wrap tall tails). Inner content growth past a fixed
  // max-height does not resize the box, so late growth is covered by the
  // convergent re-pin above instead. Both paths are gated by follow state,
  // so a scrolled-up user is never yanked.
  let resizeObserver = null;
  function observeContainer(container) {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (container && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        scrollToBottom();
      });
      resizeObserver.observe(container);
    }
  }
  watch(() => (resolveContainer ? resolveContainer() : null), observeContainer, { flush: 'post' });
  observeContainer(resolveContainer ? resolveContainer() : null);
  onBeforeUnmount(() => {
    if (resizeObserver) resizeObserver.disconnect();
  });

  return { isNearBottom, handleScroll, scrollToBottom };
}
