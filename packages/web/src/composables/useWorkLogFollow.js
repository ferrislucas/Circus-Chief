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
 * @param {() => Element|null} [options.resolveContent] - returns the
 *   naturally sizing inner content element. The scrollable box sits at a
 *   fixed height cap, so content-only growth never resizes it and only an
 *   observer on this inner element can re-pin after the retry window ends.
 * @param {Array<() => unknown>} [options.watchSources] - reactive getters
 *   (log count, streaming partials) that trigger a follow check post-render.
 * @param {() => boolean} [options.isActive] - extra gate (e.g. expanded
 *   panel); collapsed panels never scroll.
 */
function readDims(container) {
  return { scrollHeight: container.scrollHeight, clientHeight: container.clientHeight };
}

function sameDims(a, b) {
  return (
    Boolean(a) &&
    Boolean(b) &&
    a.scrollHeight === b.scrollHeight &&
    a.clientHeight === b.clientHeight
  );
}

function safeResolve(resolver) {
  try {
    return resolver ? resolver() : null;
  } catch {
    return null;
  }
}

// Scroll position to remember for echo-suppression. Only a real pin arms
// it: recording a no-op pin at the top of an unscrollable container would
// later swallow the user's genuine scroll-away as an "echo".
function pinTop(container) {
  return container.scrollHeight > container.clientHeight ? container.scrollTop : null;
}

export function useWorkLogFollow({ resolveContainer = null, resolveContent = null, watchSources = [], isActive = () => true } = {}) {
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
  // deferred rendering), so every follow request arms a frame watch that
  // only stops after several consecutive frames with unchanged dimensions
  // (or the frame budget, or the moment follow disengages). Stability is
  // judged from content/viewport dimensions measured BEFORE each pin: the
  // distance to the bottom right after our own pin is always ~zero, so it
  // can never count as evidence that layout has settled. Each frame
  // re-checks follow state, so a scrolled-up user is never yanked.
  const REPIN_MAX_FRAMES = 60; // ~1s outer bound for late growth
  const REPIN_SETTLED_FRAMES = 5; // consecutive unchanged-dimension frames to stop

  // Single coalesced retry chain: watcher, observer, and explicit follow
  // requests all funnel through requestFollow, so concurrent triggers share
  // one pending frame sequence instead of stacking independent chains.
  let disposed = false;
  let generation = 0; // invalidates queued ticks/frames on teardown or element swap
  let rafId = null;
  let tickPending = false;
  let chainActive = false;
  let remaining = 0;
  let settledStreak = 0;
  let lastDims = null;

  function cancelPendingFrame() {
    if (rafId !== null) {
      if (typeof cancelAnimationFrame !== 'undefined') {
        try {
          cancelAnimationFrame(rafId);
        } catch {
          // Frame may already have run; the generation guard covers it.
        }
      }
      rafId = null;
    }
  }

  function scheduleFrame() {
    if (typeof requestAnimationFrame === 'undefined') {
      chainActive = false;
      return;
    }
    const gen = generation;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (gen !== generation || disposed || !chainActive) return;
      if (!isNearBottom.value || !isActive()) {
        chainActive = false;
        return;
      }
      const container = safeResolve(resolveContainer);
      if (!container) {
        chainActive = false;
        return;
      }
      const dims = readDims(container);
      if (sameDims(dims, lastDims)) {
        settledStreak += 1;
      } else {
        lastDims = dims;
        settledStreak = 0;
      }
      if (settledStreak >= REPIN_SETTLED_FRAMES || remaining <= 0) {
        chainActive = false;
        return;
      }
      try {
        container.scrollTop = container.scrollHeight;
        lastPinnedTop = pinTop(container);
      } catch {
        chainActive = false;
        return;
      }
      remaining -= 1;
      scheduleFrame();
    });
  }

  // Scroll to the newest item when following (and active). Runs post-render
  // so the fresh rows are measured, and re-checks follow state at run time
  // so a scroll-away that lands before the tick is never yanked back. Every
  // request pins promptly; only the frame retry sequence is coalesced, so a
  // request arriving mid-chain refreshes the budget instead of stacking a
  // second chain over it.
  function scrollToBottom() {
    if (disposed) return;
    if (tickPending) {
      remaining = REPIN_MAX_FRAMES;
      return;
    }
    tickPending = true;
    const gen = generation;
    nextTick(() => {
      tickPending = false;
      if (gen !== generation || disposed) return;
      if (!isNearBottom.value || !isActive()) {
        chainActive = false;
        return;
      }
      const container = safeResolve(resolveContainer);
      if (!container) {
        chainActive = false;
        return;
      }
      lastDims = readDims(container);
      try {
        container.scrollTop = container.scrollHeight;
        lastPinnedTop = pinTop(container);
      } catch {
        // DOM may be unavailable in some environments; silently ignore.
        chainActive = false;
        return;
      }
      if (!chainActive) {
        chainActive = true;
        settledStreak = 0;
        scheduleFrame();
      }
      remaining = REPIN_MAX_FRAMES;
    });
  }

  // `post` flush lets Vue batch DOM updates instead of forcing sync runs.
  for (const source of watchSources) {
    watch(source, () => {
      scrollToBottom();
    }, { flush: 'post' });
  }

  // Re-pin on size changes. The outer box is observed for viewport and
  // width changes (re-wrapping tall tails); the inner content element is
  // observed because content growth past the fixed max-height never resizes
  // the box itself — without it, late growth after the retry window ends
  // issues no notification and the newest line stays below the fold. Both
  // paths funnel through the coalesced scheduler and are gated by follow
  // state, so a scrolled-up user is never yanked.
  let resizeObserver = null;
  function observeTargets() {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (typeof ResizeObserver === 'undefined') return;
    const container = safeResolve(resolveContainer);
    const content = safeResolve(resolveContent);
    if (!container && !content) return;
    resizeObserver = new ResizeObserver(() => {
      scrollToBottom();
    });
    if (container) resizeObserver.observe(container);
    if (content && content !== container) resizeObserver.observe(content);
  }

  function rebindTargets() {
    // The pending sequence measured the old elements: drop it so stale
    // callbacks cannot scroll a detached or wrong panel, then re-observe
    // and resume following when still engaged.
    cancelPendingFrame();
    generation += 1;
    chainActive = false;
    tickPending = false;
    settledStreak = 0;
    lastDims = null;
    observeTargets();
    scrollToBottom();
  }

  watch(
    [() => safeResolve(resolveContainer), () => safeResolve(resolveContent)],
    rebindTargets,
    { flush: 'post' },
  );
  observeTargets();
  onBeforeUnmount(() => {
    disposed = true;
    generation += 1;
    chainActive = false;
    tickPending = false;
    cancelPendingFrame();
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
  });

  return { isNearBottom, handleScroll, scrollToBottom };
}
