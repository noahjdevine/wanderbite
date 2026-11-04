/** Exact string only. Unset, empty, and every other value keep the stream route off. */
export const DISCOVER_STREAM_FLAG = 'DISCOVER_STREAM_ENABLED';

export function discoverStreamEnabled(
  value: string | undefined = process.env.DISCOVER_STREAM_ENABLED,
): boolean {
  return value === 'true';
}
