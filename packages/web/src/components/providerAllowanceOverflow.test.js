import { describe, expect, it } from 'vitest';
import { selectVisibleItems } from './providerAllowanceOverflow.js';

describe('selectVisibleItems', () => {
  it('reserves overflow control space before selecting complete items', () => {
    expect(selectVisibleItems([70, 70, 70, 70], 190, 30)).toBe(2);
  });

  it('returns every item when they fit without an overflow control', () => {
    expect(selectVisibleItems([70, 70, 70, 70], 280, 30)).toBe(4);
  });

  it('never selects a partial item at a width boundary', () => {
    expect(selectVisibleItems([70, 70, 70], 170, 30)).toBe(2);
  });

  it('accounts for flex gaps at exact-fit and one-pixel boundaries', () => {
    const itemWidths = [70, 70, 70];
    const overflowWidth = 30;
    const gap = 10;

    // Two items and the overflow button need two gaps: 70 + 10 + 70 + 10 + 30.
    expect(selectVisibleItems(itemWidths, 190, overflowWidth, gap)).toBe(2);
    expect(selectVisibleItems(itemWidths, 189, overflowWidth, gap)).toBe(1);
    expect(selectVisibleItems(itemWidths, 191, overflowWidth, gap)).toBe(2);
  });
});
