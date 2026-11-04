import { describe, expect, it } from 'vitest';
import { MENU_FETCH_USER_AGENT } from '@/lib/recipes/menu-fetch';
import { robotsAllowsPath } from '@/lib/recipes/menu-robots';

describe('robots.txt', () => {
  it('allows a path when robots.txt does not mention it', () => {
    expect(robotsAllowsPath('User-agent: *\nDisallow:\n', '/mckinney-menu/', MENU_FETCH_USER_AGENT)).toBe(true);
  });

  it('disallows a menu path for every agent', () => {
    const text = 'User-agent: *\nDisallow: /mckinney-menu\n';
    expect(robotsAllowsPath(text, '/mckinney-menu/', MENU_FETCH_USER_AGENT)).toBe(false);
  });

  it('lets a longer Allow beat a site-wide Disallow', () => {
    const text = 'User-agent: *\nDisallow: /\nAllow: /mckinney-menu\n';
    expect(robotsAllowsPath(text, '/mckinney-menu/', MENU_FETCH_USER_AGENT)).toBe(true);
    expect(robotsAllowsPath(text, '/private', MENU_FETCH_USER_AGENT)).toBe(false);
  });

  it('uses the Wanderbite agent group instead of the star group', () => {
    const text = [
      'User-agent: *',
      'Allow: /lunch',
      '',
      'User-agent: WanderbiteMenuDraftBot',
      'Disallow: /lunch',
    ].join('\n');
    expect(robotsAllowsPath(text, '/lunch', MENU_FETCH_USER_AGENT)).toBe(false);
  });
});
