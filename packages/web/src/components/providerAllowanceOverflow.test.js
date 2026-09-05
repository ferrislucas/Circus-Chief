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
});
