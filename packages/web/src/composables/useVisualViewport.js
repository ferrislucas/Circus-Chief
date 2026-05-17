import { onMounted, onUnmounted } from 'vue';

let rafId = null;
let settleRafId = null;
let settleTimerId = null;
let settleStartedAt = 0;
let settleLastRect = null;
let settleStableSamples = 0;

const SESSION_OVERLAY_TOP_CHROME_THRESHOLD = 64;
const KEYBOARD_HEIGHT_DELTA_THRESHOLD = 120;
const KEYBOARD_VIEWPORT_RATIO_THRESHOLD = 0.85;
const TABLET_MIN_LAYOUT_DIMENSION = 700;

function getPixelValue(value, fallback) {
  return Number.isFinite(value) ? `${value}px` : fallback;
}

function getVisualViewportRect() {
  const { offsetTop, height } = window.visualViewport;
  return { offsetTop, height };
}

function isValidOffsetTop(offsetTop) {
  return (
    Number.isFinite(offsetTop) &&
    offsetTop > 0 &&
    offsetTop <= SESSION_OVERLAY_TOP_CHROME_THRESHOLD
  );
}

function getDeviceType(userAgent, platform, maxTouchPoints) {
  const ua = String(userAgent);
  const devicePlatform = String(platform);
  const touchPoints = Number(maxTouchPoints) || 0;
  const isAndroid = /Android/i.test(ua);
  const isAndroidMobile = isAndroid && /Mobile/i.test(ua);
  const isIPhoneLike = /iPhone|iPod/i.test(`${ua} ${devicePlatform}`);
  const isIPad =
    /iPad/i.test(`${ua} ${devicePlatform}`) ||
    (devicePlatform === 'MacIntel' && touchPoints > 1);
  const isAndroidTablet = isAndroid && !/Mobile/i.test(ua);

  return {
    isPhone: isIPhoneLike || isAndroidMobile,
    isTablet: isIPad || isAndroidTablet,
  };
}

function hasKeyboardShapedViewport(layoutHeight, visualViewportHeight) {
  return (
    Number.isFinite(layoutHeight) &&
    layoutHeight > 0 &&
    Number.isFinite(visualViewportHeight) &&
    (layoutHeight - visualViewportHeight > KEYBOARD_HEIGHT_DELTA_THRESHOLD ||
      visualViewportHeight / layoutHeight < KEYBOARD_VIEWPORT_RATIO_THRESHOLD)
  );
}

function hasTabletSizedLayout(layoutWidth, layoutHeight) {
  return (
    Number.isFinite(layoutWidth) &&
    Number.isFinite(layoutHeight) &&
    Math.min(layoutWidth, layoutHeight) >= TABLET_MIN_LAYOUT_DIMENSION
  );
}

export function computeSessionOverlayTopChromeInset({
  offsetTop,
  visualViewportHeight,
  layoutWidth,
  layoutHeight,
  userAgent = '',
  platform = '',
  maxTouchPoints = 0,
}) {
  if (!isValidOffsetTop(offsetTop)) {
    return 0;
  }

  const deviceType = getDeviceType(userAgent, platform, maxTouchPoints);
  if (deviceType.isPhone) {
    return 0;
  }

  if (hasKeyboardShapedViewport(layoutHeight, visualViewportHeight)) {
    return 0;
  }

  if (deviceType.isTablet || hasTabletSizedLayout(layoutWidth, layoutHeight)) {
    return offsetTop;
  }

  return 0;
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
  const sessionOverlayTopChromeInset = computeSessionOverlayTopChromeInset({
    offsetTop: rect.offsetTop,
    visualViewportHeight: rect.height,
    layoutWidth: window.innerWidth,
    layoutHeight: window.innerHeight,
    userAgent: window.navigator?.userAgent,
    platform: window.navigator?.platform,
    maxTouchPoints: window.navigator?.maxTouchPoints,
  });
  document.documentElement.style.setProperty(
    '--session-overlay-top-chrome-inset',
    `${sessionOverlayTopChromeInset}px`
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

// ---------------------------------------------------------------------------
// Overlay viewport-drift correction
//
// On iPad Safari the visual viewport can shift relative to the layout viewport
// when the browser chrome (URL bar / tab bar) collapses or expands, during
// scroll-bounce, or after tab switches. `position: fixed` elements follow the
// *layout* viewport, so they drift off-screen even though JS APIs like
// `getBoundingClientRect` and `window.scrollY` still report 0.
//
// `checkOverlayViewportDrift` reads `visualViewport.offsetTop` and pins the
// overlay element to the visual viewport via inline styles when drift > threshold.
// ---------------------------------------------------------------------------
const DRIFT_THRESHOLD_PX = 2;

/**
 * Check for visual-viewport drift and correct the given element's position.
 *
 * Intended to be called periodically (setInterval) and/or on visualViewport
 * scroll/resize events while a fullscreen overlay is open.
 *
 * The correction only applies on tablets / large-screen devices when the
 * software keyboard is NOT open. On phones the browser-chrome drift issue
 * doesn't occur, and when the keyboard is open the viewport offset is
 * expected (not drift) — repositioning the overlay would fight the
 * keyboard and push the focused input out of view.
 *
 * @param {HTMLElement|null} element  The overlay backdrop element to pin.
 */
export function checkOverlayViewportDrift(element) {
  if (!element) return;

  // Force window scroll to 0 — page should never scroll while overlay is open.
  if (window.scrollY !== 0) {
    window.scrollTo(0, 0);
  }

  if (!window.visualViewport) {
    writeVisualViewportVariables();
    return;
  }

  const { offsetTop, height } = window.visualViewport;
  const layoutWidth = window.innerWidth;
  const layoutHeight = window.innerHeight;

  // Use the same guard logic as computeSessionOverlayTopChromeInset:
  // skip phones entirely, skip when the keyboard is open, and only
  // correct on tablets / large-screen devices.
  const deviceType = getDeviceType(
    window.navigator?.userAgent,
    window.navigator?.platform,
    window.navigator?.maxTouchPoints,
  );

  const shouldCorrect =
    !deviceType.isPhone &&
    !hasKeyboardShapedViewport(layoutHeight, height) &&
    (deviceType.isTablet || hasTabletSizedLayout(layoutWidth, layoutHeight)) &&
    offsetTop > DRIFT_THRESHOLD_PX;

  if (shouldCorrect) {
    // Drift detected — override CSS `inset: 0` with explicit position.
    // Inline styles beat scoped-CSS specificity, so this wins over `inset`.
    element.style.top = `${offsetTop}px`;
    element.style.bottom = 'auto';
    element.style.height = `${height}px`;
  } else {
    // No drift (or phone / keyboard open) — clear inline overrides so
    // the CSS `inset: 0` rule applies normally.
    element.style.top = '';
    element.style.bottom = '';
    element.style.height = '';
  }

  writeVisualViewportVariables();
}

/**
 * Clear any inline position overrides applied by `checkOverlayViewportDrift`.
 *
 * @param {HTMLElement|null} element  The overlay backdrop element.
 */
export function clearOverlayViewportDrift(element) {
  if (!element) return;
  element.style.top = '';
  element.style.bottom = '';
  element.style.height = '';
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
 * This is needed for iOS Safari, where the browser chrome (URL bar + tab bar) can
 * physically overlap sticky-positioned elements when expanded.
 *
 * Sets raw visual viewport CSS variables on document.documentElement, plus a
 * session-overlay-specific sanitized top inset that avoids treating stale phone
 * keyboard offsets as browser chrome.
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
