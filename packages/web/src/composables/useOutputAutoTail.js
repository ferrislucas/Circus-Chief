import { ref, nextTick, onBeforeUnmount } from 'vue';

/**
 * Bottom tolerance (in CSS pixels) used to decide whether a scroll container
 * is "at the bottom" for the purposes of auto-tailing. Matches the FRD's
 * 8-24px acceptable range.
 */
export const OUTPUT_BOTTOM_TOLERANCE_PX = 16;

/**
 * Composable that implements a two-state ("tailing" / "paused") log-tail
 * behavior for a scrollable output pane.
 *
 * State transitions are driven entirely by explicit calls:
 * - `handleScroll()` should be wired to the container's native `scroll`
 *   event. It derives tailing state purely from current scroll geometry,
 *   so it correctly distinguishes user-driven scrolling from output growth.
 * - `resetTail()` should be called at session boundaries (pane expansion,
 *   modal open, run change) to force tail mode back on.
 * - `handleRenderedOutput()` should be called after the formatted output
 *   has changed (post-render), and only schedules a scroll when already
 *   tailing.
 *
 * Programmatic scrolling performed by this composable never mutates
 * `isTailing` itself - only `handleScroll` (a real user scroll event) does.
 *
 * @param {import('vue').Ref<HTMLElement|null>} containerRef - template ref
 *   for the element that owns vertical scrolling.
 */
export function useOutputAutoTail(containerRef) {
  const isTailing = ref(true);

  let pendingFrame = false;
  let frameId = null;
  let disposed = false;

  function getDistanceFromBottom(el) {
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distance < 0 ? 0 : distance;
  }

  /**
   * Derive tailing state from the container's current scroll geometry.
   * Intended to be wired to the container's native `scroll` event so it
   * fires for wheel, trackpad, scrollbar-drag, keyboard, and touch
   * scrolling alike.
   */
  function handleScroll() {
    const el = containerRef.value;
    if (!el) return;
    isTailing.value = getDistanceFromBottom(el) <= OUTPUT_BOTTOM_TOLERANCE_PX;
  }

  function runScrollToBottom() {
    frameId = null;
    pendingFrame = false;
    if (disposed) return;
    // A frame scheduled while tailing can still be pending when the user
    // scrolls away. Re-read the state at frame time so a paused pane is never
    // yanked back to the bottom by work queued before the pause.
    if (!isTailing.value) return;
    const el = containerRef.value;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }

  /**
   * Schedule a single coalesced scroll-to-bottom after the next DOM patch.
   * Repeated calls before the scheduled frame runs collapse into one frame.
   */
  function scheduleScrollToBottom() {
    if (disposed || pendingFrame) return;
    pendingFrame = true;
    nextTick(() => {
      if (disposed) {
        pendingFrame = false;
        return;
      }
      frameId = requestAnimationFrame(runScrollToBottom);
    });
  }

  /**
   * Enter tail mode. Call at meaningful session boundaries: pane expansion,
   * modal open, or a run/session change.
   *
   * @param {Object} [options]
   * @param {boolean} [options.scroll=false] - When true, also schedule a
   *   post-render scroll to the bottom (used when the container is already
   *   mounted/visible).
   */
  function resetTail({ scroll = false } = {}) {
    isTailing.value = true;
    if (scroll) {
      scheduleScrollToBottom();
    }
  }

  /**
   * Notify the composable that rendered output changed. Only schedules a
   * scroll when the pane is currently tailing; while paused, incoming
   * output never moves the viewport.
   */
  function handleRenderedOutput() {
    if (isTailing.value) {
      scheduleScrollToBottom();
    }
  }

  /**
   * Cancel any pending scheduled work. Safe to call multiple times.
   */
  function dispose() {
    disposed = true;
    pendingFrame = false;
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  }

  onBeforeUnmount(dispose);

  return {
    isTailing,
    handleScroll,
    resetTail,
    handleRenderedOutput,
    dispose,
  };
}
