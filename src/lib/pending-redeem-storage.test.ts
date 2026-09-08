import { describe, expect, it } from 'vitest';
import {
  consumePendingRedeemCode,
  persistAndStripPartnerRedeemCode,
  PENDING_REDEEM_TTL_MS,
  takePartnerRedeemCodeForVerify,
  writePendingRedeemCode,
  type SessionStorageLike,
} from '@/lib/pending-redeem-storage';

function memoryStorage(initial: Record<string, string> = {}): SessionStorageLike & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem(key: string) {
      return data[key] ?? null;
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
    removeItem(key: string) {
      delete data[key];
    },
  };
}

describe('pending redeem storage', () => {
  it('is one-use', () => {
    const storage = memoryStorage();
    expect(writePendingRedeemCode('grill', 'wb-xxxx1', { storage })).toBe(true);
    expect(consumePendingRedeemCode('grill', { storage })).toBe('WB-XXXX1');
    expect(consumePendingRedeemCode('grill', { storage })).toBeNull();
  });

  it('is slug-scoped', () => {
    const storage = memoryStorage();
    writePendingRedeemCode('grill', 'WB-GRILL', { storage });
    writePendingRedeemCode('cafe', 'WB-CAFE', { storage });
    expect(consumePendingRedeemCode('grill', { storage })).toBe('WB-GRILL');
    expect(consumePendingRedeemCode('cafe', { storage })).toBe('WB-CAFE');
  });

  it('ignores expired records', () => {
    const storage = memoryStorage();
    const now = 1_000_000;
    writePendingRedeemCode('grill', 'WB-OLD1', { storage, now, ttlMs: PENDING_REDEEM_TTL_MS });
    expect(consumePendingRedeemCode('grill', { storage, now: now + PENDING_REDEEM_TTL_MS + 1 })).toBeNull();
    expect(storage.data).toEqual({});
  });

  it('ignores malformed records', () => {
    const storage = memoryStorage({
      'wanderbite:pending-redeem:grill': '{not-json',
    });
    expect(consumePendingRedeemCode('grill', { storage })).toBeNull();
    expect(storage.data).toEqual({});
  });

  it('treats unavailable storage as a miss and never throws', () => {
    const throwing: SessionStorageLike = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
    };
    expect(writePendingRedeemCode('grill', 'WB-XXXX1', { storage: throwing })).toBe(false);
    expect(consumePendingRedeemCode('grill', { storage: throwing })).toBeNull();
    expect(writePendingRedeemCode('grill', 'WB-XXXX1', { storage: null })).toBe(false);
    expect(consumePendingRedeemCode('grill', { storage: null })).toBeNull();
  });
});

describe('partner scan persist/take', () => {
  it('authenticated scan: strips the URL, then consume-before-verify returns the code', () => {
    const storage = memoryStorage();
    window.history.replaceState({ keep: true }, '', '/partner/grill/redeem?code=WB-SCAN1');
    persistAndStripPartnerRedeemCode('grill', 'WB-SCAN1', { storage });
    expect(window.location.search).toBe('');
    expect(window.history.state).toEqual({ keep: true });
    const pending = takePartnerRedeemCodeForVerify('grill', 'WB-SCAN1', { storage });
    expect(pending).toBe('WB-SCAN1');
    expect(consumePendingRedeemCode('grill', { storage })).toBeNull();
  });

  it('unauthenticated scan: login persist survives a clean redeem URL', () => {
    const storage = memoryStorage();
    window.history.replaceState({ keep: true }, '', '/partner/grill/redeem?code=WB-SCAN2');
    persistAndStripPartnerRedeemCode('grill', 'WB-SCAN2', { storage });
    expect(window.location.search).toBe('');
    window.history.replaceState(window.history.state, '', '/partner/grill/redeem');
    const pending = takePartnerRedeemCodeForVerify('grill', null, { storage });
    expect(pending).toBe('WB-SCAN2');
  });

  it('storage failure never restores code to the URL', () => {
    const throwing: SessionStorageLike = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
    };
    window.history.replaceState({ keep: true }, '', '/partner/grill/redeem?code=WB-SCAN3');
    persistAndStripPartnerRedeemCode('grill', 'WB-SCAN3', { storage: throwing });
    expect(window.location.pathname).toBe('/partner/grill/redeem');
    expect(window.location.search).toBe('');
    expect(takePartnerRedeemCodeForVerify('grill', null, { storage: throwing })).toBeNull();
  });
});
