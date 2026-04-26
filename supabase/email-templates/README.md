# Wanderbite × Supabase auth email templates

Branded HTML for **Authentication → Email templates** in the Supabase Dashboard. Files are **reference copies**; Supabase does not read this folder automatically—you paste the HTML into the dashboard.

## Prerequisites

- **Site URL** and **redirect URLs** configured under **Authentication → URL Configuration** for your app (e.g. `https://wanderbite.co`).
- **Email change**: Users only receive the change-email template if email change confirmation is enabled in your Auth settings (Supabase may require confirming the new address before switching—confirm in **Authentication → Providers → Email** / project auth config for your version).

## Deploy (Dashboard)

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project → **Authentication** → **Email Templates**.
2. For each row below, open the matching template, paste the **full** contents of the file into the editor, set the **Subject** to the recommended line (or your variant), then **Save**.
3. Send a real test (signup, magic link, reset, email change) and check **Gmail** and **Outlook** if possible.

| Supabase UI label | File | Recommended subject |
|-------------------|------|---------------------|
| **Confirm signup** | `confirm-signup.html` | `One click — then dinner gets interesting` *(or your chosen variant from product)* |
| **Magic Link** | `magic-link.html` | `Your Wanderbite sign-in link is ready` |
| **Reset password** | `reset-password.html` | `Forgot your password? We've got you.` |
| **Change email address** | `change-email.html` | `Confirm your new Wanderbite email` |

### Template variables (Supabase Go templates)

Verified against [Auth email templates](https://supabase.com/docs/guides/auth/auth-email-templates):

| Variable | Confirm signup | Magic link | Reset password | Change email |
|----------|----------------|------------|----------------|--------------|
| `{{ .ConfirmationURL }}` | ✓ | ✓ | ✓ | ✓ |
| `{{ .SiteURL }}` | ✓ | ✓ | ✓ | ✓ |
| `{{ .Email }}` | ✓ | ✓ | ✓ | ✓ (original / current address) |
| `{{ .NewEmail }}` | — | — | — | ✓ (new address) |
| `{{ .Token }}` | ✓ | ✓ | ✓ | ✓ |

If Supabase changes variable names in a future release, re-check the official docs above.

## Custom “From” address (recommended, not blocking)

Transactional mail still ships from Supabase’s shared domain (**e.g. `noreply@mail.app.supabase.io`**) until you add **custom SMTP** under **Project Settings → Authentication → SMTP**.

Good providers: **Resend**, **Postmark**, **SendGrid**. Configure **SPF/DKIM** for your domain so you can send from `hello@wanderbite.com` or `noreply@wanderbite.com` (or your live domain).

## Files in this folder

- `confirm-signup.html` — Welcome / confirm email (adventurous voice).
- `magic-link.html` — Passwordless sign-in; mentions ~**1 hour** link expiry (typical Supabase magic-link behavior—confirm **JWT expiry** / OTP settings in your project if you need exact copy).
- `reset-password.html` — Calm reset flow; **stronger** “didn’t request” block for phishing clarity.
- `change-email.html` — Confirms **{{ .NewEmail }}**; footer links to **`{{ .SiteURL }}/contact`** for suspicious activity. Ensure `/contact` exists on your deployed Site URL (Wanderbite uses a contact page).

## Logo in emails

Templates use `https://wanderbite.co/Wanderbite-logo.svg`. Some clients render remote SVG poorly; for maximum compatibility, host a **~200px PNG** on your CDN/site and swap the `img src` in all templates to match.
