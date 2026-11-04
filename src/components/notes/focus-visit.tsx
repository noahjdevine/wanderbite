'use client';

import { useEffect } from 'react';

/** After the editor closes, move focus to the visit named in the URL hash. */
export function FocusVisitFromHash() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith('#visit-')) return;
    const el = document.getElementById(hash.slice(1));
    if (!(el instanceof HTMLElement)) return;
    el.scrollIntoView?.({ block: 'center' });
    el.focus();
  }, []);

  return null;
}
