import { describe, it, expect, vi } from 'vitest';
import {
  CHECKOUT_UNAVAILABLE_MESSAGE,
  isCheckoutEnabled,
} from './checkout-enabled';

describe('isCheckoutEnabled', () => {
  it('is true only for the exact string true', () => {
    expect(isCheckoutEnabled('true')).toBe(true);
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['false', 'false'],
    ['TRUE', 'TRUE'],
    ['True', 'True'],
    ['1', '1'],
    ['yes', 'yes'],
    [' true', ' true'],
    ['true ', 'true '],
  ])('is false for %s', (_label, value) => {
    expect(isCheckoutEnabled(value)).toBe(false);
  });

  it('reads CHECKOUT_ENABLED from the environment when no argument is passed', () => {
    vi.stubEnv('CHECKOUT_ENABLED', 'true');
    expect(isCheckoutEnabled()).toBe(true);
    vi.stubEnv('CHECKOUT_ENABLED', 'false');
    expect(isCheckoutEnabled()).toBe(false);
    vi.stubEnv('CHECKOUT_ENABLED', '');
    expect(isCheckoutEnabled()).toBe(false);
  });
});

describe('CHECKOUT_UNAVAILABLE_MESSAGE', () => {
  it('is a generic message that does not mention configuration', () => {
    expect(CHECKOUT_UNAVAILABLE_MESSAGE).toBe('Checkout is unavailable.');
    expect(CHECKOUT_UNAVAILABLE_MESSAGE.toLowerCase()).not.toContain('checkout_enabled');
  });
});
