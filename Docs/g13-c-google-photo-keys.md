# G13-C — Google photo key and URL cleanup

G13-C stays **open** after this app and grant change. It closes only when the old Places key is revoked and the public `restaurant-photos` objects have an approved disposition. This file does not rotate keys or change production rows.

Checkout stays fail-closed. The $1.00 paid / $0.20 free monthly AI ceilings are unchanged.

## What this change does

- Anon and authenticated lose `SELECT` on `restaurants.image_url` and `restaurants.google_photo_url`, including any table-level `SELECT` that would override a column revoke.
- `restaurants_public` keeps both column names and returns `NULL::text` for each. The view does not read the base columns. `security_invoker` stays.
- Service role can still read the stored values. App responses pass only a `/images/…` path or a place id.
- Legacy Place Photos stay request-time. Credit and bytes come from the same photo. The proxy does not redirect to `image_url`.
- `refresh-restaurant-photos` is not scheduled and does not upload bytes.

## Counts before rollout

Run this read-only query and keep the counts. Do not print URL text.

```sql
select
  count(*) filter (where google_photo_url is not null) as photo_url_set,
  count(*) filter (
    where image_url ~* '(^|[?&])key='
      or image_url ilike '%maps.googleapis.com/maps/api/place/photo%'
  ) as image_url_key_or_place_photo,
  count(*) filter (
    where image_url ilike '%/storage/v1/object/public/restaurant-photos/%'
  ) as image_url_rehosted
from public.restaurants;
```

**Recorded baseline (hosted, 2026-09-23):**


| Column / filter                                                      | Count |
| -------------------------------------------------------------------- | ----- |
| `google_photo_url` not null (`photo_url_set`)                        | 24    |
| `image_url` key or Place Photo URL (`image_url_key_or_place_photo`)  | 18    |
| `image_url` public `restaurant-photos` bucket (`image_url_rehosted`) | 6     |


These filters overlap per row (one restaurant can match more than one). They are not three disjoint buckets.

Do not apply a nulling `UPDATE` from this change. That is a separate approval after these counts.

## Ship order

1. Deploy the app.
2. Run `npx supabase db push --linked --yes` only after the counts above are recorded and you confirm the push. Then `npm run types:db`.
3. Hosted check, as anon and authenticated: `has_table_privilege` for table-level `SELECT` is false, `has_column_privilege` for both photo columns is false, and a Data API select of `image_url,google_photo_url` does not return stored values. Service role can still read them.
4. Set a Google Cloud Places quota and budget alert before relying on the proxy in production. Application limits are 60 requests / 10 minutes per IP digest and 300 / 10 minutes global. Missing Redis, a missing IP, or a deny returns the placeholder and does not call Places.
5. Key restriction and rotation stay later: replacement key restricted to Places APIs, no HTTP-referrer restriction, no IP restriction, preview then production, then revoke the old key.

## Rollback

Set `WANDERBITE_GOOGLE_PLACES_OUTBOUND_DISABLED=true`. Cards use a `/images` path or the placeholder. Do not restore the previous app.