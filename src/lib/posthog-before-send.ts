import type { CaptureResult } from 'posthog-js';
import { originPathnameOnly } from '@/lib/sensitive-url';

/** PostHog URL properties. `$referring_domain` is intentionally omitted. */
export const POSTHOG_URL_PROPERTIES = [
  '$current_url',
  '$referrer',
  '$initial_referrer',
  '$initial_current_url',
  '$session_entry_url',
] as const;

const URL_PROPERTY_SET = new Set<string>(POSTHOG_URL_PROPERTIES);

function scrubPropertyMap(properties: Record<string, unknown> | undefined): void {
  if (!properties) return;
  for (const key of URL_PROPERTY_SET) {
    if (key in properties) {
      properties[key] = originPathnameOnly(properties[key]);
    }
  }
}

export function currentOriginPathname(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${window.location.pathname}`;
}

export function scrubPosthogCapture(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  scrubPropertyMap(event.properties);
  scrubPropertyMap(event.$set);
  scrubPropertyMap(event.$set_once);
  return event;
}

export function posthogBeforeSend(event: CaptureResult | null): CaptureResult | null {
  return scrubPosthogCapture(event);
}
