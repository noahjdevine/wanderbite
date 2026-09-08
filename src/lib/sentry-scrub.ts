import type { ErrorEvent, EventHint, SpanJSON, TransactionEvent } from '@sentry/core';
import { isUrlShaped, originPathnameOnly } from '@/lib/sensitive-url';

const BREADCRUMB_URL_KEYS = ['url', 'to', 'from'] as const;
const SPAN_URL_KEYS = ['http.url', 'url', 'http.target', 'http.request.url'] as const;

export type SentryRequestLike = {
  url?: string;
  query_string?: unknown;
};

export type SentryBreadcrumbLike = {
  data?: Record<string, unknown>;
};

export type SentryEventLike = {
  request?: SentryRequestLike;
  transaction?: string;
  breadcrumbs?: SentryBreadcrumbLike[];
};

export type SentrySpanLike = {
  description?: string;
  data?: Record<string, unknown>;
};

function scrubKnownUrlField(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (!isUrlShaped(value) && !/^https?:\/\//i.test(value)) return value;
  return originPathnameOnly(value);
}

export function scrubSentryEvent<T extends SentryEventLike>(event: T): T {
  if (event.request) {
    if (typeof event.request.url === 'string') {
      event.request.url = originPathnameOnly(event.request.url) as string;
    }
    if (event.request.query_string !== undefined) {
      event.request.query_string = '';
    }
  }

  if (typeof event.transaction === 'string' && isUrlShaped(event.transaction)) {
    event.transaction = originPathnameOnly(event.transaction) as string;
  }

  if (event.breadcrumbs) {
    for (const crumb of event.breadcrumbs) {
      if (!crumb.data) continue;
      for (const key of BREADCRUMB_URL_KEYS) {
        if (key in crumb.data) {
          crumb.data[key] = scrubKnownUrlField(crumb.data[key]);
        }
      }
    }
  }

  return event;
}

export function scrubSentrySpan<T extends SentrySpanLike>(span: T): T {
  if (typeof span.description === 'string' && isUrlShaped(span.description)) {
    span.description = originPathnameOnly(span.description) as string;
  }
  if (span.data) {
    for (const key of SPAN_URL_KEYS) {
      if (key in span.data) {
        span.data[key] = scrubKnownUrlField(span.data[key]);
      }
    }
  }
  return span;
}

export function sentryBeforeSend(event: ErrorEvent, _hint?: EventHint): ErrorEvent {
  return scrubSentryEvent(event);
}

export function sentryBeforeSendTransaction(
  event: TransactionEvent,
  _hint?: EventHint,
): TransactionEvent {
  return scrubSentryEvent(event);
}

export function sentryBeforeSendSpan(span: SpanJSON): SpanJSON {
  return scrubSentrySpan(span);
}
