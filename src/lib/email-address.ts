const MAILBOX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One mailbox, trimmed and lowercased. Display names and lists are rejected. */
export function normalizeMailbox(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!MAILBOX.test(trimmed)) return null;
  if (trimmed.includes(',') || trimmed.includes(';') || trimmed.includes(' ')) return null;
  return trimmed;
}

/** Require exactly one mailbox from a Resend `to` field. */
export function oneMailbox(value: unknown): string | null {
  if (typeof value === 'string') return normalizeMailbox(value);
  if (!Array.isArray(value) || value.length !== 1 || typeof value[0] !== 'string') {
    return null;
  }
  return normalizeMailbox(value[0]);
}
