/**
 * Validate that a value is a non-empty string
 * @param {*} value - The value to validate
 * @returns {boolean} True if value is a non-empty string
 */
export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate that a value is a valid email address
 * @param {*} value - The value to validate
 * @returns {boolean} True if value is a valid email
 */
export function isValidEmail(value) {
  if (!isNonEmptyString(value)) return false;
  // Basic email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(value);
}

/**
 * Validate that a value is a valid URL
 * @param {*} value - The value to validate
 * @returns {boolean} True if value is a valid URL
 */
export function isValidUrl(value) {
  if (!isNonEmptyString(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate that a value is a positive number
 * @param {*} value - The value to validate
 * @returns {boolean} True if value is a positive number
 */
export function isPositiveNumber(value) {
  return typeof value === 'number' && !isNaN(value) && value > 0;
}

/**
 * Validate that a value is a non-negative number
 * @param {*} value - The value to validate
 * @returns {boolean} True if value is non-negative
 */
export function isNonNegativeNumber(value) {
  return typeof value === 'number' && !isNaN(value) && value >= 0;
}

/**
 * Validate that a value is a valid integer
 * @param {*} value - The value to validate
 * @returns {boolean} True if value is a valid integer
 */
export function isValidInteger(value) {
  return Number.isInteger(value);
}

/**
 * Validate that a value is an array
 * @param {*} value - The value to validate
 * @returns {boolean} True if value is an array
 */
export function isArray(value) {
  return Array.isArray(value);
}

/**
 * Validate that a value is a non-empty array
 * @param {*} value - The value to validate
 * @returns {boolean} True if value is a non-empty array
 */
export function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Validate that a value is an object (not null, not array)
 * @param {*} value - The value to validate
 * @returns {boolean} True if value is an object
 */
export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate that a value is a boolean
 * @param {*} value - The value to validate
 * @returns {boolean} True if value is a boolean
 */
export function isBoolean(value) {
  return typeof value === 'boolean';
}

/**
 * Validate that a string matches a pattern
 * @param {string} value - The string to validate
 * @param {RegExp} pattern - The regex pattern to match
 * @returns {boolean} True if the value matches the pattern
 */
export function matchesPattern(value, pattern) {
  if (!isNonEmptyString(value) || !(pattern instanceof RegExp)) return false;
  return pattern.test(value);
}

/**
 * Validate that a string has minimum length
 * @param {string} value - The string to validate
 * @param {number} minLength - The minimum required length
 * @returns {boolean} True if value length is >= minLength
 */
export function minLength(value, minLength) {
  if (!isNonEmptyString(value) || !isNonNegativeNumber(minLength)) return false;
  return value.length >= minLength;
}

/**
 * Validate that a string has maximum length
 * @param {string} value - The string to validate
 * @param {number} maxLength - The maximum allowed length
 * @returns {boolean} True if value length is <= maxLength
 */
export function maxLength(value, maxLength) {
  if (typeof value !== 'string' || !isNonNegativeNumber(maxLength)) return false;
  return value.length <= maxLength;
}
