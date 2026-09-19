# G13-B1 — password-reset request protection

G13-B stays open until G13-B2. This document covers **new reset emails only**. Completing an already-issued `/auth/recovery` or `/reset-password` link is independent of these throttles and of `WANDERBITE_PASSWORD_RESET_DISABLED`.

## Request contract

| State | When | User-visible |
| --- | --- | --- |
| Validation | Empty, too long, or not a conservative `local@domain` | `Please enter a valid email address.` |
| Unavailable | Kill switch, missing Redis URL/token, missing/short IP-hash secret, untrusted client IP, limiter deny/timeout/throw, missing site URL, invalid recovery URL, or failure to construct the Supabase client **before** Auth | Generic retry |
| Dispatched | `resetPasswordForEmail` was invoked | Generic success, including unknown accounts, `{ error }`, and throw |

Do not return Auth `error.message`. Do not put raw email or IP in Redis keys. Email and IP identities are HMAC-style sha256 digests in `src/lib/ai-ip-hash.ts`.

## Limiters

| Identity | Window |
| --- | --- |
| Email digest | 3 / 60 minutes |
| IP digest | 20 / 60 minutes |
| Timeout | 1.5s |
| Combine | Both must succeed |

Redis requires URL **and** token (same fail-closed pattern as billable roulette). Parallel limiter calls may consume one counter if the other fails; that is accepted.

## Trusted IP

Production trusts only the first `x-forwarded-for` hop after Vercel overwrites the header. Values must pass `net.isIP` as IPv4 or IPv6. **No `x-real-ip` fallback.** Never store `"unknown"`. If Vercel Trusted Proxy is enabled later, revisit this.

Roulette uses the same helper so billable AI still fail-closes without a valid IP.

## Rollback

Set `WANDERBITE_PASSWORD_RESET_DISABLED=true` to freeze **new** reset emails. Do not revert to fail-open Redis or provider error leakage. Preview/production default: **unset**.

Partner login and redemption issuance stay on the legacy URL-only (fail-open) limiters until G13-B2.

## Hosted evidence (record after merge; do not spam production)

Confirm whether production Auth uses **custom SMTP** (Resend) vs default email, plus the dashboard recovery throttle. Supabase documents a default 60s recovery interval and a shared two-emails/hour default-service limit — confirm, don’t assume.

- [ ] Production SMTP / recovery throttle recorded
- [ ] One controlled-inbox reset delivers and recovery completes
- [ ] Fourth normalized request denied without sending (controlled integration / Upstash, not prod inbox spam)
- [ ] Mixed-case/padding sharing one email bucket: covered by unit tests only
