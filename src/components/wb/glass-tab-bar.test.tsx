import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BookOpen, Compass, Target, Trophy } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import { GlassTabBar } from '@/components/wb/glass-tab-bar';

const GALLERY_ITEMS = [
  { href: '/roulette', label: 'Discover', icon: Compass },
  { href: '/challenges', label: 'Challenges', icon: Target },
  { href: '/journey', label: 'Progress', icon: Trophy },
  { href: '/passport', label: 'Passport', icon: BookOpen },
] as const;

describe('GlassTabBar gallery default', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps plain anchors, the Main name, and one current tab', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/components/wb/glass-tab-bar.tsx'), 'utf8');
    expect(source).not.toContain('next/link');
    expect(source).toContain('linkComponent ?? "a"');

    render(<GlassTabBar className="absolute inset-x-0 bottom-0" activeHref="/challenges" items={GALLERY_ITEMS} />);

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(nav.className).toContain('wb-tabbar');
    expect(nav.className).toContain('absolute');
    expect(nav.className).not.toContain('wb-member-tabbar');

    const links = Array.from(nav.querySelectorAll('a'));
    expect(links).toHaveLength(4);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/roulette',
      '/challenges',
      '/journey',
      '/passport',
    ]);
    expect(links.map((link) => link.textContent)).toEqual(['Discover', 'Challenges', 'Progress', 'Passport']);
    expect(links.every((link) => link.tagName === 'A')).toBe(true);
    expect(links.every((link) => link.dataset.nextLink == null)).toBe(true);

    const current = links.filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute('href')).toBe('/challenges');
    expect(current[0]?.className).toContain('font-bold');
    expect(current[0]?.className).toContain('text-wb-blush');
    expect(links[0]?.className).toContain('font-medium');
    expect(links[0]?.className).toContain('text-white/75');
    expect(links[0]?.className).toContain('min-h-11');
    expect(links[0]?.getAttribute('aria-current')).toBeNull();
  });
});
