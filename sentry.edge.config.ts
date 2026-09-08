import * as Sentry from '@sentry/nextjs';
import {
  sentryBeforeSend,
  sentryBeforeSendSpan,
  sentryBeforeSendTransaction,
} from '@/lib/sentry-scrub';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1,
  beforeSend: sentryBeforeSend,
  beforeSendTransaction: sentryBeforeSendTransaction,
  beforeSendSpan: sentryBeforeSendSpan,
});
