# G12-A — report-only document CSP

Owner: **Noah** until reassigned.

This group ships document CSP in **report-only** mode and enforcing clickjacking protection via `X-Frame-Options: DENY`. Image `contentSecurityPolicy` in `next.config.ts` is not a document CSP and is unchanged.

## Hosted rollout record

| Field | Value |
| --- | --- |
| Owner | Noah until reassigned |
| First hosted report-only deployment | **2026-09-19 11:17 AM America/Chicago** — Vercel preview for PR #26 Ready (`wanderbite-git-fix-sec-08-report-o-a9220d-noah-devines-projects.vercel.app`). The G11 preview does **not** count. |
| Production deploy | Auto-deploy created **2026-09-19 11:18 AM America/Chicago** (merge of PR #26, `17a5e3f`). Merge status is not by itself a header proof. |
| Review / enforcement decision deadline | **2026-09-26** (America/Chicago). G12-B remains a separate later group. |
| D00 | May remain report-only with this record. |
| L00 | Requires tested **enforcing** document CSP (G12-B). Do not treat an indefinite soak as the default. |

### Verified on production (`https://www.wanderbite.co`)

Document GET/HEAD on **2026-09-19**: `/`, `/pricing`, `/roulette`, and `/partner` served `Content-Security-Policy-Report-Only`, **no** enforcing `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin`, and `Cross-Origin-Opener-Policy: same-origin`. `/` and `/pricing` omit `camera=()` / `microphone=()`. `/roulette` and `/partner` set `camera=(self), microphone=(self)`. Apex `https://wanderbite.co/` 307s to www without those document headers on the redirect itself.

### Remaining live verification (honest, still open)

- Nested production `/challenges/show/...` was not curl-checked (auth redirect likely).
- `POST /api/csp-report` was not exercised against hosted Redis (rate-limit / drop-on-outage / query stripping in production).
- Stripe Checkout/Portal **test-mode** redirects, maps, images, PostHog, and Sentry were not re-walked in a hosted browser after this deploy.
- CSP report volume and unexplained first-party violations have not been reviewed for the soak window.
- G12-B enforcement is **not** started by this record.

## Framing vs report-only CSP

`Content-Security-Policy-Report-Only` may include `frame-ancestors 'none'`, but report-only CSP **does not enforce** that directive. G12-A therefore sets **`X-Frame-Options: DENY`** on every document path. G12-A must not set an enforcing `Content-Security-Policy` header.

## First-party camera and microphone

Do not ship global `camera=()` or `microphone=()`. Global `Permissions-Policy` omits those features. Nested `/roulette`, `/challenges`, and `/partner` routes override `Permissions-Policy` to `camera=(self), microphone=(self)` so later voice and receipt work is not blocked. Permission prompts still require a user gesture in application code (E03/E07). Next.js last-matching-source wins for the same header key; tests cover `/partner/:slug/redeem` and `/challenges/show/:id`.

## Report intake

`POST /api/csp-report` rate-limits by IP, rejects bodies larger than 8 KiB, strips URLs to origin+pathname (no query/fragment), and never stores raw reports. In production, missing or failing Redis **drops** reports rather than collecting them unbounded. This is not a public raw-report collection service.

Do not put `api.anthropic.com` (or other server-only model providers) in `connect-src`. Anthropic stays server-side.

Development-only `connect-src` extras (`ws://localhost:3000`, `ws://127.0.0.1:3000`) are applied when `NODE_ENV === 'development'` and must not appear in production builds.

## Review and G12-B enforcement criteria

Before switching off report-only:

1. Hosted soak start and decision deadline are recorded above (2026-09-19 11:17 AM / 2026-09-26 America/Chicago). Complete the remaining live verification items before enforcing.
2. Unexplained first-party violations are fixed without blanket `*` / `'unsafe-eval'` (full) / unbounded `https:` allowlists.
3. Text, microphone, camera, upload previews, maps, Stripe test checkout/portal redirects, Supabase auth, PostHog, and Sentry are re-checked on nested partner and challenge routes.
4. Enforcing CSP is a **separate** PR (G12-B) with its own rollback (`X-Frame-Options: DENY` stays if CSP enforcement is reverted).
5. Recheck this inventory after E03/E07/E08 and any approved Atmosfy embed.

## Assignment callers (P00, unchanged here)

G12-A does not change challenge generation. Current callers remain:

- Monthly cron `GET /api/cron/issue-monthly-challenges` calls `generateMonthlyChallengeForUser`.
- Dashboard **Generate** button calls `generateMonthlyChallenge`.
- `/challenges` read path (`getCurrentChallengeForUser`) does **not** generate.
- Stripe webhook does not assign restaurants.

Capacity remains a read-time count in generate/swap (E02). Offers are not snapshotted (E01). QR issuance is not verified completion (E07).

## Rollback

Remove the G12-A header sources and `/api/csp-report` route, or revert the G12-A commit. Checkout stays fail-closed (`CHECKOUT_ENABLED === 'true'` only). Billing portal access is unrelated to these headers.

## Checkout

Keep `CHECKOUT_ENABLED` fail-closed. Portal/billing navigation is allowed in `form-action` for `https://checkout.stripe.com` and `https://billing.stripe.com` so test-mode redirects still work when checkout is later enabled.
