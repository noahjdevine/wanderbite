import { isGooglePlacesOutboundDisabled } from '@/lib/restaurant-image';
import { lookupBriefingPlace } from '@/lib/briefings/places';
import {
  canonicalOfficialWebsite,
  discoverBriefingUrls,
  estimateMicrodollars,
  isStorableOfficialWebsite,
  mergeModelUsage,
  normalizeHttpsUrl,
  proposeOfficialFromUrls,
  type BriefingRestaurant,
  type ModelUsage,
} from '@/lib/briefings/research';

export type OfficialWebsiteProposal = {
  restaurantId: string;
  restaurantName: string;
  current: string | null;
  proposed: string | null;
  kind: 'places' | 'official' | 'unclassified' | 'none';
  placeId: string | null;
  placeIdToStore: string | null;
  units: ModelUsage;
  estimatedMicrodollars: number;
  notes: string[];
};

/**
 * Prefer Places websiteUri when the key is set. Otherwise, or when Places
 * has no storable https site, use the briefing web search and the same
 * host rules. Listing hosts are not proposed. A city token is not a name
 * match, a rejected host does not end the search, and a content path is stored
 * as the site root unless it is a chain location page.
 */
export async function proposeRestaurantWebsite(args: {
  restaurant: BriefingRestaurant;
  placesKey: string;
  anthropicKey: string;
  fetchImpl?: typeof fetch;
  outboundDisabled?: boolean;
}): Promise<OfficialWebsiteProposal> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const notes: string[] = [];
  let units: ModelUsage = {};
  const current = normalizeHttpsUrl(args.restaurant.officialWebsite);
  if (args.restaurant.officialWebsite && !current) {
    notes.push('Stored official_website is not an https URL and was left unchanged.');
  }
  const placesKey = args.placesKey.trim();
  const anthropicKey = args.anthropicKey.trim();
  const disabled = args.outboundDisabled ?? isGooglePlacesOutboundDisabled();
  let proposed: string | null = null;
  let kind: OfficialWebsiteProposal['kind'] = 'none';
  let placeId: string | null = null;
  let placeIdToStore: string | null = null;

  if (placesKey || disabled) {
    const places = await lookupBriefingPlace({
      restaurant: args.restaurant,
      apiKey: placesKey,
      fetchImpl,
      outboundDisabled: disabled,
      purpose: 'website',
      normalizeUrl: normalizeHttpsUrl,
      acceptWebsite: (url) =>
        isStorableOfficialWebsite(url, args.restaurant.name, args.restaurant.address),
    });
    units = mergeModelUsage(units, places.units);
    notes.push(...places.notes);
    placeId = places.placeId;
    placeIdToStore = places.placeIdToStore;
    if (places.officialWebsite) {
      proposed = canonicalOfficialWebsite(places.officialWebsite, args.restaurant.address);
      kind = 'places';
    }
  }

  if (!proposed && anthropicKey) {
    const search = await discoverBriefingUrls({
      restaurant: args.restaurant,
      apiKey: anthropicKey,
      fetchImpl,
    });
    units = mergeModelUsage(units, search.units);
    if (search.failure) notes.push(search.failure);
    else {
      notes.push(...search.warnings);
      const picked = proposeOfficialFromUrls(search.urls, args.restaurant.name, args.restaurant.address);
      if (picked.url) {
        proposed = picked.url;
        kind = picked.kind;
      } else {
        notes.push('Web search did not return an official host.');
      }
    }
  } else if (!proposed && !placesKey && !disabled) {
    notes.push('No GOOGLE_PLACES_API_KEY and no ANTHROPIC_API_KEY.');
  }

  return {
    restaurantId: args.restaurant.id,
    restaurantName: args.restaurant.name,
    current,
    proposed,
    kind,
    placeId,
    placeIdToStore,
    units,
    estimatedMicrodollars: estimateMicrodollars(units),
    notes,
  };
}
