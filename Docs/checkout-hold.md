# Checkout hold (G0)

Paid membership Checkout is **fail-closed**.

## `CHECKOUT_ENABLED`

| Value | Effect |
| --- | --- |
| unset, empty, `false`, `TRUE`, `1`, `true ` (trailing space), or any other string | `createCheckoutSession` returns “Checkout is unavailable.” Stripe Checkout is not called. |
| exact string `true` | Checkout Sessions may be created (still requires a signed-in user and `STRIPE_PRICE_ID`). |

Safe default: **do not set the variable** in production until the unfreeze gate is complete.

## Re-freeze

To freeze Checkout again after a temporary enable:

- Remove `CHECKOUT_ENABLED` from the environment, **or**
- Set `CHECKOUT_ENABLED` to **anything except the exact lowercase string `true`**.

Examples that re-freeze: unset, empty, `false`, `TRUE`, `1`, `true `.

Redeploy or restart the process so the new value is loaded. Confirm with a signed-in non-subscriber that `createCheckoutSession` returns “Checkout is unavailable.” and no Stripe Checkout Session is created.

## Environment strategy

- Production: checkout disabled. Do not set `CHECKOUT_ENABLED=true` in production until the unfreeze gate is complete.
- Local/preview: checkout may be enabled only with Stripe test-mode keys, a test Price, and test webhook configuration.
- Never use Stripe live keys for preview E2E testing.

## What stays available while frozen

- Account signup and sign-in (signup shows early-access copy; account creation is not blocked)
- Onboarding preferences/profile (does **not** start Stripe)
- `/challenges` for members with `subscription_status = active`
- `/billing` and the Stripe Customer Portal (`createBillingPortalSession`) so **active** subscribers can cancel

Inactive `/billing` does not show a portal button and does not claim that the user can manage or cancel from that page.

## What is not collected

Launch-hold UI is static “Launching soon” copy. Signup is early-access messaging only. No waitlist table, no extra email capture form.

## Production verification

1. Confirm Vercel does **not** have `CHECKOUT_ENABLED=true`.
2. Signed-in non-subscriber: pricing, onboarding, dashboard paywall, and club CTAs show Launching soon and do not redirect to Stripe.
3. Call `createCheckoutSession` (or click a former pay CTA): no Checkout Session is created.
4. Active subscriber: `/challenges` loads; `/billing` → Manage Subscription still opens the Stripe portal.
5. Inactive `/billing`: hold copy only; no manage/cancel portal button.
6. Public pages must not advertise a $120 annual plan or monthly/annual toggle.
7. `/signup` still creates accounts and shows: “You're creating an early-access WanderBite account. Founding memberships are opening soon.”
