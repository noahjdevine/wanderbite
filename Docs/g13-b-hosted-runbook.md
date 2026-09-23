# G13-B remaining hosted checks — Preview / Upstash runbook

Use **Preview** (or a disposable Upstash namespace) unless a check explicitly needs production. Do not spam production inboxes. Do not paste PINs, passwords, recovery URLs, Redis tokens, or SMTP credentials.

You run the clicks and Upstash console steps. I can re-read Auth/Vercel logs and SQL **after** you say a check is done, and I can confirm ops event **names** without secret values.

Kill switches are exact lowercase `true`. Leave them **unset** when finished.

## B1 — fourth normalized-request denial

**Goal:** fourth request for the same normalized email is denied **before** `resetPasswordForEmail`. Do **not** send four live production emails.

App limits: 3 / 60 minutes per email digest; 20 / 60 minutes per IP. Prefixes: `wanderbite:password-reset-email`, `wanderbite:password-reset-ip`. Identifier is the HMAC digest, never the raw email.

### You

1. Use the **Preview** deployment and the Upstash database attached to Preview (not production mail if you can avoid it).
2. Preferred: in Upstash, pre-seed **three** successful hits on `wanderbite:password-reset-email` for one test digest, **or** submit three Preview forgot-password requests for a Preview-only plus-alias you control, waiting **≥60 seconds** between submits (Supabase per-user interval).
3. Fourth Preview submit for that same address.
4. Confirm Resend (or Preview mail) has **no** fourth send.

If you cannot pre-seed, stop after three Preview sends and tell me — do not add a fourth production send.

### Expected

- UI: generic unavailable (“Unable to send a reset email right now…”), not the “check your email” success card.
- Vercel Preview log: `[password-reset] unavailable_limiter` only on the fourth call.
- No new `user_recovery_requested` / `/recover` Auth event for that fourth submit.
- No fourth Resend message.

### I can verify after you ping

- Preview/production runtime log presence of `unavailable_limiter` (name only).
- Auth `auth_logs` count of `/recover` around that time (no email dump).
- I cannot see Upstash keys without your console.

Mixed-case/padding sharing one email bucket remains **unit-tested only**.

## B1 — leftover recovery checks (minimal, production already used)

Do **not** send another production reset unless the items below still fail.

| Check | Who | How | Do not |
| --- | --- | --- | --- |
| Resend SPF/DKIM | You | Resend domain dashboard for `wanderbite.co` | Paste DNS secrets |
| SMTP password still valid | You | Supabase Auth SMTP still connected; Resend key not revoked | Paste the password |
| Old password rejected | You | Sign out; try the **old** password once; report pass/fail | Paste either password |
| Resend row for the successful send | You | Timestamp, plus-alias recipient, message ID, accepted/delivered/bounced | API keys |

I can confirm Auth recover/login timestamps already recorded in `Docs/g13-b-hosted-evidence.md`. I will not invent a Gmail arrival time.

## B2 — partner login (Preview preferred)

Limits: 5 / 15 minutes per `restaurant:{uuid}:ip:{digest}`; 30 / 15 minutes per `ip:{digest}`. Prefixes: `wanderbite:partner-login-restaurant-ip`, `wanderbite:partner-login-ip`. Shape-check UUID and 4–6 digit PIN **before** Redis.

Use `/partner/{slug}` (not `/partner`). PINs live only in your password manager.

Suggested coverage restaurants (ids, not secrets):

- `1117` — `a3db02b6-00b7-4f42-9a66-06720c12916d`
- `bobs-steak-chop-house` — `cc871be6-21a8-46ed-9f51-70e332cb6ee6`

Hutchins pair if you need a third later: `hutchins-bbq` vs `hutchins-bbq-2` (different ids, same street). Only **two** live successes are required for close.

### You

1. **Malformed:** restaurant id `not-a-uuid` and/or PIN `12ab` / `123`. Expect generic login failure. In Upstash, no new `wanderbite:partner-login-*` key for that attempt.
2. **Two live successes:** correct PIN for two restaurants. Stop at two so the 5/15m restaurant+IP bucket stays usable.
3. **6th restaurant+IP deny:** same restaurant, same client IP, six attempts (can be wrong PIN after two successes, or Preview-only). 6th is generic failure. Log name `partner_login_rate_limited`. Wait 15 minutes or use another restaurant rather than burning production.
4. **31st aggregate IP:** only on Preview. 31 attempts from one IP across restaurants. Expect `partner_login_rate_limited`. This will lock that Preview IP for 15 minutes.
5. **Login freeze:** Preview env `WANDERBITE_PARTNER_LOGIN_DISABLED=true`, redeploy/wait. New PIN login fails; an already-open partner cookie still works. Then **unset** the flag and redeploy.

### Expected vs I verify

- You: UI generic errors; Upstash no key on malformed input; two slugs signed in.
- I: after you ping, search Preview logs for `partner_login_rate_limited` / `partner_login_limiter_unavailable` (names only). I will not test every PIN.

## B2 — new issuance (Preview, disposable member)

Limit: 3 / 5 minutes per **user UUID** (`evaluateRedemptionIssueLimit`). Prefix `wanderbite:redemption-issue`. Replay of an already-issued item runs **before** the limiter and freeze.

**Do not** issue four times on one item. The first success marks it `redeemed`; later calls replay and never prove the 3/5m deny.

### You

1. Pick a Preview (or throwaway) member with a **still-assigned** challenge item (status not redeemed).
2. In Upstash, pre-seed **three** successful `wanderbite:redemption-issue` hits for that user’s UUID, **or** I can confirm a log-only dry description if you paste a sanitized “pre-seeded 3” note — do not paste the UUID into a public ticket if you can avoid it.
3. Trigger **one** new issuance on the still-assigned item.
4. Confirm generic member message; no new row from `issue_challenge_redemption`.
5. Replay: use an **already-issued** code; should succeed even after step 3 and with `WANDERBITE_REDEMPTION_ISSUANCE_DISABLED=true`.
6. Unset the freeze when done.

### Expected

- Log: `redemption_issue_rate_limited` on the pre-seeded call.
- No RPC on that deny.
- Replay still works under freeze and after limiter exhaustion.

### I can verify after you ping

- Preview log event names.
- SQL: item status still assigned on deny; redeemed item replay does not require a new RPC (no PIN/code values).

## Lockout avoidance

| Action | Risk | Mitigation |
| --- | --- | --- |
| Four production reset emails | Auth 30/hour + app 3/60m + inbox noise | Preview + pre-seed; never four prod sends |
| 6 partner tries on one restaurant | 15 minute restaurant+IP lock | Two successes max on production; extra tries on Preview |
| 31 IP tries | 15 minute IP lock | Preview only |
| Issuance freeze left on | Members cannot mint new QR | Unset after the test |
| Login freeze left on | New PIN sessions fail | Unset after the test |
| Shared production Redis | Preview tests eat production buckets | Keep Preview on its own Upstash as already configured |

When a check is done, reply with the checkbox id, UTC time, Preview vs Production, and pass/fail. I will append only that sanitized line to the evidence doc.
