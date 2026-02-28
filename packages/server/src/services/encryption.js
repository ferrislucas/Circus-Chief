import crypto from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits for AES-256
const IV_LENGTH = 12; // 96 bits is recommended for GCM
const SEPARATOR = ':';
const PARTS_COUNT = 3;

// Allow tests to override the key directory so they never touch the real ~/.claudetools/secret.key
let _keyDirOverride = null;

/**
 * Get or generate the encryption key.
 * Uses ~/.claudetools/secret.key file (auto-generated on first run)
 * @returns {Buffer} - 32-byte encryption key
 */
function getEncryptionKey() {
  const keyDir = _keyDirOverride || join(homedir(), '.claudetools');
  const keyPath = join(keyDir, 'secret.key');

  if (existsSync(keyPath)) {
    const keyHex = readFileSync(keyPath, 'utf-8').trim();
    // Validate the key is a 64-char hex string (32 bytes)
    if (/^[0-9a-fA-F]{64}$/.test(keyHex)) {
      return Buffer.from(keyHex, 'hex');
    }
    // Key is invalid, log warning and regenerate
    console.warn(`[encryption] Invalid key file at ${keyPath}, regenerating...`);
  }

  // Generate a new key
  const key = crypto.randomBytes(KEY_LENGTH);
  mkdirSync(keyDir, { recursive: true });
  writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 });
  return key;
}

// Lazily initialize the key so it's only loaded when first needed
let _key = null;

function getKey() {
  if (!_key) {
    _key = getEncryptionKey();
  }
  return _key;
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a string in the format: <iv_hex>:<authTag_hex>:<ciphertext_hex>
 * Returns the original value unchanged if it is null, undefined, or empty.
 * @param {string|null|undefined} plaintext
 * @returns {string|null|undefined}
 */
export function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return plaintext;

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(SEPARATOR);
}

/**
 * Decrypt a ciphertext string that was encrypted with `encrypt()`.
 * Gracefully handles plaintext values (legacy data not yet encrypted) by returning them as-is.
 * Returns the original value unchanged if it is null, undefined, or empty.
 * @param {string|null|undefined} ciphertext
 * @returns {string|null|undefined}
 */
export function decrypt(ciphertext) {
  if (ciphertext == null || ciphertext === '') return ciphertext;

  // If the value doesn't look like our format, treat it as plaintext (legacy)
  const parts = ciphertext.split(SEPARATOR);
  if (parts.length !== PARTS_COUNT) return ciphertext;

  // Validate hex format and expected lengths
  // IV should be 24 hex chars (12 bytes), auth tag should be 32 hex chars (16 bytes)
  const ivHex = parts[0];
  const authTagHex = parts[1];

  if (!/^[0-9a-fA-F]{24}$/.test(ivHex) || !/^[0-9a-fA-F]{32}$/.test(authTagHex)) {
    return ciphertext; // Legacy plaintext
  }

  try {
    const key = getKey();
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    return decipher.update(encrypted) + decipher.final('utf-8');
  } catch {
    // Decryption failed — value is likely legacy plaintext, return as-is
    console.warn('[encryption] Failed to decrypt value — returning as-is (possible key mismatch or legacy plaintext)');
    return ciphertext;
  }
}

/**
 * Reset the cached encryption key.
 * Only intended for test isolation.
 * @internal
 */
export function _resetKeyForTesting() {
  _key = null;
}

/**
 * Override the key directory so tests use an isolated temp path
 * instead of the real ~/.claudetools/ directory.
 * Pass null to restore the default behaviour.
 * Only intended for test isolation.
 * @param {string|null} dir
 * @internal
 */
export function _setKeyDirForTesting(dir) {
  _keyDirOverride = dir;
  _key = null; // also clear the cached key so the new path takes effect
}
