import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptRedemptionCode, decryptRedemptionCode } from './redemption-crypto';
import { hashRedemptionToken } from './redemption-token-hash';

describe('redemption-crypto', () => {
  beforeAll(() => {
    // 32 bytes base64 = AES-256 key
    process.env.REDEMPTION_CODE_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });

  it('round-trips a plaintext code', () => {
    const code = 'WB-AB123';
    const { encrypted, iv } = encryptRedemptionCode(code);
    expect(encrypted).toBeTypeOf('string');
    expect(iv).toBeTypeOf('string');
    const decrypted = decryptRedemptionCode(encrypted, iv);
    expect(decrypted).toBe(code);
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const code = 'WB-XYZAB';
    const a = encryptRedemptionCode(code);
    const b = encryptRedemptionCode(code);
    expect(a.encrypted).not.toBe(b.encrypted);
    expect(a.iv).not.toBe(b.iv);
    // Both still decrypt to the same value.
    expect(decryptRedemptionCode(a.encrypted, a.iv)).toBe(code);
    expect(decryptRedemptionCode(b.encrypted, b.iv)).toBe(code);
  });

  it('decryption throws when ciphertext is tampered', () => {
    const { encrypted, iv } = encryptRedemptionCode('WB-CDEFG');
    // Flip a byte in the encrypted payload.
    const buf = Buffer.from(encrypted, 'base64');
    buf[0] = buf[0] ^ 0xff;
    const tampered = buf.toString('base64');
    expect(() => decryptRedemptionCode(tampered, iv)).toThrow();
  });

  it('decryption throws when IV is wrong length', () => {
    const { encrypted } = encryptRedemptionCode('WB-HIJKL');
    expect(() => decryptRedemptionCode(encrypted, 'short')).toThrow();
  });

  it('throws when REDEMPTION_CODE_ENCRYPTION_KEY is not 32 bytes', () => {
    const original = process.env.REDEMPTION_CODE_ENCRYPTION_KEY;
    process.env.REDEMPTION_CODE_ENCRYPTION_KEY = Buffer.from('too-short').toString('base64');
    expect(() => encryptRedemptionCode('WB-MNOPQ')).toThrow(
      /must be base64 that decodes to exactly 32 bytes/
    );
    process.env.REDEMPTION_CODE_ENCRYPTION_KEY = original;
  });

  it('throws when REDEMPTION_CODE_ENCRYPTION_KEY is unset', () => {
    const original = process.env.REDEMPTION_CODE_ENCRYPTION_KEY;
    delete process.env.REDEMPTION_CODE_ENCRYPTION_KEY;
    expect(() => encryptRedemptionCode('WB-RSTUV')).toThrow(/is not set/);
    process.env.REDEMPTION_CODE_ENCRYPTION_KEY = original;
  });
});

describe('hashRedemptionToken', () => {
  it('is deterministic', () => {
    expect(hashRedemptionToken('WB-AB123')).toBe(hashRedemptionToken('WB-AB123'));
  });

  it('produces different hashes for different codes', () => {
    expect(hashRedemptionToken('WB-AB123')).not.toBe(hashRedemptionToken('WB-XYZAB'));
  });

  it('returns a 64-character hex string (sha256)', () => {
    const hash = hashRedemptionToken('WB-AB123');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
