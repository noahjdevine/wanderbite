/**
 * Sanity checks for AES-256-GCM redemption code crypto.
 * Run: npm run test:crypto
 *
 * Uses a throwaway key in process.env only for this process (not your real .env.local).
 */
import { randomBytes } from 'crypto';

async function main() {
  const testKey = randomBytes(32).toString('base64');
  process.env.REDEMPTION_CODE_ENCRYPTION_KEY = testKey;

  const { encryptRedemptionCode, decryptRedemptionCode } = await import(
    '../src/lib/redemption-crypto'
  );

  const code = 'WB-ABC12';
  const { encrypted, iv } = encryptRedemptionCode(code);
  const roundTrip = decryptRedemptionCode(encrypted, iv);
  if (roundTrip !== code) {
    console.error('FAIL: round-trip mismatch');
    process.exit(1);
  }

  let wrongIvFailed = false;
  try {
    const badIv = randomBytes(12).toString('base64');
    decryptRedemptionCode(encrypted, badIv);
  } catch {
    wrongIvFailed = true;
  }
  if (!wrongIvFailed) {
    console.error('FAIL: wrong IV should fail decryption');
    process.exit(1);
  }

  let tamperFailed = false;
  try {
    const buf = Buffer.from(encrypted, 'base64');
    buf[0] ^= 0xff;
    decryptRedemptionCode(buf.toString('base64'), iv);
  } catch {
    tamperFailed = true;
  }
  if (!tamperFailed) {
    console.error('FAIL: tampered ciphertext should fail auth');
    process.exit(1);
  }

  let wrongKeyFailed = false;
  process.env.REDEMPTION_CODE_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  try {
    decryptRedemptionCode(encrypted, iv);
  } catch {
    wrongKeyFailed = true;
  }
  if (!wrongKeyFailed) {
    console.error('FAIL: wrong key should fail decryption');
    process.exit(1);
  }

  let badKeyLengthFailed = false;
  process.env.REDEMPTION_CODE_ENCRYPTION_KEY = Buffer.alloc(31).toString('base64');
  try {
    encryptRedemptionCode('x');
  } catch {
    badKeyLengthFailed = true;
  }
  if (!badKeyLengthFailed) {
    console.error('FAIL: 31-byte key should be rejected');
    process.exit(1);
  }

  console.log('redemption-crypto selftest: OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
