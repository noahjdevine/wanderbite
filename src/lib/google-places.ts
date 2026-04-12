export type PlaceSearchResult = {
  placeId: string | null;
  photoUrl: string | null;
};

/**
 * Find a Google Place and first photo URL from name + address.
 * Never throws — returns null fields on failure or missing key.
 */
export async function findRestaurantPlace(
  name: string,
  address: string
): Promise<PlaceSearchResult> {
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!key) {
    return { placeId: null, photoUrl: null };
  }

  const input = `${name} ${address}`.trim();
  if (!input) {
    return { placeId: null, photoUrl: null };
  }

  try {
    const params = new URLSearchParams({
      input,
      inputtype: 'textquery',
      fields: 'place_id,photos',
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
        photos?: { photo_reference?: string }[];
      }[];
    };

    if (data.status !== 'OK' || !data.candidates?.length) {
      return { placeId: null, photoUrl: null };
    }

    const first = data.candidates[0];
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
