export const FETCH_OUTCOMES = [
  'ok',
  'unchanged',
  'robots_disallowed',
  'http_error',
  'too_large',
  'timeout',
  'redirect_refused',
  'parse_error',
] as const;

export type FetchOutcome = (typeof FETCH_OUTCOMES)[number];

export type FetchFailure = {
  outcome: Exclude<FetchOutcome, 'ok' | 'unchanged'>;
  httpStatus: number | null;
  errorCode: string;
};

export function classifyMenuFailure(reason: string): FetchFailure {
  const lower = reason.toLowerCase();
  if (lower.includes('timed out')) return { outcome: 'timeout', httpStatus: null, errorCode: 'timeout' };
  if (lower.includes('exceeds size cap')) return { outcome: 'too_large', httpStatus: null, errorCode: 'too_large' };
  if (lower.includes('disallows')) {
    return { outcome: 'robots_disallowed', httpStatus: null, errorCode: 'robots_disallowed' };
  }
  if (lower.includes('redirect')) {
    return { outcome: 'redirect_refused', httpStatus: null, errorCode: 'redirect_refused' };
  }
  const status = /returned (\d{3})|unavailable \((\d{3})\)/.exec(reason);
  if (status?.[1] || status?.[2]) {
    const code = Number(status[1] ?? status[2]);
    return { outcome: 'http_error', httpStatus: code, errorCode: `http_${code}` };
  }
  if (
    lower.includes('pdf')
    || lower.includes('image')
    || lower.includes('non-html')
    || lower.includes('plain text')
    || lower.includes('no dishes')
  ) {
    return { outcome: 'parse_error', httpStatus: null, errorCode: 'parse_error' };
  }
  return { outcome: 'http_error', httpStatus: null, errorCode: 'request_failed' };
}

export function retryableFailure(outcome: FetchFailure['outcome']): boolean {
  return outcome === 'timeout' || outcome === 'http_error';
}
