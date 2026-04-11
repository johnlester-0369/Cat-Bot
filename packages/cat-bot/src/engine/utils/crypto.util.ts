/**
 * Credential Encryption Utility — AES-256-GCM
 *
 * Industry-standard authenticated encryption (AEAD) for platform credentials at rest.
 * AES-256-GCM provides three guarantees in a single pass:
 *   - Confidentiality   : AES-256 (256-bit key, 2^256 brute-force search space)
 *   - Integrity         : GCM auth tag detects any bit-flip or byte substitution
 *   - Authenticity      : same auth tag prevents forged ciphertexts reaching decrypt()
 *
 * Key material: 32 bytes (256 bits), sourced from ENCRYPTION_KEY env var as 64 hex chars.
 * IV:           12 bytes (96 bits), randomly generated per encrypt() call — NIST SP 800-38D
 *               recommendation for GCM; reusing an IV with the same key is cryptographically fatal.
 * Auth tag:     16 bytes (128 bits) — maximum GCM tag length, hardest to forge.
 *
 * Wire format: enc:v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>
 *
 * The "enc:v1:" prefix serves two purposes:
 *   1. Graceful migration — decrypt() returns legacy plaintext values unchanged when
 *      the prefix is absent, so existing rows continue working after deployment without
 *      a forced DB rewrite migration.
 *   2. Versioning — a future key rotation can introduce enc:v2: with a different algorithm
 *      or key derivation scheme while decrypt() dispatches on the version token.
 *
 * ENCRYPTION_KEY must be kept secret and rotated if compromised. Rotate by:
 *   1. Generate new key with: openssl rand -hex 32
 *   2. Write a one-time migration script that reads enc:v1: values with the OLD key and
 *      re-encrypts with the new key, writing enc:v2: (or fresh enc:v1: with new key).
 *   3. Deploy with the new ENCRYPTION_KEY after the migration completes.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// ── Constants ─────────────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV — NIST recommended for GCM
const KEY_LENGTH = 32; // 256-bit key
const ENCRYPTED_PREFIX = 'enc:v1:';

// ── Key derivation ────────────────────────────────────────────────────────────

/**
 * Derives the 32-byte AES key from the ENCRYPTION_KEY environment variable.
 * Fails fast on misconfiguration so the process crashes at boot rather than
 * silently storing plaintext credentials in the database.
 */
function getKey(): Buffer {
  const keyHex = process.env['ENCRYPTION_KEY'];
  if (!keyHex) {
    throw new Error(
      '[crypto] ENCRYPTION_KEY environment variable is required for credential encryption. ' +
        'Generate a secure key with: openssl rand -hex 32',
    );
  }
  // Reject keys that are clearly wrong length before attempting the Buffer decode
  if (keyHex.length !== KEY_LENGTH * 2) {
    throw new Error(
      `[crypto] ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes / 256 bits). ` +
        `Got ${keyHex.length} characters.`,
    );
  }
  const key = Buffer.from(keyHex, 'hex');
  // Double-check after decode — invalid hex chars silently produce shorter buffers
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      '[crypto] ENCRYPTION_KEY contains non-hex characters. ' +
        'Use only 0-9 and a-f characters.',
    );
  }
  return key;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Encrypts a plaintext string with AES-256-GCM.
 *
 * A fresh random 12-byte IV is generated on every call — this is mandatory for GCM
 * security. Reusing an IV with the same key completely breaks confidentiality and
 * allows an attacker to XOR two ciphertexts to recover both plaintexts.
 *
 * @returns Encoded string: enc:v1:<iv>:<authTag>:<ciphertext> (all segments base64)
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return (
    ENCRYPTED_PREFIX +
    iv.toString('base64') +
    ':' +
    authTag.toString('base64') +
    ':' +
    ciphertext.toString('base64')
  );
}

/**
 * Decrypts a value previously encrypted by encrypt().
 *
 * Graceful migration path: values that do NOT carry the enc:v1: prefix are assumed
 * to be legacy plaintext stored before encryption was deployed. They are returned
 * unchanged so existing DB rows work immediately after deployment without a forced
 * rewrite migration.
 *
 * @throws If the GCM auth tag verification fails — this indicates tampered or
 *         corrupted ciphertext and must never be silently swallowed by callers.
 */
export function decrypt(value: string): string {
  // Legacy plaintext — return as-is for backward-compatible migration
  if (!value.startsWith(ENCRYPTED_PREFIX)) return value;

  const key = getKey();
  const rest = value.slice(ENCRYPTED_PREFIX.length);
  const parts = rest.split(':');

  // Exactly 3 colon-delimited segments: iv, authTag, ciphertext
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error(
      '[crypto] Malformed encrypted credential value. ' +
        'Expected format: enc:v1:<iv>:<authTag>:<ciphertext>',
    );
  }

  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const ciphertext = Buffer.from(parts[2], 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  // setAuthTag must be called before final() — GCM verification happens at final()
  decipher.setAuthTag(authTag);

  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8');
}

/**
 * Returns true when a stored value has already been encrypted by this module.
 * Guards write paths against double-encrypting a credential that was read from
 * the DB and passed through the update flow unchanged.
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}
