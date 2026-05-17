import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 10;

export async function hashPartnerPin(pin: string): Promise<string> {
  return bcrypt.hash(pin.trim(), BCRYPT_ROUNDS);
}

export async function verifyPartnerPin(
  pin: string,
  pinHash: string | null | undefined
): Promise<boolean> {
  if (!pinHash?.trim()) return false;
  return bcrypt.compare(pin.trim(), pinHash);
}
