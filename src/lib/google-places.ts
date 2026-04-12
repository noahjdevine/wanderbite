export type PlaceSearchResult = {
  placeId: string | null;
  photoUrl: string | null;
};

/** True if at least one significant word from the restaurant name appears in the place name (case-insensitive). */
function placeNameMatchesRestaurant(
  restaurantName: string,
  returnedPlaceName: string | null | undefined
): boolean {
  if (!returnedPlaceName?.trim()) return false;
  const placeLower = returnedPlaceName.toLowerCase();
  const words = restaurantName
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length >= 2);
  if (words.length === 0) return false;
  return words.some((w) => placeLower.includes(w));
}

/**
 * Find a Google Place and first photo URL for a restaurant in McKinney, TX.
 * Never throws — returns null fields on failure or missing key.
 */
export async function findRestaurantPlace(
  name: string,
  _address: string
): Promise<PlaceSearchResult> {
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!key) {
    return { placeId: null, photoUrl: null };
  }

  const trimmedName = name.trim();
  if (!trimmedName) {
    return { placeId: null, photoUrl: null };
  }

  const input = `${trimmedName} restaurant McKinney TX`;

  try {
    const params = new URLSearchParams({
      input,
      inputtype: 'textquery',
      fields: 'place_id,name,photos',
      locationbias: 'circle:50000@33.1984,-96.6397',
      key,
    });
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      return { placeId: null, photoUrl: null };
    }
    const data = (await res.json()) as {
      status?: string;
      candidates?: {
        place_id?: string;
        name?: string;
        photos?: { photo_reference?: string }[];
      }[];
    };

    if (data.status !== 'OK' || !data.candidates?.length) {
      return { placeId: null, photoUrl: null };
    }

    const first = data.candidates[0];
    const returnedName = first.name;

    if (!placeNameMatchesRestaurant(trimmedName, returnedName)) {
      return { placeId: null, photoUrl: null };
    }

    const placeId = first.place_id ?? null;
    const ref = first.photos?.[0]?.photo_reference;
    if (!ref) {
      return { placeId, photoUrl: null };
    }

    const photoParams = new URLSearchParams({
      maxwidth: '800',
      photo_reference: ref,
      key,
    });
    const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?${photoParams.toString()}`;
    return { placeId, photoUrl };
  } catch {
    return { placeId: null, photoUrl: null };
  }
}
