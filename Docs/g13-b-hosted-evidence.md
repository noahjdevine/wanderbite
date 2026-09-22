# G13-B hosted evidence (does not close the group)

Recorded 2026-09-22. This document is **not** a G13-B close. Unverified boxes stay open. Do not start G13-C from this file.

G13-C photo-off MVP remains a **pending product decision**, not approved.

Approved MVP enhancements and the **$1.00 paid / $0.20 free** monthly AI ceilings are unchanged. Checkout stays fail-closed.

Related: `Docs/g13-b1-password-reset.md`, `Docs/g13-b2-login-issue-throttles.md`, `Docs/g13-b-hosted-runbook.md`.

## Group status

| Gate | Status |
| --- | --- |
| B1 app PR | Merged ([#30](https://github.com/noahjdevine/wanderbite/pull/30)) and deployed |
| B2 app PR | Merged ([#31](https://github.com/noahjdevine/wanderbite/pull/31)) and deployed |
| B1 hosted reset/recovery | **Partial** — see below |
| B2 preview/staging throttles | **Open** |
| Two live `/partner` logins | **Open** |
| Evidence-closeout docs | This PR |
| G13-B closed | **No** |
| G13-C | **Blocked**; photo-off decision pending |

## Observed (sanitized)

### SMTP / Auth policy (operator dashboard, 2026-09-19)

- Custom SMTP: yes. Provider Resend (`smtp.resend.com`, port 465), sender `hello@wanderbite.co` / Wanderbite.
- Password-reset minimum interval per user: 60 seconds.
- Auth email-sending limit: 30 per hour (built-in two-per-hour / team-address limits do not apply).
- Application limits: 3 / 60 minutes per email digest; 20 / 60 minutes per IP digest.

Not recorded as verified:

- [ ] Resend dashboard: `wanderbite.co` SPF and DKIM verified
- [ ] Resend dashboard: SMTP credential stored in Supabase still valid / unrevoked

Successful inbox delivery is **not** a substitute for those two dashboard checks.

### Runtime configuration (names only)

Production Vercel, 2026-09-22: `WANDERBITE_IP_HASH_SECRET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and `NEXT_PUBLIC_BASE_URL` are present. `NEXT_PUBLIC_SITE_URL` is absent (recovery URL can use the base-URL fallback). Kill switches `WANDERBITE_PASSWORD_RESET_DISABLED`, `WANDERBITE_PARTNER_LOGIN_DISABLED`, and `WANDERBITE_REDEMPTION_ISSUANCE_DISABLED` are unset. Secret values were not read or recorded.

Operator: a missing IP-hash secret and a later `unavailable_limiter` were fixed by setting the hash secret, attaching a new Upstash database to Production and Preview, correcting Redis credentials, and redeploying. Credentials are not recorded here.

### B1 live attempts

| When (UTC) | Evidence | Outcome |
| --- | --- | --- |
| 2026-09-19T22:14:52Z | Production `POST /forgot-password` 200; log `[password-reset] unavailable_ip_hash_secret` | Generic unavailable. Auth **not** called. |
| 2026-09-22T19:10:43Z | Production `POST /forgot-password` 200; log `[password-reset] unavailable_limiter` | Generic unavailable. Auth **not** called. Old Upstash was archived. |
| 2026-09-22T19:26:40Z | Supabase `auth_logs`: `user_recovery_requested` `POST /recover` 200 | Auth accepted a recovery request (after Redis repair). WanderBite does not log a success event on dispatch. |
| 2026-09-22T19:28:05Z–19:28:53Z | `/verify` 303, `/token` 200, `user_modified` 200, `/logout` 204, `/token` 200 | Recovery session, password change, then a new login. Plus-alias `last_sign_in_at` = 2026-09-22 19:28:53 UTC. `recovery_sent_at` on that Auth user is still **null** (GoTrue did not persist that column). |
| 2026-09-22T19:45:59Z–19:46:29Z | Second `user_recovery_requested` `/recover` 200, then verify / modify / logout / login | Consistent with the operator’s admin-password reset. |

Operator (not independently timestamped here): the plus-alias inbox received a reset link; the link reached authenticated onboarding. The admin account was also reset and signed in with the new password.

Not established from logs (do not invent):

- [ ] Resend message ID / accepted-delivered-bounced row
- [ ] Exact inbox-arrival timestamp from Gmail/Resend
- [ ] Old password rejected after the change (`/token` 400 at 19:45:52Z is **not** attributed; it sits before the second recover)

### Partner PIN rotation (2026-09-22)

Re-checked 2026-09-22 20:40 UTC against the 2026-09-19T22:13:30.711661Z baseline.

| Check | Result |
| --- | --- |
| Active restaurants | **24** (duplicate Hutchins BBQ **not** deleted) |
| Active with non-null `pin_hash` | 24/24 |
| Fingerprints changed vs baseline | 24 |
| Fingerprints unchanged | 0 |
| Extra / missing restaurant IDs vs baseline | 0 / 0 |
| Distinct `restaurant.pin_set` targets after baseline | 24 |
| Audit row total | 24 |
| Actor | `aa46493a-f4e8-445a-a3e9-5cb8a8210106` |
| Audit window | 2026-09-22 19:51:15.580063+00 → 19:52:09.364113+00 |

Hutchins coverage by **id + address** (same street; deletion not confirmed):

| id | slug | address |
| --- | --- | --- |
| `154cefee-edf8-433e-8f48-75ac9dc3b752` | `hutchins-bbq-2` | 1301 N Tennessee St, McKinney, TX 75069, USA |
| `fe969b97-1172-4b7d-a32d-290c0bf1daac` | `hutchins-bbq` | 1301 N Tennessee St, McKinney, TX 75069 |

Set PIN saves support 4–6 digit `parsePartnerPin` shape. Hashes **do not** prove uniqueness or exact six-digit length. No PIN values are recorded.

- [ ] Two live `/partner` logins (pending). No `partner_login*` production runtime logs were found in the searched window.

### Separate: onboarding profile write (not a B1 pass/fail)

Plus-alias Auth user has **no** `user_profiles` row after recovery. `/onboarding` step 1 calls `updatePreferences`, which upserts through the signed-in client (G2 column grants; table-level `INSERT`/`UPDATE` remain revoked). `completeOnboarding` (service role) is unused by that wizard. Operator saw `permission denied for table user_profiles` and navigation between onboarding and account.

Keep this out of G13-B close criteria. Bounded follow-up: first-time onboarding create should use the existing admin-scoped everyday-column write, **not** a table-wide `GRANT INSERT/UPDATE`. Do not ship that fix in a docs PR.

## Still open (blocking G13-B close)

1. Resend SPF/DKIM dashboard check
2. Resend SMTP credential still valid (dashboard; do not paste it)
3. Fourth reset denied **before** `resetPasswordForEmail` (Preview/Upstash; no four production emails)
4. Old-password rejection after change (operator pass/fail only)
5. B2 Preview: invalid UUID/PIN never hits Redis
6. B2 Preview: 6th restaurant+IP login denied
7. B2 Preview: 31st aggregate-IP login denied
8. B2 Preview: issuance deny via three pre-seeded hits + still-assigned item, no RPC
9. B2 Preview: replay after limiter exhaustion and under issuance freeze
10. B2 Preview: login kill switch; flags left **unset**
11. Two `/partner` logins after PIN rotation (password manager; do not paste PINs)

Follow `Docs/g13-b-hosted-runbook.md`. After those results exist, update the checkboxes in a follow-up evidence commit. Do not treat this PR as the close.
