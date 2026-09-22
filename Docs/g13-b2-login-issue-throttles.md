# G13-B2 — partner login and new issuance throttles

G13-B stays **open** until hosted evidence in `Docs/g13-b-hosted-evidence.md` is complete. B2 **app** merge (#31, `f2629b0`) is not enough.

Do not start G13-C until that gate is closed. G13-C photo-off is a **pending** product decision, not approved.

## Login

Shape-check UUID and 4–6 digit PIN **before** Redis, restaurant lookup, or bcrypt. Leading zeros are kept as strings (`0042`). Both limiters must succeed:

| Limiter | Window | Key |
| --- | --- | --- |
| Restaurant + IP | 5 / 15 minutes | `restaurant:{uuid}:ip:{digest}` |
| Aggregate IP | 30 / 15 minutes | `ip:{digest}` |

Client retry copy is generic for both exhausted buckets and infrastructure failure. Ops events are distinct: `partner_login_rate_limited` vs `partner_login_limiter_unavailable`.

`WANDERBITE_PARTNER_LOGIN_DISABLED=true` freezes **new** PIN sessions. Existing cookies still work.

## Issuance

Already-issued code replay runs **before** the freeze and limiter. New `issue_challenge_redemption` is 3 / 5 minutes per user UUID, URL+token Redis, 1.5s timeout.

`WANDERBITE_REDEMPTION_ISSUANCE_DISABLED=true` freezes **new** QR issuance only. Replay still works. Do not unset the shared Redis token to freeze this path.

Member-visible RPC/throw errors are the generic issuance message. Business outcomes (`forbidden`, `not_assigned`, `not_found`, already redeemed) stay.

## Hosted evidence (B2)

Runbook: `Docs/g13-b-hosted-runbook.md`. Prefer Preview. Two production `/partner` successes max.

- [ ] Invalid UUID/PIN never hits Redis (Preview + Upstash console)
- [ ] 6th restaurant+IP login denied (`partner_login_rate_limited`)
- [ ] 31st aggregate-IP login denied (Preview only)
- [ ] Issuance deny: pre-seed three limiter hits, then one still-assigned item, **no** RPC
- [ ] Already-issued replay works after limiter exhaustion and under `WANDERBITE_REDEMPTION_ISSUANCE_DISABLED=true`
- [ ] Login kill switch blocks new PIN sessions; existing cookie works; flags left **unset**
- [ ] Two live `/partner` logins after PIN rotation (operator; PINs stay in the password manager)

## PIN rotation (operator)

bcrypt hashes cannot prove digit shape or uniqueness. Rotation used `/admin` Set PIN (4–6 digits via `parsePartnerPin`). Empty PIN on create still means no portal login.

Re-checked 2026-09-22 20:40 UTC vs baseline 2026-09-19T22:13:30.711661Z: **24/24** active still present (Hutchins duplicate **not** deleted), 24 fingerprints changed, 0 unchanged, 24 distinct `restaurant.pin_set` rows for actor `aa46493a-f4e8-445a-a3e9-5cb8a8210106` from 19:51:15Z to 19:52:09Z. No PIN values recorded.

## Rollback

Exact lowercase `true` only. Default: unset.

| Flag | Freezes | Preserves |
| --- | --- | --- |
| `WANDERBITE_PARTNER_LOGIN_DISABLED` | New PIN sessions | Existing sessions; verify; reset; AI |
| `WANDERBITE_REDEMPTION_ISSUANCE_DISABLED` | New QR issuance | Already-issued replay; partner sessions; reset; AI; verify |
