import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PricingFaq } from '@/components/pricing/pricing-faq';
import HowItWorksPage from './page';

const TIERS = [
  ['300', 'The Explorer'],
  ['1000', 'The Tastemaker'],
  ['1500', 'The Connoisseur'],
  ['2500', 'The Local Legend'],
] as const;

const FAQ = [
  'Where is WanderBite available?',
  'Can I cancel anytime?',
  'Do the discounts expire?',
  "What if I don't like the restaurant?",
  'How often can I patron the same spot?',
] as const;

afterEach(() => cleanup());

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

function mix(
  top: readonly [number, number, number],
  bottom: readonly [number, number, number],
  alpha: number,
): [number, number, number] {
  return [
    Math.round(top[0] * alpha + bottom[0] * (1 - alpha)),
    Math.round(top[1] * alpha + bottom[1] * (1 - alpha)),
    Math.round(top[2] * alpha + bottom[2] * (1 - alpha)),
  ];
}

describe('How it Works', () => {
  it('has one h1 and keeps the section headings', () => {
    render(<HowItWorksPage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'How Wanderbite Works' })).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'We only pick highly-rated, hand-curated local favorites.' }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Three steps to better nights out' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Level Up Your Palate' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Frequently Asked Questions' })).toBeTruthy();
    expect(screen.getByText('Stop scrolling. Start eating.')).toBeTruthy();
  });

  it('shows the four XP tiers with their numbers and titles', () => {
    render(<HowItWorksPage />);
    for (const [xp, title] of TIERS) {
      expect(screen.getByRole('heading', { level: 3, name: title })).toBeTruthy();
      expect(screen.getAllByText(`${xp} XP`).length).toBeGreaterThan(0);
      expect(screen.getByText(`${xp} XP milestone`)).toBeTruthy();
    }
  });

  it('keeps the pricing CTA label and href', () => {
    render(<HowItWorksPage />);
    const cta = screen.getByRole('link', { name: 'See pricing & join the club' });
    expect(cta.getAttribute('href')).toBe('/pricing');
    expect(cta.className).toContain('wb-cta');
    expect(cta.className).toContain('wb-hiw-cta');
  });

  it('renders FAQ items and toggles each one from the button', () => {
    render(<HowItWorksPage />);
    for (const question of FAQ) {
      const button = screen.getByRole('button', { name: question });
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(button.className).toContain('focus-visible:outline-wb-violet');
      expect(button.innerHTML).toContain('motion-reduce:transition-none');
      button.focus();
      expect(document.activeElement).toBe(button);
      fireEvent.keyDown(button, { key: 'Enter' });
      expect(button.getAttribute('aria-expanded')).toBe('true');
      fireEvent.keyDown(button, { key: 'Enter' });
      expect(button.getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(button);
      expect(button.getAttribute('aria-expanded')).toBe('true');
      fireEvent.click(button);
      expect(button.getAttribute('aria-expanded')).toBe('false');
    }
  });

  it('keeps the night scrim dark enough for text on a white photograph', () => {
    render(<HowItWorksPage />);
    const tier = screen.getByRole('heading', { name: 'Level Up Your Palate' }).closest('section');
    expect(tier?.innerHTML).toContain('bg-wb-night/85');
    const night: [number, number, number] = [0x12, 0x0a, 0x24];
    const white: [number, number, number] = [255, 255, 255];
    const overlay = mix(night, white, 0.85);
    expect(contrast(white, overlay)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0xdd, 0xd6, 0xfe], overlay)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0xff, 0xc9, 0xd6], overlay)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0x1f, 0x15, 0x30], white)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0x6b, 0x62, 0x75], white)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0x2a, 0x14, 0x42], white)).toBeGreaterThanOrEqual(4.5);
  });

  it('uses the AA-safe violet stop on the primary pill', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/app/styles/wanderbite-theme.css'), 'utf8');
    const block = css.slice(css.indexOf('.wb-hiw-cta'), css.indexOf('.wb-hiw-cta') + 180);
    expect(block).toContain('var(--wb-violet)');
    expect(block).toContain('var(--wb-pink)');
    expect(block).not.toContain('--wb-violet-2');
  });
});

describe('PricingFaq default tone', () => {
  it('keeps the classes /pricing would inherit', () => {
    render(<PricingFaq />);
    const heading = screen.getByRole('heading', { name: 'Frequently Asked Questions' });
    expect(heading.className).toBe('mb-8 text-xl font-semibold tracking-tight');
    const item = heading.closest('section')?.querySelector('li');
    expect(item?.className).toBe('rounded-lg border bg-card');
    const button = screen.getByRole('button', { name: 'Can I cancel anytime?' });
    expect(button.className).toBe(
      'flex w-full items-center justify-between gap-4 px-4 py-4 text-left font-medium transition-colors hover:bg-muted/50',
    );
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Yes, one click in your profile.')).toBeTruthy();
  });
});
