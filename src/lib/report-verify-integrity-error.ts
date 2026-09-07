import * as Sentry from '@sentry/nextjs';

export function reportVerifyIntegrityError(detail: string): void {
  console.error('redemption verify data-integrity error:', detail);
  Sentry.captureException(new Error(detail), {
    tags: { feature: 'sec-04-verify', reason: 'duplicate-token-hash' },
  });
}
