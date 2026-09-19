# G13-B2 — partner login and new issuance throttles

G13-B stays **open** until all three are recorded:

1. B1 hosted reset/recovery evidence
2. B2 unit tests and preview/staging evidence
3. This PR merged and deployed

Do not start G13-C until that gate is closed.

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

## PIN rotation (operator, before closing G13-B)

bcrypt hashes cannot prove digit shape. Confirm or rotate every current partner PIN with the admin **Set PIN** control (4–6 digits). Empty PIN on create still means no portal login.

## Rollback

Exact lowercase `true` only. Default: unset.

| Flag | Freezes | Preserves |
| --- | --- | --- |
| `WANDERBITE_PARTNER_LOGIN_DISABLED` | New PIN sessions | Existing sessions; verify; reset; AI |
| `WANDERBITE_REDEMPTION_ISSUANCE_DISABLED` | New QR issuance | Already-issued replay; partner sessions; reset; AI; verify |
