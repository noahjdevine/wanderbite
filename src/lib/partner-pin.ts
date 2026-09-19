import bcrypt from 'bcryptjs';
import { parsePartnerPin } from '@/lib/partner-pin-format';

const BCRYPT_ROUNDS = 10;

export async function hashPartnerPin(pin: string): Promise<string> {
  const parsed = parsePartnerPin(pin);
  if (!parsed) {
    throw new Error('invalid_partner_pin');
  }
  return bcrypt.hash(parsed, BCRYPT_ROUNDS);
}

export async function verifyPartnerPin(
  pin: string,
  pinHash: string | null | undefined,
): Promise<boolean> {
  if (!pinHash?.trim()) return false;
  const parsed = parsePartnerPin(pin);
  if (!parsed) return false;
  return bcrypt.compare(parsed, pinHash);
}
