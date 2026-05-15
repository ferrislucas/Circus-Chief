import { onMounted, onUnmounted } from 'vue';

let rafId = null;
let settleRafId = null;
let settleTimerId = null;
let settleStartedAt = 0;
let settleLastRect = null;
let settleStableSamples = 0;

function getPixelValue(value, fallback) {
  return Number.isFinite(value) ? `${value}px` : fallback;
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function hasTabletSignal({ platform = '', userAgent = '', maxTouchPoints = 0 }) {
  const normalizedPlatform = String(platform);
  const normalizedUserAgent = String(userAgent);
  const touchPoints = toFiniteNumber(maxTouchPoints) || 0;

  return (
    /iPad/i.test(normalizedUserAgent) ||
    /iPad/i.test(normalizedPlatform) ||
    (normalizedPlatform === 'MacIntel' && touchPoints > 1) ||
    (/Android/i.test(normalizedUserAgent) && !/Mobile/i.test(normalizedUserAgent))
  );
}

function hasPhoneSignal({ platform = '', userAgent = '' }) {
  const signal = `${platform} ${userAgent}`;
  return /iPhone|iPod|Android.*Mobile|Mobile.*Android/i.test(signal);
}

function isValidTopChromeOffset(offsetTop) {
  return offsetTop > 0 && offsetTop <= 64;
}

function isKeyboardShapedViewport(layoutHeight, visualViewportHeight) {
  if (!(layoutHeight > 0 && visualViewportHeight > 0)) {
    return false;
  }

  return (
    layoutHeight - visualViewportHeight > 120 ||
    visualViewportHeight / layoutHeight < 0.85
  );
}

function isTabletSizedLayout(layoutWidth, layoutHeight) {
  return (
    layoutWidth > 0 &&
    layoutHeight > 0 &&
    Math.min(layoutWidth, layoutHeight) >= 700
  );
}

export function computeSessionOverlayTopChromeInset(input = {}) {
  const offsetTop = toFiniteNumber(input.offsetTop);
  if (!isValidTopChromeOffset(offsetTop)) {
    return 0;
  }

  const layoutWidth = toFiniteNumber(input.layoutWidth);
  const layoutHeight = toFiniteNumber(input.layoutHeight);
  const visualViewportHeight = toFiniteNumber(input.visualViewportHeight);

  if (isKeyboardShapedViewport(layoutHeight, visualViewportHeight)) {
    return 0;
  }

  const tabletSignal = hasTabletSignal(input);
  const phoneSignal = hasPhoneSignal(input);

  if (phoneSignal && !tabletSignal) {
    return 0;
  }

  return isTabletSizedLayout(layoutWidth, layoutHeight) || tabletSignal ? offsetTop : 0;
}

export function computeVisualViewportBottomInset(input = {}) {
  const layoutHeight = toFiniteNumber(input.layoutHeight);
  const visualViewportHeight = toFiniteNumber(input.visualViewportHeight);
  const offsetTop = toFiniteNumber(input.offsetTop) || 0;

  if (!(layoutHeight > 0 && visualViewportHeight > 0)) {
    return 0;
  }

  const bottomInset = layoutHeight - visualViewportHeight - offsetTop;
  if (!Number.isFinite(bottomInset) || bottomInset <= 0) {
    return 0;
  }

  return Math.round(bottomInset);
}

function getVisualViewportRect() {
  const { offsetTop, height } = window.visualViewport;
  return { offsetTop, height };
}

function rectsMatch(a, b) {
  return a && b && a.offsetTop === b.offsetTop && a.height === b.height;
}

function writeVisualViewportVariables() {
  if (!window.visualViewport) {
    return null;
  }

  const rect = getVisualViewportRect();
  const overlayInset = computeSessionOverlayTopChromeInset({
    offsetTop: rect.offsetTop,
    visualViewportHeight: rect.height,
    layoutWidth: window.innerWidth,
    layoutHeight: window.innerHeight,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    userAgent: navigator.userAgent,
  });
  const bottomInset = computeVisualViewportBottomInset({
    offsetTop: rect.offsetTop,
    visualViewportHeight: rect.height,
    layoutHeight: window.innerHeight,
  });
  document.documentElement.style.setProperty(
    '--viewport-offset-top',
    getPixelValue(rect.offsetTop, '0px')
  );
  document.documentElement.style.setProperty(
    '--visual-viewport-height',
    getPixelValue(rect.height, '100dvh')
  );
  document.documentElement.style.setProperty(
    '--session-overlay-top-chrome-inset',
    `${overlayInset}px`
  );
  document.documentElement.style.setProperty(
    '--visual-viewport-bottom-inset',
    `${bottomInset}px`
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
 * Vue composable that tracks the visual viewport rectangle and updates CSS variables.
 * This is needed for iOS Safari, where the browser chrome (URL bar + tab bar) can
 * physically overlap sticky-positioned elements when expanded.
 *
 * Sets raw visual viewport CSS variables on document.documentElement. It also
 * writes a sanitized --session-overlay-top-chrome-inset for the session overlay
 * header; fixed shells should not consume raw visual viewport offsets directly.
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
