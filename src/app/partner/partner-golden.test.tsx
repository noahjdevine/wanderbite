import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const maybeSingle = vi.hoisted(() => vi.fn());
const getPartnerSession = vi.hoisted(() => vi.fn());
const getPartnerAnalytics = vi.hoisted(() => vi.fn());
const loginPartnerFromForm = vi.hoisted(() => vi.fn());
const verifyRedemptionTokenForPartner = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, replace: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle,
          }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/app/actions/partner-auth', () => ({
  getPartnerSession: (...args: unknown[]) => getPartnerSession(...args),
  getPartnerAnalytics: (...args: unknown[]) => getPartnerAnalytics(...args),
  loginPartnerFromForm: (...args: unknown[]) => loginPartnerFromForm(...args),
  logoutPartner: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/app/actions/partner-verify', () => ({
  verifyRedemptionTokenForPartner: (...args: unknown[]) => verifyRedemptionTokenForPartner(...args),
}));

import PartnerLayout from './layout';
import PartnerFallbackPage from './page';
import PartnerSlugPage from './[slug]/page';
import PartnerRedeemPage from './[slug]/redeem/page';
import { PartnerDashboard } from './partner-dashboard';
import { PartnerLoginForm } from './partner-login-form';
import { PartnerSlugLogin } from './[slug]/partner-slug-login';

const ROOT = path.resolve(__dirname, '../../..');
const cssPath = path.join(ROOT, 'src/app/styles/wanderbite-theme.css');

const analytics = {
  ok: true as const,
  revenueFormatted: '$90',
  totalRedemptionsAllTime: 2,
  totalRedemptionsThisMonth: 1,
  historicalVolume: [{ monthLabel: 'Jun 26', count: 1 }],
  recentCustomers: [{ emailMasked: 'a***@b.com', verifiedAt: 'Nov 4, 2026, 02:00 PM' }],
};

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  maybeSingle.mockReset();
  getPartnerSession.mockReset();
  getPartnerAnalytics.mockReset();
  loginPartnerFromForm.mockReset();
  verifyRedemptionTokenForPartner.mockReset();
  refresh.mockReset();
  maybeSingle.mockResolvedValue({ data: null, error: null });
  getPartnerSession.mockResolvedValue({ ok: false });
});

