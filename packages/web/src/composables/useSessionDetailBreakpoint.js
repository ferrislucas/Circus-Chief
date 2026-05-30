export const SESSION_DETAIL_MOBILE_MAX_WIDTH = 640;

export function isSessionDetailDesktop(width = window.innerWidth) {
  return width > SESSION_DETAIL_MOBILE_MAX_WIDTH;
}
