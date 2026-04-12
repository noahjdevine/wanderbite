/**
 * Slug-specific partner routes inherit chrome from `app/partner/layout.tsx`.
 * This layout exists so `/partner/[slug]` stays grouped with the partner app.
 */
export default function PartnerSlugLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
