import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AreaHoldNotice } from '@/components/area-hold-notice';
import { LaunchHoldNotice } from '@/components/launch-hold-notice';
import { PricingFaq } from '@/components/pricing/pricing-faq';
import { PricingClient } from '@/components/pricing/pricing-client';
import { CLUB_PLAN_FEATURES } from '@/lib/club-plan-content';
import { AREA_HOLD_BODY, AREA_HOLD_HEADING, LAUNCH_MARKET } from '@/lib/launch-market';
import { LAUNCH_HOLD_BODY, LAUNCH_HOLD_HEADING } from '@/components/launch-hold-notice';

const createCheckoutSession = vi.hoisted(() => vi.fn());

vi.mock('@/app/actions/stripe', () => ({
  createCheckoutSession: (...args: unknown[]) => createCheckoutSession(...args),
}));

afterEach(() => {
  cleanup();
  createCheckoutSession.mockClear();
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

function expectSharedPlan() {
  expect(screen.getAllByRole('heading')).toHaveLength(1);
  const price = document.querySelector('.wb-pricing-price');
  expect(price?.textContent).toBe('$15/month');
  for (const feature of CLUB_PLAN_FEATURES) {
    expect(screen.getByText(feature)).toBeTruthy();
  }
  expect(screen.getByText(/Now launching in McKinney, Texas/)).toBeTruthy();
  expect(screen.getByText(/Plan \(when checkout reopens\): \$15\/month \(billed monthly\)/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Terms of Service' }).getAttribute('href')).toBe('/terms');
  expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('/privacy');
  expect(screen.getByRole('link', { name: 'Discount & Challenge Rules' }).getAttribute('href')).toBe('/rules');
  expect(screen.queryByRole('button')).toBeNull();
  expect(createCheckoutSession).not.toHaveBeenCalled();
  expect(document.body.textContent ?? '').not.toMatch(/createCheckoutSession|Stripe|CHECKOUT_ENABLED/);
}

describe('PricingClient branches', () => {
  it('shows the launch hold and a signup link when signed out', () => {
    render(<PricingClient />);
    expectSharedPlan();
    expect(screen.getByRole('heading', { level: 1, name: 'Simple, Transparent Pricing.' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(LAUNCH_HOLD_HEADING);
    expect(screen.getByRole('status').textContent).toContain(LAUNCH_HOLD_BODY);
    expect(screen.getByRole('link', { name: 'Create a free account' }).getAttribute('href')).toBe('/signup');
    expect(screen.queryByRole('link', { name: 'Manage my plan' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Finish your profile' })).toBeNull();
  });

  it('keeps the paused-checkout welcome for an eligible signed-in member', () => {
    render(
      <PricingClient
        userId="member-1"
        email="ada@example.com"
        fullName="  Ada Lovelace  "
        subscriptionStatus="inactive"
        areaState="eligible"
      />,
    );
    expectSharedPlan();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Welcome, Ada! Membership checkout is paused.' }),
    ).toBeTruthy();
    expect(screen.getByText('Paid checkout is launching soon. You can still create a free account.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(LAUNCH_HOLD_HEADING);
    expect(screen.queryByText('ada@example.com')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Create a free account' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Manage my plan' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Finish your profile' })).toBeNull();
  });

  it('keeps the paused welcome when a signed-in member has no area hold', () => {
    render(
      <PricingClient userId="member-1" fullName="Ada Lovelace" subscriptionStatus={null} areaState={null} />,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Welcome, Ada! Membership checkout is paused.' }),
    ).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(LAUNCH_HOLD_BODY);
    expect(screen.queryByRole('link', { name: 'Create a free account' })).toBeNull();
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('links an active member to billing', () => {
    render(
      <PricingClient
        userId="member-1"
        fullName="Ada Lovelace"
        subscriptionStatus="active"
        areaState="eligible"
      />,
    );
    expectSharedPlan();
    expect(screen.getByRole('heading', { level: 1, name: 'Your Wanderbite Club plan' })).toBeTruthy();
    expect(screen.getByText('Manage your subscription anytime.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Manage my plan' }).getAttribute('href')).toBe('/billing');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Create a free account' })).toBeNull();
  });

  it('shows the area hold and no signup bypass when the address is ineligible', () => {
    render(
      <PricingClient
        userId="member-1"
        fullName="Ada Lovelace"
        subscriptionStatus="inactive"
        areaState="ineligible"
      />,
    );
    expectSharedPlan();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Welcome, Ada! Membership checkout is paused.' }),
    ).toBeTruthy();
    const status = screen.getByRole('status');
    expect(status.textContent).toContain(AREA_HOLD_HEADING);
    expect(status.textContent).toContain(AREA_HOLD_BODY);
    expect(status.textContent).toContain(LAUNCH_MARKET.displayName);
    expect(status.textContent).not.toContain(LAUNCH_HOLD_HEADING);
    expect(screen.queryByRole('link', { name: 'Create a free account' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Finish your profile' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Manage my plan' })).toBeNull();
  });

  it('sends a member with no address to onboarding', () => {
    render(
      <PricingClient
        userId="member-1"
        subscriptionStatus="inactive"
        areaState="missing_address"
      />,
    );
    expectSharedPlan();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Welcome! Membership checkout is paused.' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Finish your profile' }).getAttribute('href')).toBe(
      '/onboarding',
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Create a free account' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Manage my plan' })).toBeNull();
  });
});

describe('pricing sources stay frozen', () => {
  const root = process.cwd();

  it('does not call checkout or render the FAQ on /pricing', () => {
    const page = readFileSync(path.join(root, 'src/app/(site)/pricing/page.tsx'), 'utf8');
    const client = readFileSync(path.join(root, 'src/components/pricing/pricing-client.tsx'), 'utf8');
    for (const src of [page, client]) {
      expect(src).not.toMatch(/createCheckoutSession/);
      expect(src).not.toMatch(/CHECKOUT_ENABLED/);
      expect(src).not.toMatch(/PricingFaq/);
      expect(src).not.toMatch(/stripe/i);
    }
    expect(client).toContain('CLUB_PLAN_FEATURES');
    expect(client).toContain('LAUNCH_MARKET.displayName');
    expect(client).toContain('$15');
    expect(client).toContain('/month');
    expect(client).toContain('href="/billing"');
    expect(client).toContain('href="/onboarding"');
    expect(client).toContain('href="/signup"');
    expect(client).toContain('href="/terms"');
    expect(client).toContain('href="/privacy"');
    expect(client).toContain('href="/rules"');
  });

  it('keeps /pricing public for signed-out visitors', () => {
    const middleware = readFileSync(path.join(root, 'src/lib/supabase/middleware.ts'), 'utf8');
    expect(middleware).toContain("pathname === '/pricing'");
    expect(middleware).toContain("pathname.startsWith('/pricing/')");
  });

  it('paints the primary pill from --wb-violet under .wb-pricing only', () => {
    const css = readFileSync(path.join(root, 'src/app/styles/wanderbite-theme.css'), 'utf8');
    const start = css.indexOf('/* ---------- Pricing ----------');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start);
    expect(block).toContain('linear-gradient(135deg, var(--wb-violet) 0%, var(--wb-pink) 100%)');
    expect(block).toContain('.wb-pricing [data-slot="button"]:focus-visible');
    expect(block).toContain('outline: 2px solid var(--wb-violet);');
    expect(block).not.toContain('--wb-violet-2');
    expect(block).not.toMatch(/\.wb-reading|\.wb-partner|\.wb-auth-|\.wb-account|\.wb-onboarding|\.wb-hiw-cta|Reveal/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.wb-pricing,\s*\.wb-pricing \*/,
    );
    const lastMotion = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'), css.lastIndexOf('@media (prefers-reduced-motion: reduce)') + 400);
    expect(lastMotion).toContain('.wb-nav-menu');
    expect(lastMotion).not.toContain('.wb-pricing');
    const night = [0x12, 0x0a, 0x24] as const;
    const white = [0xff, 0xff, 0xff] as const;
    const paper = [0xff, 0xfd, 0xf8] as const;
    expect(contrast(white, night)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0xdd, 0xd6, 0xfe], night)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0xff, 0xc9, 0xd6], night)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0x1f, 0x15, 0x30], white)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0x6b, 0x62, 0x75], white)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0x6b, 0x62, 0x75], paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0xbe, 0x18, 0x5d], paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0x7c, 0x3a, 0xed], white)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0x4a, 0x0d, 0x24], [0xff, 0xc9, 0xd6])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('shared notice and FAQ defaults', () => {
  it('keeps LaunchHoldNotice, AreaHoldNotice, and PricingFaq default output', () => {
    const launch = render(<LaunchHoldNotice />);
    expect(launch.getByRole('status').className).toBe(
      'w-full rounded-lg border border-border bg-muted/40 px-4 py-3 text-center',
    );
    expect(launch.getByText(LAUNCH_HOLD_HEADING).className).toBe('text-sm font-semibold text-foreground');
    expect(launch.getByText(LAUNCH_HOLD_BODY).className).toBe('mt-1 text-sm text-muted-foreground');
    cleanup();

    const area = render(<AreaHoldNotice />);
    expect(area.getByRole('status').className).toBe(
      'w-full rounded-lg border border-border bg-muted/40 px-4 py-3 text-center',
    );
    expect(area.getByText(AREA_HOLD_HEADING).className).toBe('text-sm font-semibold text-foreground');
    expect(area.getByText(AREA_HOLD_BODY).className).toBe('mt-1 text-sm text-muted-foreground');
    expect(area.getByText(`Current launch city: ${LAUNCH_MARKET.displayName}.`).className).toBe(
      'mt-1 text-xs text-muted-foreground',
    );
    cleanup();

    const faq = render(<PricingFaq />);
    expect(faq.getByRole('heading', { name: 'Frequently Asked Questions' }).className).toBe(
      'mb-8 text-xl font-semibold tracking-tight',
    );
    const item = faq.getByRole('heading', { name: 'Frequently Asked Questions' }).closest('section')?.querySelector('li');
    expect(item?.className).toBe('rounded-lg border bg-card');
  });
});
