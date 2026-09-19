import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { trustedClientIpFromHeaders } from '@/lib/client-ip';
import { hashClientIp, hashResetEmail } from '@/lib/ai-ip-hash';

function header(value: string | null): Pick<Headers, 'get'> {
  return {
    get: (name: string) => (name.toLowerCase() === 'x-forwarded-for' ? value : null),
  };
}

describe('trustedClientIpFromHeaders', () => {
  it('uses the first x-forwarded-for hop and ignores later spoofed hops', () => {
    expect(
      trustedClientIpFromHeaders(header('203.0.113.10, 198.51.100.1, 192.0.2.1')),
    ).toBe('203.0.113.10');
  });

  it('trims whitespace around the first hop', () => {
    expect(trustedClientIpFromHeaders(header('  203.0.113.10  , 8.8.8.8'))).toBe(
      '203.0.113.10',
    );
  });

  it('accepts IPv6', () => {
    expect(trustedClientIpFromHeaders(header('2001:db8::1'))).toBe('2001:db8::1');
    expect(trustedClientIpFromHeaders(header('::1'))).toBe('::1');
  });

  it('returns null when the header is missing, empty, or not an IP', () => {
    expect(trustedClientIpFromHeaders(header(null))).toBeNull();
    expect(trustedClientIpFromHeaders(header(''))).toBeNull();
    expect(trustedClientIpFromHeaders(header('not-an-ip'))).toBeNull();
    expect(trustedClientIpFromHeaders(header('unknown'))).toBeNull();
    expect(trustedClientIpFromHeaders(header(', 203.0.113.10'))).toBeNull();
  });

  it('does not fall back to x-real-ip', () => {
    const headers: Pick<Headers, 'get'> = {
      get: (name: string) => (name.toLowerCase() === 'x-real-ip' ? '203.0.113.10' : null),
    };
    expect(trustedClientIpFromHeaders(headers)).toBeNull();
  });
});

describe('hash identity formula', () => {
  const secret = 'test-ip-hash-secret';

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('preserves hashClientIp output for a real IPv4 and domain-separates email', () => {
    vi.stubEnv('WANDERBITE_IP_HASH_SECRET', secret);
    const ip = '203.0.113.10';
    const expectedIp = `v1:${createHash('sha256')
      .update(`v1:${secret}:${ip}`)
      .digest('hex')}`;
    expect(hashClientIp(ip)).toBe(expectedIp);
    expect(hashClientIp('')).toBeNull();

    const email = 'user@example.com';
    const expectedEmail = `v1:${createHash('sha256')
      .update(`v1:email:${secret}:${email}`)
      .digest('hex')}`;
    expect(hashResetEmail('  User@Example.COM ')).toBe(expectedEmail);
    expect(hashResetEmail('user@example.com')).toBe(expectedEmail);
    expect(hashResetEmail(email)).not.toBe(hashClientIp(email));
    expect(hashResetEmail(email)).not.toContain('@');
    expect(hashClientIp(ip)).not.toContain(ip);
  });
});
