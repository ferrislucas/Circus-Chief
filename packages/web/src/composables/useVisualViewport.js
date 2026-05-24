import { onMounted, onUnmounted } from 'vue';
import { computeSessionOverlayKeyboardBottomInset } from './sessionOverlayKeyboardInset.js';

export { computeSessionOverlayKeyboardBottomInset } from './sessionOverlayKeyboardInset.js';

let rafId = null;
let settleRafId = null;
let settleTimerId = null;
let settleStartedAt = 0;
let settleLastRect = null;
let settleStableSamples = 0;
let isSessionOverlayPromptFocused = false;

function getPixelValue(value, fallback) {
  return Number.isFinite(value) ? `${value}px` : fallback;
}

function getVisualViewportRect() {
  const { offsetTop, height } = window.visualViewport;
  return { offsetTop, height };
}

export function setSessionOverlayPromptFocus(focused) {
  isSessionOverlayPromptFocused = Boolean(focused);
  if (!isSessionOverlayPromptFocused) {
    document.documentElement.style.setProperty(
      '--session-overlay-keyboard-bottom-inset',
      '0px'
    );
  }
  requestVisualViewportUpdate();
}

function rectsMatch(a, b) {
  return a && b && a.offsetTop === b.offsetTop && a.height === b.height;
}

export function writeVisualViewportVariables() {
  if (!window.visualViewport) {
    return null;
  }

  const rect = getVisualViewportRect();
  document.documentElement.style.setProperty(
    '--viewport-offset-top',
    getPixelValue(rect.offsetTop, '0px')
  );
  document.documentElement.style.setProperty(
    '--visual-viewport-height',
    getPixelValue(rect.height, '100dvh')
  );
  const sessionOverlayKeyboardBottomInset = computeSessionOverlayKeyboardBottomInset({
    isOverlayPromptFocused: isSessionOverlayPromptFocused,
    layoutWidth: window.innerWidth,
    layoutHeight: window.innerHeight,
    visualViewportHeight: rect.height,
    visualViewportOffsetTop: rect.offsetTop,
    userAgent: window.navigator?.userAgent,
    platform: window.navigator?.platform,
    maxTouchPoints: window.navigator?.maxTouchPoints,
  });
  document.documentElement.style.setProperty(
    '--session-overlay-keyboard-bottom-inset',
    `${sessionOverlayKeyboardBottomInset}px`
  );
  return rect;
}

/**
 * Schedule a CSS variable update for the current visual viewport rectangle.
 * Throttled using requestAnimationFrame to prevent jitter.
 */
export function requestVisualViewportUpdate() {
  if (!window.visualViewport || rafId) {
    return;
  }

  rafId = requestAnimationFrame(() => {
    writeVisualViewportVariables();
    rafId = null;
  });
}

function cancelVisualViewportUpdate() {
  if (!rafId) {
    return;
  }

  cancelAnimationFrame(rafId);
  rafId = null;
}

function cancelVisualViewportSettle() {
  if (settleRafId) {
    cancelAnimationFrame(settleRafId);
    settleRafId = null;
  }

  if (settleTimerId) {
    clearTimeout(settleTimerId);
    settleTimerId = null;
  }

  settleStartedAt = 0;
  settleLastRect = null;
  settleStableSamples = 0;
}

/**
 * Keep sampling the visual viewport through short browser UI transitions.
 *
 * iOS Safari can report the keyboard-open viewport for a few frames after a
 * text input blurs. A bounded settle loop prevents that stale rectangle from
 * becoming the final CSS viewport state after keyboard dismissal.
 */
export function requestVisualViewportSettle(options = {}) {
  if (!window.visualViewport) {
    return;
  }

  const {
    maxDurationMs = 500,
    intervalMs = 50,
    stableSampleCount = 2,
    minDurationMs = 150,
  } = options;

  cancelVisualViewportSettle();

  settleStartedAt = performance.now();

  const sample = () => {
    settleRafId = null;

    const rect = writeVisualViewportVariables();
    if (!rect) {
      cancelVisualViewportSettle();
      return;
    }

    if (rectsMatch(rect, settleLastRect)) {
      settleStableSamples += 1;
    } else {
      settleStableSamples = 1;
      settleLastRect = rect;
    }

    const elapsed = performance.now() - settleStartedAt;
    const isStable =
      settleStableSamples >= stableSampleCount && elapsed >= minDurationMs;
    if (isStable || elapsed >= maxDurationMs) {
      cancelVisualViewportSettle();
      return;
    }

    settleTimerId = setTimeout(() => {
      settleTimerId = null;
      settleRafId = requestAnimationFrame(sample);
    }, intervalMs);
  };

  settleRafId = requestAnimationFrame(sample);
}

/**
 * Subscribe a callback to `visualViewport` scroll/resize events.
 * Returns a teardown function that removes both listeners.
 *
 * @param {() => void} callback
 * @returns {() => void} cleanup function
 */
export function onVisualViewportChange(callback) {
  if (!window.visualViewport) return () => {};
  window.visualViewport.addEventListener('scroll', callback);
  window.visualViewport.addEventListener('resize', callback);
  return () => {
    window.visualViewport.removeEventListener('scroll', callback);
    window.visualViewport.removeEventListener('resize', callback);
  };
}

/**
 * Vue composable that tracks the visual viewport rectangle and updates CSS variables.
 * This is needed for browser chrome and software keyboard transitions that
 * change the visual viewport while the layout viewport remains stable.
 *
 * Sets raw visual viewport CSS variables on document.documentElement, plus the
 * session overlay keyboard spacer inset while the overlay prompt is focused.
 *
 * On browsers without visualViewport API, this no-ops and CSS fallbacks apply.
 */
export function useVisualViewport() {
  /**
   * Handle visual viewport resize and scroll events.
   */
  function handleViewportChange() {
    requestVisualViewportUpdate();
  }

  onMounted(() => {
    // Check if visualViewport API is supported
    if (!window.visualViewport) {
      return;
    }

    // Set initial value
    requestVisualViewportUpdate();

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
    cancelVisualViewportUpdate();
    cancelVisualViewportSettle();
  });

  return {
    requestVisualViewportUpdate,
    requestVisualViewportSettle,
    updateViewportOffset: requestVisualViewportUpdate,
  };
}