function linear(channel: number) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: readonly [number, number, number]) {
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

function contrast(foreground: readonly [number, number, number], background: readonly [number, number, number]) {
  const hi = Math.max(luminance(foreground), luminance(background));
  const lo = Math.min(luminance(foreground), luminance(background));
  return (hi + 0.05) / (lo + 0.05);
}

describe('partner portal pages', () => {
  it('keeps the fallback copy, one h1, and the same hrefs inside the partner bar', () => {
    render(
      <PartnerLayout>
        <PartnerFallbackPage />
      </PartnerLayout>,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Partner Portal' })).toBeTruthy();
    expect(screen.getByText(/Looking for your partner portal/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'support@wanderbite.com' }).getAttribute('href')).toBe(
      'mailto:support@wanderbite.com',
    );
    expect(screen.getByRole('link', { name: 'Wanderbite home' }).getAttribute('href')).toBe(
      'https://wanderbite.vercel.app',
    );
    expect(screen.getByRole('link', { name: 'Wanderbite' }).getAttribute('href')).toBe(
      'https://wanderbite.vercel.app',
    );
    expect(screen.getByRole('link', { name: 'Need help? support@wanderbite.com' }).getAttribute('href')).toBe(
      'mailto:support@wanderbite.com',
    );
    expect(screen.getByText('Partner Portal', { selector: 'p' })).toBeTruthy();
  });

  it('renders portal-not-found with the same support href', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'missing' } });
    render(await PartnerSlugPage({ params: Promise.resolve({ slug: 'missing' }) }));
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Portal not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'support@wanderbite.com' }).getAttribute('href')).toBe(
      'mailto:support@wanderbite.com',
    );
    expect(screen.queryByLabelText('PIN')).toBeNull();
  });

  it('shows the slug PIN form when the restaurant exists and no partner session matches', async () => {
    maybeSingle.mockResolvedValue({
      data: { id: 'rest-1', name: 'North Grill', slug: 'north-grill' },
      error: null,
    });
    render(await PartnerSlugPage({ params: Promise.resolve({ slug: 'north-grill' }) }));
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome, North Grill' })).toBeTruthy();
    expect(screen.getByText('Enter your PIN to access your Wanderbite partner dashboard')).toBeTruthy();
    const pin = screen.getByLabelText('PIN');
    expect(pin.getAttribute('name')).toBe('pin');
    expect(pin.getAttribute('autocomplete')).toBe('off');
    expect(pin.getAttribute('inputmode')).toBe('numeric');
    expect(pin.getAttribute('type')).toBe('password');
    expect(document.querySelector('input[name="restaurantId"]')?.getAttribute('value')).toBe('rest-1');
    expect(document.querySelector('input[name="next"]')?.getAttribute('value')).toBe('/partner/north-grill');
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });

  it('renders the dashboard for the matching partner session', async () => {
    maybeSingle.mockResolvedValue({
      data: { id: 'rest-1', name: 'North Grill', slug: 'north-grill' },
      error: null,
    });
    getPartnerSession.mockResolvedValue({
      ok: true,
      restaurantId: 'rest-1',
      restaurantName: 'North Grill',
    });
    getPartnerAnalytics.mockResolvedValue(analytics);
    render(await PartnerSlugPage({ params: Promise.resolve({ slug: 'north-grill' }) }));
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Partner Portal' })).toBeTruthy();
    expect(screen.getByText('North Grill')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Redeem mode' }).getAttribute('href')).toBe(
      '/partner/north-grill/redeem',
    );
    expect(screen.getByText('Performance History')).toBeTruthy();
    expect(screen.getByText('Recent Guests')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Guest Email' })).toBeTruthy();
    expect(screen.getByText('a***@b.com')).toBeTruthy();
  });

  it('keeps redeem-mode login and the not-found support link', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    render(
      await PartnerRedeemPage({
        params: Promise.resolve({ slug: 'missing' }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Portal not found' })).toBeTruthy();

    cleanup();
    maybeSingle.mockResolvedValue({
      data: { id: 'rest-1', name: 'North Grill', slug: 'north-grill' },
      error: null,
    });
    render(
      await PartnerRedeemPage({
        params: Promise.resolve({ slug: 'north-grill' }),
        searchParams: Promise.resolve({ code: 'WB-KEEP' }),
      }),
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome, North Grill' })).toBeTruthy();
    expect(
      screen.getByText('Sign in to verify guest codes (bookmark this page for your host stand).'),
    ).toBeTruthy();
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect(document.querySelector('input[name="next"]')?.getAttribute('value')).toBe(
      '/partner/north-grill/redeem',
    );
  });

  it('still treats partner routes as public in middleware', () => {
    const middleware = readFileSync(path.join(ROOT, 'src/lib/supabase/middleware.ts'), 'utf8');
    expect(middleware).toMatch(/pathname === '\/partner'/);
    expect(middleware).toMatch(/pathname\.startsWith\('\/partner\/'\)/);
  });
});

describe('partner verify form', () => {
  it('labels the code field and sends the trimmed code once', async () => {
    verifyRedemptionTokenForPartner.mockResolvedValue({
      success: false,
      message: 'Code expired',
    });
    render(
      <PartnerDashboard restaurantName="North Grill" restaurantSlug="north-grill" analytics={analytics} />,
    );
    const input = screen.getByLabelText('Redeem Customer Code');
    expect(input.getAttribute('name')).toBeNull();
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('inputmode')).toBeNull();
    expect(input.getAttribute('placeholder')).toBe('Enter code (e.g., WB-XXXXX)');
    expect(input.getAttribute('aria-describedby')).toBe('partner-dashboard-code-hint');

    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(verifyRedemptionTokenForPartner).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '  WB-ABCDE  ' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(verifyRedemptionTokenForPartner).not.toHaveBeenCalled();
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    await waitFor(() => {
      expect(verifyRedemptionTokenForPartner).toHaveBeenCalledTimes(1);
    });
    expect(verifyRedemptionTokenForPartner).toHaveBeenCalledWith('WB-ABCDE');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Invalid or already used');
    expect(alert.textContent).toContain('Code expired');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(input.getAttribute('aria-describedby')).toBe('partner-dashboard-code-hint partner-dashboard-code-error');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows the same success lines for a legacy and a sealed code', async () => {
    verifyRedemptionTokenForPartner.mockResolvedValueOnce({
      success: true,
      redemptionDetails: { email: 'guest@example.com', restaurantName: 'North Grill', verifiedAt: 'Nov 4, 2026' },
      newBadgesEarned: [],
      hideDiscountAmount: false,
      sealedDiscountCents: null,
      sealedMinSpendCents: null,
    });
    render(
      <PartnerDashboard restaurantName="North Grill" restaurantSlug="north-grill" analytics={null} />,
    );
    const input = screen.getByLabelText('Redeem Customer Code');
    fireEvent.change(input, { target: { value: 'WB-OK' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(await screen.findByText('Valid — $10 discount applied')).toBeTruthy();
    expect(screen.getByText(/guest@example.com/)).toBeTruthy();
    expect(screen.getByText(/Nov 4, 2026/)).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);

    cleanup();
    verifyRedemptionTokenForPartner.mockResolvedValueOnce({
      success: true,
      redemptionDetails: { email: null, restaurantName: 'North Grill', verifiedAt: 'Nov 4, 2026' },
      newBadgesEarned: [],
      hideDiscountAmount: true,
      sealedDiscountCents: 1500,
      sealedMinSpendCents: 4000,
    });
    render(
      <PartnerDashboard restaurantName="North Grill" restaurantSlug="north-grill" analytics={null} />,
    );
    const sealed = screen.getByLabelText('Redeem Customer Code');
    fireEvent.change(sealed, { target: { value: 'WB-SEAL' } });
    fireEvent.submit(sealed.closest('form') as HTMLFormElement);
    expect(await screen.findByText('Valid — $15 off $40')).toBeTruthy();
  });
});

describe('partner login forms', () => {
  it('keeps the restaurant form fields and announces the same error', async () => {
    loginPartnerFromForm.mockResolvedValue({ ok: false, error: 'Invalid PIN.' });
    render(<PartnerLoginForm restaurants={[{ id: 'rest-1', name: 'North Grill' }]} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Partner Portal' })).toBeTruthy();
    const restaurant = screen.getByLabelText('Restaurant');
    const pin = screen.getByLabelText('Restaurant PIN');
    expect(restaurant.getAttribute('name')).toBe('restaurantId');
    expect(pin.getAttribute('name')).toBe('pin');
    expect(pin.getAttribute('autocomplete')).toBe('off');
    expect(pin.getAttribute('inputmode')).toBe('numeric');
    fireEvent.change(restaurant, { target: { value: 'rest-1' } });
    fireEvent.change(pin, { target: { value: '1234' } });
    fireEvent.submit(pin.closest('form') as HTMLFormElement);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Invalid PIN.');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(pin.getAttribute('aria-describedby')).toBe('partner-pin-error');
    expect(loginPartnerFromForm).toHaveBeenCalledTimes(1);
    const formData = loginPartnerFromForm.mock.calls[0]?.[1] as FormData;
    expect(formData.get('restaurantId')).toBe('rest-1');
    expect(formData.get('pin')).toBe('1234');
  });

  it('keeps the slug login payload and the invalid-PIN sentence', async () => {
    loginPartnerFromForm.mockResolvedValue({ ok: false, error: 'Invalid PIN.' });
    render(
      <PartnerSlugLogin
        restaurantId="rest-1"
        restaurantName="North Grill"
        mode="redeem"
        redirectSlug="north-grill"
      />,
    );
    const pin = screen.getByLabelText('PIN');
    fireEvent.change(pin, { target: { value: '0042' } });
    fireEvent.submit(pin.closest('form') as HTMLFormElement);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Invalid PIN. Please contact support@wanderbite.com');
    expect(pin.getAttribute('aria-describedby')).toBe('partner-slug-pin-error');
    const formData = loginPartnerFromForm.mock.calls[0]?.[1] as FormData;
    expect(formData.get('restaurantId')).toBe('rest-1');
    expect(formData.get('pin')).toBe('0042');
    expect(formData.get('next')).toBe('/partner/north-grill/redeem');
    expect(formData.get('rememberDevice')).toBe('true');
  });
});

describe('partner Golden Hour tokens', () => {
  it('adds a partner-scoped pill and leaves the reading and how-it-works rules in place', () => {
    const css = readFileSync(cssPath, 'utf8');
    const partnerAt = css.indexOf('/* ---------- Partner portal');
    const readingAt = css.indexOf('/* ---------- Contact and legal reading pages');
    expect(readingAt).toBeGreaterThan(-1);
    expect(partnerAt).toBeGreaterThan(readingAt);
    const reading = css.slice(readingAt, partnerAt);
    expect(reading).toContain('.wb-reading {');
    expect(reading).not.toContain('.wb-partner');
    expect(css).toContain(
      '.wb-hiw-cta {\n  background: linear-gradient(135deg, var(--wb-violet) 0%, var(--wb-pink) 100%);\n}',
    );
    const pillStart = css.indexOf('.wb-partner-cta {\n  background:');
    const pill = css.slice(pillStart, pillStart + 240);
    expect(pill).toContain('var(--wb-violet)');
    expect(pill).toContain('var(--wb-pink)');
    expect(pill).not.toContain('--wb-violet-2');
    expect(contrast([255, 255, 255], [0x7c, 0x3a, 0xed])).toBeGreaterThanOrEqual(4.5);
    expect(contrast([255, 255, 255], [0xdb, 0x27, 0x77])).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0x1f, 0x15, 0x30], [0xfa, 0xf6, 0xef])).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0x6b, 0x62, 0x75], [0xfa, 0xf6, 0xef])).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0xff, 0xff, 0xff], [0x12, 0x0a, 0x24])).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0xdd, 0xd6, 0xfe], [0x12, 0x0a, 0x24])).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0x14, 0x53, 0x2d], [0xdc, 0xfc, 0xe7])).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0x7f, 0x1d, 0x1d], [0xfe, 0xe2, 0xe2])).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0xbe, 0x18, 0x5d], [0xfa, 0xf6, 0xef])).toBeGreaterThanOrEqual(4.5);
  });
});
