import type { ReactNode } from 'react';

/**
 * Night intro and cream sheet for /contact, /privacy, /terms, and /rules.
 * The class lives in wanderbite-theme.css so privacy and terms page sources
 * can stay byte-for-byte the attested LEGAL_CONTENT_ID.
 */
export function ReadingFrame({ children }: { children: ReactNode }) {
  return <div className="wb-reading">{children}</div>;
}
