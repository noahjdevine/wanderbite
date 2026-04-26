import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_B64_ENV = 'REDEMPTION_CODE_ENCRYPTION_KEY';

function getKeyBytes(): Buffer {
  const b64 = process.env[KEY_B64_ENV];
  if (!b64?.trim()) {
    throw new Error(`${KEY_B64_ENV} is not set`);
  }
  const key = Buffer.from(b64.trim(), 'base64');
  if (key.length !== 32) {
    throw new Error(
      `${KEY_B64_ENV} must be base64 that decodes to exactly 32 bytes (AES-256). Generate with: openssl rand -base64 32`
    );
  }
  return key;
}

/**
 * Encrypts a plaintext WB- code for at-rest storage. Uses AES-256-GCM with a random 12-byte IV.
 * Returns base64 strings suitable for `text` columns.
 */
export function encryptRedemptionCode(plaintext: string): { encrypted: string; iv: string } {
  const key = getKeyBytes();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([enc, authTag]);
  return {
    encrypted: combined.toString('base64'),
    iv: iv.toString('base64'),
  };
}

/**
 * Decrypts ciphertext produced by `encryptRedemptionCode`. Throws if the auth tag does not verify.
 */
export function decryptRedemptionCode(encrypted: string, iv: string): string {
  const key = getKeyBytes();
  const ivBuf = Buffer.from(iv, 'base64');
  if (ivBuf.length !== IV_LENGTH) {
    throw new Error('Invalid IV length');
  }
  const combined = Buffer.from(encrypted, 'base64');
  if (combined.length < AUTH_TAG_LENGTH) {
    throw new Error('Invalid ciphertext');
  }
  const ciphertext = combined.subarray(0, combined.length - AUTH_TAG_LENGTH);
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGO, key, ivBuf, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}
