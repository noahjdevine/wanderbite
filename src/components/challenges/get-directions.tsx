import { MapPin } from 'lucide-react';
import { CtaButton } from '@/components/wb/cta-button';

type GetDirectionsLinkProps = {
  href: string;
};

/** Outline control for a Google Maps search. Render only when coordinates exist. */
export function GetDirectionsLink({ href }: GetDirectionsLinkProps) {
  return (
    <CtaButton
      href={href}
      variant="secondary-cream"
      creamStyle="outline"
      target="_blank"
      rel="noopener noreferrer"
      className="min-h-11 w-full"
    >
      <MapPin className="size-4 shrink-0" aria-hidden />
      Get directions
      <span className="sr-only"> (opens in Google Maps)</span>
    </CtaButton>
  );
}
