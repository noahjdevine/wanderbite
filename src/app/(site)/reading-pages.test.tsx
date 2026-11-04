import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import ContactPage from './contact/page';
import ContactLayout from './contact/layout';
import PrivacyPage from './privacy/page';
import PrivacyLayout from './privacy/layout';
import RulesPage from './rules/page';
import RulesLayout from './rules/layout';
import TermsPage from './terms/page';
import TermsLayout from './terms/layout';

afterEach(() => cleanup());

type Layout = ComponentType<{ children: ReactNode }>;

function renderReading(Layout: Layout, Page: ComponentType) {
  return render(
    <Layout>
      <Page />
    </Layout>,
  );
}

function textOf(container: HTMLElement) {
  return (container.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function headingFacts(container: HTMLElement) {
  return Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((heading) => ({
    level: Number(heading.tagName.slice(1)),
    text: (heading.textContent ?? '').replace(/\s+/g, ' ').trim(),
  }));
}

function hrefsOf(container: HTMLElement) {
  return Array.from(container.querySelectorAll('a')).map((anchor) => ({
    name: (anchor.textContent ?? '').replace(/\s+/g, ' ').trim(),
    href: anchor.getAttribute('href'),
  }));
}

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

describe('Golden Hour reading frame', () => {
  it('keeps night and cream text at WCAG AA and does not hide content', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/app/styles/wanderbite-theme.css'), 'utf8');
    const start = css.indexOf('/* ---------- Contact and legal reading pages');
    const block = css.slice(start, css.indexOf('.wb-wordmark', start));
    expect(block).toContain('.wb-reading');
    expect(block).toContain('72ch');
    expect(block).toContain('prefers-reduced-motion: reduce');
    expect(block).not.toContain('opacity: 0');
    expect(block).not.toContain('wb-reveal');
    expect(block).not.toContain('wb-hiw-cta');
    const cream: [number, number, number] = [0xfa, 0xf6, 0xef];
    const night: [number, number, number] = [0x12, 0x0a, 0x24];
    expect(contrast([255, 255, 255], night)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0xdd, 0xd6, 0xfe], night)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0x1f, 0x15, 0x30], cream)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0x6b, 0x62, 0x75], cream)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0xbe, 0x18, 0x5d], cream)).toBeGreaterThanOrEqual(4.5);
  });
});

describe.each([
  ['contact', ContactLayout, ContactPage, 'Contact Us', ['Support', 'Privacy', 'Mailing Address', 'Response Times']],
  [
    'privacy',
    PrivacyLayout,
    PrivacyPage,
    'Privacy Policy (Wanderbite)',
    ['1) Information We Collect', '10) Contact Us'],
  ],
  ['terms', TermsLayout, TermsPage, 'Wanderbite Terms of Service', ['1) Eligibility', '17) Contact Us']],
  [
    'rules',
    RulesLayout,
    RulesPage,
    'Discount & Challenge Rules',
    ['Monthly Plan Benefits', 'Questions'],
  ],
] as const)('%s', (route, Layout, Page, title, headings) => {
  it('has one h1, the section headings, and no skipped levels', () => {
    const { container } = renderReading(Layout, Page);
    expect(container.querySelector('.wb-reading')).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
    expect(screen.getByText('Last updated: 2/22/2026')).toBeTruthy();
    for (const heading of headings) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
    const levels = headingFacts(container).map((heading) => heading.level);
    expect(levels[0]).toBe(1);
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index] - levels[index - 1]).toBeLessThanOrEqual(1);
    }
    expect(container.querySelector('[id]')).toBeNull();
    expect(container.querySelector('form, input, textarea, select, button')).toBeNull();
    expect(container.querySelector('[aria-live], [aria-describedby]')).toBeNull();
    expect(textOf(container)).toMatchSnapshot();
    expect(hrefsOf(container)).toMatchSnapshot();
  });

  it(`keeps ${route} free of auth form markup`, () => {
    const source = readFileSync(
      path.join(process.cwd(), `src/app/(site)/${route}/page.tsx`),
      'utf8',
    );
    expect(source).not.toMatch(/<form/i);
    expect(source).not.toMatch(/from '@\/components\/ui\//);
    expect(source).not.toMatch(/from '@\/components\/forms\//);
  });
});

describe('contact links', () => {
  it('keeps the mailto addresses and has no fields to submit', () => {
    renderReading(ContactLayout, ContactPage);
    expect(screen.getByRole('link', { name: 'support@wanderbite.com' }).getAttribute('href')).toBe(
      'mailto:support@wanderbite.com',
    );
    expect(screen.getByRole('link', { name: 'privacy@wanderbite.com' }).getAttribute('href')).toBe(
      'mailto:privacy@wanderbite.com',
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('5900 Balcones Drive #23572')).toBeTruthy();
    expect(screen.getByText('Austin, TX 78731, USA')).toBeTruthy();
  });
});

describe('legal hrefs', () => {
  it('keeps the terms, privacy, and rules cross links', () => {
    const { container: terms } = renderReading(TermsLayout, TermsPage);
    expect(hrefsOf(terms)).toEqual(
      expect.arrayContaining([
        { name: 'support@wanderbite.com', href: 'mailto:support@wanderbite.com' },
        { name: 'privacy@wanderbite.com', href: 'mailto:privacy@wanderbite.com' },
        { name: 'Privacy Policy', href: '/privacy' },
      ]),
    );
    expect(textOf(terms)).toContain('$15 per month');
    cleanup();

    const { container: privacy } = renderReading(PrivacyLayout, PrivacyPage);
    expect(hrefsOf(privacy)).toEqual(
      expect.arrayContaining([
        { name: 'privacy@wanderbite.com', href: 'mailto:privacy@wanderbite.com' },
        { name: 'support@wanderbite.com', href: 'mailto:support@wanderbite.com' },
        { name: 'Terms of Service', href: '/terms' },
      ]),
    );
    cleanup();

    const { container: rules } = renderReading(RulesLayout, RulesPage);
    expect(hrefsOf(rules)).toEqual(
      expect.arrayContaining([
        { name: 'support@wanderbite.com', href: 'mailto:support@wanderbite.com' },
        { name: 'Terms of Service', href: '/terms' },
        { name: 'Privacy Policy', href: '/privacy' },
      ]),
    );
  });
});
