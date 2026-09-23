# G13-B1 — password-reset request protection

G13-B stays **open**. B2 app code is merged; hosted evidence is tracked in `Docs/g13-b-hosted-evidence.md`. This document covers **new reset emails only**. Completing an already-issued `/auth/recovery` or `/reset-password` link is independent of these throttles and of `WANDERBITE_PASSWORD_RESET_DISABLED`.

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

Partner login and new issuance throttles were fail-closed in G13-B2 (PR #31). This B1 document does not describe those paths.

## Hosted evidence

Do not spam production. Fourth-request proof is Preview/Upstash only — see `Docs/g13-b-hosted-runbook.md`.

Operator dashboard (2026-09-19): custom SMTP Resend `smtp.resend.com:465`, sender `hello@wanderbite.co`, 60s per-user interval, 30 emails/hour. Application: 3/60m email digest + 20/60m IP digest.

- [x] Production SMTP / recovery throttle recorded (dashboard). SPF/DKIM and SMTP-credential validity remain **open**
- [x] Controlled plus-alias: Auth `/recover` 200 at 2026-09-22T19:26:40Z; operator received the link and completed a new-password sign-in (`last_sign_in_at` 19:28:53Z). Old-password rejection and Resend message ID **not** recorded
- [ ] Fourth normalized request denied without sending (controlled integration / Upstash, not prod inbox spam)
- [x] Mixed-case/padding sharing one email bucket: covered by unit tests only

Earlier production failures (not closes): `unavailable_ip_hash_secret` 2026-09-19T22:14:52Z; `unavailable_limiter` 2026-09-22T19:10:43Z. Operator then attached a new Upstash database and redeployed. Secret values are not recorded.

Onboarding `permission denied for table user_profiles` after recovery is a **separate** G2 write-path issue (`OnboardingWizard` → `updatePreferences`). It is not a B1 reset failure.
