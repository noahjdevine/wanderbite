# Checkout hold (G0)

Paid membership Checkout is **fail-closed**.

## `CHECKOUT_ENABLED`

| Value | Effect |
| --- | --- |
| unset, empty, `false`, `TRUE`, `1`, or any other string | `createCheckoutSession` returns “Checkout is unavailable.” Stripe Checkout is not called. |
| exact string `true` | Checkout Sessions may be created (still requires a signed-in user and `STRIPE_PRICE_ID`). |

Safe default: **do not set the variable** in production until the unfreeze gate is complete.

## What stays available while frozen

- Account signup and sign-in
- Onboarding preferences/profile (does **not** start Stripe)
- `/challenges` for members with `subscription_status = active`
- `/billing` and the Stripe Customer Portal (`createBillingPortalSession`) so existing subscribers can cancel

## What is not collected

Launch-hold UI is static “Launching soon” copy. No waitlist table, no email capture form.

## Production verification

1. Confirm Vercel does **not** have `CHECKOUT_ENABLED=true`.
2. Signed-in non-subscriber: pricing, onboarding, dashboard paywall, and club CTAs show Launching soon and do not redirect to Stripe.
3. Call `createCheckoutSession` (or click a former pay CTA): no Checkout Session is created.
4. Active subscriber: `/challenges` loads; `/billing` → Manage Subscription still opens the Stripe portal.
5. Public pages must not advertise a $120 annual plan or monthly/annual toggle.
