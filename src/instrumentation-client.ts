import * as Sentry from '@sentry/nextjs';
import {
  sentryBeforeSend,
  sentryBeforeSendSpan,
  sentryBeforeSendTransaction,
} from '@/lib/sentry-scrub';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  beforeSend: sentryBeforeSend,
  beforeSendTransaction: sentryBeforeSendTransaction,
  beforeSendSpan: sentryBeforeSendSpan,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
