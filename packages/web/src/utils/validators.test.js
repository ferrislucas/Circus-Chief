import { describe, it, expect } from 'vitest';
import {
  isNonEmptyString,
  isValidEmail,
  isValidUrl,
  isPositiveNumber,
  isNonNegativeNumber,
  isValidInteger,
  isArray,
  isNonEmptyArray,
  isObject,
  isBoolean,
  matchesPattern,
  minLength,
  maxLength,
} from './validators.js';

describe('validators', () => {
  describe('isNonEmptyString', () => {
    it('returns true for non-empty strings', () => {
      expect(isNonEmptyString('hello')).toBe(true);
      expect(isNonEmptyString('a')).toBe(true);
      expect(isNonEmptyString('with spaces')).toBe(true);
    });

    it('returns false for empty strings', () => {
      expect(isNonEmptyString('')).toBe(false);
      expect(isNonEmptyString('   ')).toBe(false);
      expect(isNonEmptyString('\t')).toBe(false);
    });

    it('returns false for non-string values', () => {
      expect(isNonEmptyString(null)).toBe(false);
      expect(isNonEmptyString(undefined)).toBe(false);
      expect(isNonEmptyString(123)).toBe(false);
      expect(isNonEmptyString(true)).toBe(false);
      expect(isNonEmptyString([])).toBe(false);
      expect(isNonEmptyString({})).toBe(false);
    });
  });

  describe('isValidEmail', () => {
    it('returns true for valid email addresses', () => {
      expect(isValidEmail('user@example.com')).toBe(true);
      expect(isValidEmail('test.email@domain.co.uk')).toBe(true);
      expect(isValidEmail('user+tag@example.com')).toBe(true);
    });

    it('returns false for invalid email addresses', () => {
      expect(isValidEmail('notanemail')).toBe(false);
      expect(isValidEmail('missing@domain')).toBe(false);
      expect(isValidEmail('@example.com')).toBe(false);
      expect(isValidEmail('user@')).toBe(false);
      expect(isValidEmail('user @example.com')).toBe(false);
    });

    it('returns false for non-string values', () => {
      expect(isValidEmail(null)).toBe(false);
      expect(isValidEmail(undefined)).toBe(false);
      expect(isValidEmail(123)).toBe(false);
      expect(isValidEmail('')).toBe(false);
      expect(isValidEmail('   ')).toBe(false);
    });
  });

  describe('isValidUrl', () => {
    it('returns true for valid URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('http://example.com')).toBe(true);
      expect(isValidUrl('https://example.com/path')).toBe(true);
      expect(isValidUrl('https://example.com:8080')).toBe(true);
      expect(isValidUrl('ftp://files.example.com')).toBe(true);
    });

    it('returns false for invalid URLs', () => {
      expect(isValidUrl('not a url')).toBe(false);
      expect(isValidUrl('example.com')).toBe(false);
      expect(isValidUrl('/path/only')).toBe(false);
      expect(isValidUrl('')).toBe(false);
      expect(isValidUrl('   ')).toBe(false);
    });

    it('returns false for non-string values', () => {
      expect(isValidUrl(null)).toBe(false);
      expect(isValidUrl(undefined)).toBe(false);
      expect(isValidUrl(123)).toBe(false);
    });
  });

  describe('isPositiveNumber', () => {
    it('returns true for positive numbers', () => {
      expect(isPositiveNumber(1)).toBe(true);
      expect(isPositiveNumber(0.5)).toBe(true);
      expect(isPositiveNumber(999999)).toBe(true);
    });

    it('returns false for zero and negative numbers', () => {
      expect(isPositiveNumber(0)).toBe(false);
      expect(isPositiveNumber(-1)).toBe(false);
      expect(isPositiveNumber(-0.5)).toBe(false);
    });

    it('returns false for non-number values', () => {
      expect(isPositiveNumber(null)).toBe(false);
      expect(isPositiveNumber(undefined)).toBe(false);
      expect(isPositiveNumber('5')).toBe(false);
      expect(isPositiveNumber(NaN)).toBe(false);
      expect(isPositiveNumber(true)).toBe(false);
    });
  });

  describe('isNonNegativeNumber', () => {
    it('returns true for positive numbers and zero', () => {
      expect(isNonNegativeNumber(0)).toBe(true);
      expect(isNonNegativeNumber(1)).toBe(true);
      expect(isNonNegativeNumber(0.5)).toBe(true);
      expect(isNonNegativeNumber(999999)).toBe(true);
    });

    it('returns false for negative numbers', () => {
      expect(isNonNegativeNumber(-1)).toBe(false);
      expect(isNonNegativeNumber(-0.5)).toBe(false);
    });

    it('returns false for non-number values', () => {
      expect(isNonNegativeNumber(null)).toBe(false);
      expect(isNonNegativeNumber(undefined)).toBe(false);
      expect(isNonNegativeNumber('0')).toBe(false);
      expect(isNonNegativeNumber(NaN)).toBe(false);
    });
  });

  describe('isValidInteger', () => {
    it('returns true for valid integers', () => {
      expect(isValidInteger(0)).toBe(true);
      expect(isValidInteger(1)).toBe(true);
      expect(isValidInteger(-1)).toBe(true);
      expect(isValidInteger(999999)).toBe(true);
    });

    it('returns false for decimal numbers', () => {
      expect(isValidInteger(1.5)).toBe(false);
      expect(isValidInteger(0.1)).toBe(false);
      expect(isValidInteger(-1.5)).toBe(false);
    });

    it('returns false for non-number values', () => {
      expect(isValidInteger(null)).toBe(false);
      expect(isValidInteger(undefined)).toBe(false);
      expect(isValidInteger('5')).toBe(false);
      expect(isValidInteger(NaN)).toBe(false);
      expect(isValidInteger(Infinity)).toBe(false);
    });
  });

  describe('isArray', () => {
    it('returns true for arrays', () => {
      expect(isArray([])).toBe(true);
      expect(isArray([1, 2, 3])).toBe(true);
      expect(isArray([null])).toBe(true);
      expect(isArray(new Array())).toBe(true);
    });

    it('returns false for non-array values', () => {
      expect(isArray(null)).toBe(false);
      expect(isArray(undefined)).toBe(false);
      expect(isArray({})).toBe(false);
      expect(isArray('array')).toBe(false);
      expect(isArray(123)).toBe(false);
      expect(isArray(true)).toBe(false);
    });
  });

  describe('isNonEmptyArray', () => {
    it('returns true for non-empty arrays', () => {
      expect(isNonEmptyArray([1])).toBe(true);
      expect(isNonEmptyArray([1, 2, 3])).toBe(true);
      expect(isNonEmptyArray([null])).toBe(true);
      expect(isNonEmptyArray([''])).toBe(true);
    });

    it('returns false for empty arrays', () => {
      expect(isNonEmptyArray([])).toBe(false);
    });

    it('returns false for non-array values', () => {
      expect(isNonEmptyArray(null)).toBe(false);
      expect(isNonEmptyArray(undefined)).toBe(false);
      expect(isNonEmptyArray({})).toBe(false);
      expect(isNonEmptyArray('array')).toBe(false);
      expect(isNonEmptyArray(123)).toBe(false);
    });
  });

  describe('isObject', () => {
    it('returns true for objects', () => {
      expect(isObject({})).toBe(true);
      expect(isObject({ key: 'value' })).toBe(true);
      expect(isObject(new Object())).toBe(true);
    });

    it('returns false for arrays', () => {
      expect(isObject([])).toBe(false);
      expect(isObject([1, 2, 3])).toBe(false);
    });

    it('returns false for null and non-object values', () => {
      expect(isObject(null)).toBe(false);
      expect(isObject(undefined)).toBe(false);
      expect(isObject('string')).toBe(false);
      expect(isObject(123)).toBe(false);
      expect(isObject(true)).toBe(false);
    });
  });

  describe('isBoolean', () => {
    it('returns true for boolean values', () => {
      expect(isBoolean(true)).toBe(true);
      expect(isBoolean(false)).toBe(true);
    });

    it('returns false for non-boolean values', () => {
      expect(isBoolean(1)).toBe(false);
      expect(isBoolean(0)).toBe(false);
      expect(isBoolean('true')).toBe(false);
      expect(isBoolean(null)).toBe(false);
      expect(isBoolean(undefined)).toBe(false);
    });
  });

  describe('matchesPattern', () => {
    it('returns true for matching patterns', () => {
      expect(matchesPattern('hello', /hello/)).toBe(true);
      expect(matchesPattern('test123', /\d+/)).toBe(true);
      expect(matchesPattern('test@example.com', /@/)).toBe(true);
    });

    it('returns false for non-matching patterns', () => {
      expect(matchesPattern('hello', /world/)).toBe(false);
      expect(matchesPattern('test', /\d+/)).toBe(false);
      expect(matchesPattern('example.com', /@/)).toBe(false);
    });

    it('returns false for invalid inputs', () => {
      expect(matchesPattern('', /test/)).toBe(false);
      expect(matchesPattern('   ', /test/)).toBe(false);
      expect(matchesPattern('test', null)).toBe(false);
      expect(matchesPattern('test', 'not a regex')).toBe(false);
      expect(matchesPattern(123, /\d+/)).toBe(false);
      expect(matchesPattern(null, /test/)).toBe(false);
    });
  });

  describe('minLength', () => {
    it('returns true when string length is >= minLength', () => {
      expect(minLength('hello', 5)).toBe(true);
      expect(minLength('hello', 4)).toBe(true);
      expect(minLength('hello', 0)).toBe(true);
      expect(minLength('a', 1)).toBe(true);
    });

    it('returns false when string length is < minLength', () => {
      expect(minLength('hi', 3)).toBe(false);
      expect(minLength('hello', 6)).toBe(false);
      expect(minLength('', 1)).toBe(false);
    });

    it('returns false for invalid inputs', () => {
      expect(minLength('test', -1)).toBe(false);
      expect(minLength('', 0)).toBe(false);
      expect(minLength('   ', 0)).toBe(false);
      expect(minLength(123, 1)).toBe(false);
      expect(minLength(null, 1)).toBe(false);
      expect(minLength('test', null)).toBe(false);
    });
  });

  describe('maxLength', () => {
    it('returns true when string length is <= maxLength', () => {
      expect(maxLength('hello', 5)).toBe(true);
      expect(maxLength('hello', 6)).toBe(true);
      expect(maxLength('', 0)).toBe(true);
      expect(maxLength('', 10)).toBe(true);
      expect(maxLength('a', 1)).toBe(true);
    });

    it('returns false when string length is > maxLength', () => {
      expect(maxLength('hello', 4)).toBe(false);
      expect(maxLength('hello', 3)).toBe(false);
      expect(maxLength('hi', 1)).toBe(false);
    });

    it('returns false for invalid inputs', () => {
      expect(maxLength('test', -1)).toBe(false);
      expect(maxLength(123, 5)).toBe(false);
      expect(maxLength(null, 5)).toBe(false);
      expect(maxLength('test', null)).toBe(false);
    });
  });
});
