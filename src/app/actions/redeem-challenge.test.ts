import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptRedemptionCode } from '@/lib/redemption-crypto';
import { REDEMPTION_ISSUE_UNAVAILABLE_MESSAGE } from '@/lib/redemption-issue';
import { VISIT_WINDOW_CLOSED_MESSAGE } from '@/lib/redemption-expiry';

const USER_ID = '40000000-0000-4000-8000-000000000001';
const ITEM_ID = '40000000-0000-4000-8000-000000000021';
const CYCLE_ID = '40000000-0000-4000-8000-000000000031';
const KEY = Buffer.alloc(32, 9).toString('base64');

const requireUser = vi.fn();
const evaluateRedemptionIssueLimit = vi.fn();
const isDisabled = vi.fn();
const rpc = vi.fn();
const from = vi.fn();

vi.mock('@/lib/auth/require-user', () => ({
  requireUser: () => requireUser(),
}));

vi.mock('@/lib/ratelimit', () => ({
  evaluateRedemptionIssueLimit: (...args: unknown[]) => evaluateRedemptionIssueLimit(...args),
}));

vi.mock('@/lib/redemption-issue', async () => {
  const actual = await vi.importActual<typeof import('@/lib/redemption-issue')>(
    '@/lib/redemption-issue',
  );
  return {
    ...actual,
    isRedemptionIssuanceDisabled: () => isDisabled(),
  };
});

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/posthog-server', () => ({ captureEvent: vi.fn() }));

type Item = {
  id: string;
  cycle_id: string;
  restaurant_id: string;
  status: string;
  redemption_deadline: string | null;
};

type Redemption = {
  id: string;
  created_at: string;
  encrypted_code: string | null;
  code_iv: string | null;
  status: string;
  expires_at: string;
};

const state: { item: Item; redemption: Redemption | null } = {
  item: {
    id: ITEM_ID,
    cycle_id: CYCLE_ID,
    restaurant_id: 'rest-1',
    status: 'assigned',
    redemption_deadline: null,
  },
  redemption: null,
};

function wireFrom() {
  from.mockImplementation((table: string) => ({
    select: (columns: string) => ({
      eq: () => ({
        maybeSingle: async () => {
          if (table === 'challenge_items') return { data: state.item, error: null };
          if (table === 'challenge_cycles') {
            return { data: { id: CYCLE_ID, user_id: USER_ID }, error: null };
          }
          if (table === 'redemptions') {
            if (!state.redemption) return { data: null, error: null };
            if (columns === 'status, expires_at') {
              return {
                data: { status: state.redemption.status, expires_at: state.redemption.expires_at },
                error: null,
              };
            }
            return { data: state.redemption, error: null };
          }
          return { data: null, error: null };
        },
      }),
    }),
  }));
}

