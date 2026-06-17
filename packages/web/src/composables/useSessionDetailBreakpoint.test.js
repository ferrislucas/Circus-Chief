import { describe, expect, it } from 'vitest';
import {
  isSessionDetailDesktop,
  SESSION_DETAIL_MOBILE_MAX_WIDTH,
} from './useSessionDetailBreakpoint.js';

describe('useSessionDetailBreakpoint', () => {
  it('uses 640px as the mobile maximum width', () => {
    expect(SESSION_DETAIL_MOBILE_MAX_WIDTH).toBe(640);
  });

  it('treats 640px as mobile', () => {
    expect(isSessionDetailDesktop(640)).toBe(false);
  });

  it('treats 641px as desktop', () => {
    expect(isSessionDetailDesktop(641)).toBe(true);
  });

  it('handles non-boundary widths', () => {
    expect(isSessionDetailDesktop(639)).toBe(false);
    expect(isSessionDetailDesktop(1024)).toBe(true);
  });
});
