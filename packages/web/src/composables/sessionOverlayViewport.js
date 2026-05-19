const SESSION_OVERLAY_TOP_CHROME_THRESHOLD = 64;
const KEYBOARD_HEIGHT_DELTA_THRESHOLD = 120;
const KEYBOARD_VIEWPORT_RATIO_THRESHOLD = 0.85;
const TABLET_MIN_LAYOUT_DIMENSION = 700;
const DRIFT_THRESHOLD_PX = 2;

const TEXT_LIKE_INPUT_TYPES = new Set([
  '',
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
]);

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

export function isTextEditingElement(element) {
  if (!element || element.nodeType !== 1) {
    return false;
  }

  const editableElement = element.closest?.('[contenteditable]');
  if (editableElement) {
    const contentEditable = editableElement.getAttribute('contenteditable');
    return contentEditable === null || contentEditable.toLowerCase() !== 'false';
  }

  const tagName = element.tagName?.toLowerCase();
  if (tagName === 'textarea') {
    return true;
  }

  if (tagName !== 'input') {
    return false;
  }

  return TEXT_LIKE_INPUT_TYPES.has((element.getAttribute('type') || '').toLowerCase());
}

export function isActiveTextEditing() {
  if (typeof document === 'undefined') {
    return false;
  }
  return isTextEditingElement(document.activeElement);
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

export function checkOverlayViewportDrift(
  element,
  { writeVisualViewportVariables = () => null } = {}
) {
  if (!element) return;

  if (isActiveTextEditing()) {
    writeVisualViewportVariables();
    return;
  }

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
    element.style.top = `${offsetTop}px`;
    element.style.bottom = 'auto';
    element.style.height = `${height}px`;
  } else {
    clearOverlayViewportDrift(element);
  }

  writeVisualViewportVariables();
}

export function clearOverlayViewportDrift(element) {
  if (!element) return;
  element.style.top = '';
  element.style.bottom = '';
  element.style.height = '';
}

