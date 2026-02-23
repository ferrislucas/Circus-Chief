import { onMounted, onUnmounted } from 'vue';

/**
 * Vue composable that tracks the visual viewport offset and updates CSS variables.
 * This is needed for iOS Safari, where the browser chrome (URL bar + tab bar) can
 * physically overlap sticky-positioned elements when expanded.
 *
 * Sets --viewport-offset-top CSS variable on document.documentElement, which can be
 * used to offset sticky elements: top: calc(var(--header-height) + var(--viewport-offset-top))
 *
 * On browsers without visualViewport API, this no-ops and --viewport-offset-top remains 0px.
 */
export function useVisualViewport() {
  let rafId = null;

  /**
   * Update the CSS variable with the current visual viewport offset.
   * Throttled using requestAnimationFrame to prevent jitter.
   */
  function updateViewportOffset() {
    if (rafId) {
      return;
    }

    rafId = requestAnimationFrame(() => {
      if (window.visualViewport) {
        const offsetTop = window.visualViewport.offsetTop || 0;
        document.documentElement.style.setProperty('--viewport-offset-top', `${offsetTop}px`);
      }
      rafId = null;
    });
  }

  /**
   * Handle visual viewport resize and scroll events.
   */
  function handleViewportChange() {
    updateViewportOffset();
  }

  onMounted(() => {
    // Check if visualViewport API is supported
    if (!window.visualViewport) {
      return;
    }

    // Set initial value
    updateViewportOffset();

    // Listen for viewport changes (scroll and resize events)
    window.visualViewport.addEventListener('scroll', handleViewportChange);
    window.visualViewport.addEventListener('resize', handleViewportChange);
  });

  onUnmounted(() => {
    // Clean up event listeners
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('scroll', handleViewportChange);
      window.visualViewport.removeEventListener('resize', handleViewportChange);
    }

    // Cancel any pending raf
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  });

  return {
    updateViewportOffset,
  };
}