describe('redeemChallengeItem code lifetime', () => {
  beforeEach(() => {
    requireUser.mockReset();
    evaluateRedemptionIssueLimit.mockReset();
    isDisabled.mockReset();
    rpc.mockReset();
    from.mockReset();
    vi.stubEnv('REDEMPTION_CODE_ENCRYPTION_KEY', KEY);
    requireUser.mockResolvedValue({ ok: true, userId: USER_ID, email: 'member@example.com' });
    evaluateRedemptionIssueLimit.mockResolvedValue('allowed');
    isDisabled.mockReturnValue(false);
    state.item = {
      id: ITEM_ID,
      cycle_id: CYCLE_ID,
      restaurant_id: 'rest-1',
      status: 'assigned',
      redemption_deadline: null,
    };
    state.redemption = null;
    wireFrom();
    rpc.mockImplementation(async (_name: string, args: { p_encrypted_code: string; p_code_iv: string; p_expires_at: string }) => {
      state.redemption = {
        id: 'red-1',
        created_at: '2026-11-05T01:00:00.000Z',
        encrypted_code: args.p_encrypted_code,
        code_iv: args.p_code_iv,
        status: 'issued',
        expires_at: args.p_expires_at,
      };
      return {
        data: [
          {
            outcome: state.item.status === 'redeemed' ? 'reissued' : 'created',
            redemption_id: 'red-1',
            encrypted_code: args.p_encrypted_code,
            code_iv: args.p_code_iv,
            created_at: '2026-11-05T01:00:00.000Z',
          },
        ],
        error: null,
      };
    });
  });

  it('returns an unexpired issued code without rate limiting or a new issue', async () => {
    const sealed = encryptRedemptionCode('WB-LIVE1');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    state.item.status = 'redeemed';
    state.redemption = {
      id: 'red-1',
      created_at: '2026-11-05T01:00:00.000Z',
      encrypted_code: sealed.encrypted,
      code_iv: sealed.iv,
      status: 'issued',
      expires_at: expiresAt,
    };
    const { redeemChallengeItem } = await import('@/app/actions/redeem-challenge');
    const result = await redeemChallengeItem(ITEM_ID);
    expect(result).toEqual({
      ok: true,
      data: {
        token: 'WB-LIVE1',
        redeemedAt: '2026-11-05T01:00:00.000Z',
        redemptionId: 'red-1',
        expiresAt,
      },
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(evaluateRedemptionIssueLimit).not.toHaveBeenCalled();
  });

  it('refuses a verified redemption', async () => {
    state.item.status = 'redeemed';
    state.redemption = {
      id: 'red-1',
      created_at: '2026-11-05T01:00:00.000Z',
      encrypted_code: 'cipher',
      code_iv: 'iv',
      status: 'verified',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    const { redeemChallengeItem } = await import('@/app/actions/redeem-challenge');
    await expect(redeemChallengeItem(ITEM_ID)).resolves.toEqual({
      ok: false,
      error: 'This challenge has already been redeemed.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses a reissue after the visit window closes', async () => {
    state.item.status = 'redeemed';
    state.item.redemption_deadline = new Date(Date.now() - 60_000).toISOString();
    state.redemption = {
      id: 'red-1',
      created_at: '2026-11-05T01:00:00.000Z',
      encrypted_code: 'cipher',
      code_iv: 'iv',
      status: 'expired',
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    };
    const { redeemChallengeItem } = await import('@/app/actions/redeem-challenge');
    await expect(redeemChallengeItem(ITEM_ID)).resolves.toEqual({
      ok: false,
      error: VISIT_WINDOW_CLOSED_MESSAGE,
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(evaluateRedemptionIssueLimit).not.toHaveBeenCalled();
  });

  it('rate limits and honors the issuance freeze on reissue', async () => {
    state.item.status = 'redeemed';
    state.item.redemption_deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    state.redemption = {
      id: 'red-1',
      created_at: '2026-11-05T01:00:00.000Z',
      encrypted_code: 'cipher',
      code_iv: 'iv',
      status: 'issued',
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    };
    evaluateRedemptionIssueLimit.mockResolvedValue('rate_limited');
    const { redeemChallengeItem } = await import('@/app/actions/redeem-challenge');
    await expect(redeemChallengeItem(ITEM_ID)).resolves.toEqual({
      ok: false,
      error: REDEMPTION_ISSUE_UNAVAILABLE_MESSAGE,
    });
    expect(rpc).not.toHaveBeenCalled();

    evaluateRedemptionIssueLimit.mockResolvedValue('allowed');
    isDisabled.mockReturnValue(true);
    await expect(redeemChallengeItem(ITEM_ID)).resolves.toEqual({
      ok: false,
      error: REDEMPTION_ISSUE_UNAVAILABLE_MESSAGE,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reissues an expired code and caps expires_at at a five-minute window', async () => {
    const deadline = new Date(Date.now() + 5 * 60 * 1000);
    state.item.status = 'redeemed';
    state.item.redemption_deadline = deadline.toISOString();
    state.redemption = {
      id: 'red-1',
      created_at: '2026-11-05T01:00:00.000Z',
      encrypted_code: 'cipher',
      code_iv: 'iv',
      status: 'expired',
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    };
    const { redeemChallengeItem } = await import('@/app/actions/redeem-challenge');
    const result = await redeemChallengeItem(ITEM_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.expiresAt).toBe(deadline.toISOString());
    expect(rpc).toHaveBeenCalledTimes(1);
    const args = rpc.mock.calls[0]?.[1] as { p_expires_at: string };
    expect(args.p_expires_at).toBe(deadline.toISOString());
    expect(evaluateRedemptionIssueLimit).toHaveBeenCalledWith(USER_ID);
  });
});
