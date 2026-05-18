const KEYBOARD_HEIGHT_DELTA_THRESHOLD = 120;
const KEYBOARD_VIEWPORT_RATIO_THRESHOLD = 0.85;
const KEYBOARD_ACCESSORY_ALLOWANCE_PX = 64;
const KEYBOARD_BOTTOM_INSET_MAX_PX = 420;
const MIN_USABLE_OVERLAY_HEIGHT_PX = 320;
const MIN_USABLE_SHORT_OVERLAY_HEIGHT_PX = 240;
const MIN_VISIBLE_COMPOSER_AREA_PX = 160;

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

function hasValidViewportGeometry({
  layoutWidth,
  layoutHeight,
  visualViewportHeight,
  visualViewportOffsetTop,
}) {
  return (
    Number.isFinite(layoutWidth) &&
    Number.isFinite(layoutHeight) &&
    Number.isFinite(visualViewportHeight) &&
    Number.isFinite(visualViewportOffsetTop) &&
    layoutWidth > 0 &&
    layoutHeight > 0 &&
    visualViewportHeight > 0
  );
}

function isTouchTablet({ userAgent, platform, maxTouchPoints }) {
  const deviceType = getDeviceType(userAgent, platform, maxTouchPoints);
  return (
    !deviceType.isPhone &&
    deviceType.isTablet &&
    Number(maxTouchPoints) > 0
  );
}

function getKeyboardOverlap(layoutHeight, visualViewportHeight, visualViewportOffsetTop) {
  const keyboardOverlap =
    layoutHeight - (visualViewportHeight + visualViewportOffsetTop);

  return Number.isFinite(keyboardOverlap) ? keyboardOverlap : 0;
}

function getMaxKeyboardInset({
  layoutHeight,
  visualViewportHeight,
  absoluteMax,
  minUsableOverlayHeight,
  minUsableShortOverlayHeight,
  minVisibleComposerArea,
}) {
  const minOverlayHeight =
    layoutHeight <= 500 ? minUsableShortOverlayHeight : minUsableOverlayHeight;
  const maxByOverlayHeight = layoutHeight - minOverlayHeight;
  const maxByComposerArea = visualViewportHeight - minVisibleComposerArea;

  return Math.max(
    0,
    Math.min(absoluteMax, maxByOverlayHeight, maxByComposerArea)
  );
}

export function computeSessionOverlayKeyboardBottomInset({
  isOverlayPromptFocused,
  layoutWidth,
  layoutHeight,
  visualViewportHeight,
  visualViewportOffsetTop = 0,
  userAgent = '',
  platform = '',
  maxTouchPoints = 0,
  accessoryAllowance = KEYBOARD_ACCESSORY_ALLOWANCE_PX,
  absoluteMax = KEYBOARD_BOTTOM_INSET_MAX_PX,
  minUsableOverlayHeight = MIN_USABLE_OVERLAY_HEIGHT_PX,
  minUsableShortOverlayHeight = MIN_USABLE_SHORT_OVERLAY_HEIGHT_PX,
  minVisibleComposerArea = MIN_VISIBLE_COMPOSER_AREA_PX,
}) {
  if (!isOverlayPromptFocused) {
    return 0;
  }

  if (
    !hasValidViewportGeometry({
      layoutWidth,
      layoutHeight,
      visualViewportHeight,
      visualViewportOffsetTop,
    }) ||
    !isTouchTablet({ userAgent, platform, maxTouchPoints }) ||
    !hasKeyboardShapedViewport(layoutHeight, visualViewportHeight)
  ) {
    return 0;
  }

  const keyboardOverlap = getKeyboardOverlap(
    layoutHeight,
    visualViewportHeight,
    visualViewportOffsetTop
  );
  if (keyboardOverlap <= 0) {
    return 0;
  }

  const maxInset = getMaxKeyboardInset({
    layoutHeight,
    visualViewportHeight,
    absoluteMax,
    minUsableOverlayHeight,
    minUsableShortOverlayHeight,
    minVisibleComposerArea,
  });

  return Math.max(0, Math.min(keyboardOverlap + accessoryAllowance, maxInset));
}
