import { clampRemainingPercent, finiteNumber, percentage, requirePercent } from './allowanceNumbers.js';
import { describe, expect, it } from 'vitest';

describe('allowanceNumbers', () => {
  it.each([
    [-5, null],
    [0, 0],
    [100, 100],
    [140, null],
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, null],
    ['50', null],
    [null, null],
  ])('requires an in-range percentage, rejecting %p as %p', (value, expected) => {
    expect(requirePercent(value)).toBe(expected);
  });

  it.each([
    [-5, 0],
    [0, 0],
    [57.5, 57.5],
    [100, 100],
    [140, 100],
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, null],
    ['50', null],
    [null, null],
  ])('clamps a utilization-derived percentage %p into range as %p', (value, expected) => {
    expect(clampRemainingPercent(value)).toBe(expected);
  });

  it.each([
    [-5, -5],
    [0, 0],
    [100, 100],
    [140, 140],
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, null],
    ['50', null],
    [null, null],
  ])('accepts only finite numeric values: %p', (value, expected) => {
    expect(finiteNumber(value)).toBe(expected);
  });

  it.each([
    [-5, 100, 0],
    [0, 100, 0],
    [100, 100, 100],
    [140, 100, 100],
  ])('bounds %p of %p to %p percent', (remaining, limit, expected) => {
    expect(percentage(remaining, limit)).toBe(expected);
  });
});
