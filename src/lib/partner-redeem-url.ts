/** Public site base URL for partner scan links (QR codes). */
export function getPublicSiteBaseUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_BASE_URL?.trim() ||
    '';
  return base.replace(/\/$/, '');
}

export function buildPartnerRedeemScanUrl(slug: string, code: string): string {
  const normalized = code.trim().toUpperCase();
  const path = `/partner/${encodeURIComponent(slug)}/redeem?code=${encodeURIComponent(normalized)}`;
  const base = getPublicSiteBaseUrl();
  return base ? `${base}${path}` : path;
}
