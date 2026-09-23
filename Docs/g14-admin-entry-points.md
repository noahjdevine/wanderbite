# G14 admin entry points

Local inventory for the admin MFA guard. This is not a release record and it does not confirm hosted Auth settings.

Protected by `assertAdmin` (current user, `user_profiles.role = 'admin'`, and the current session `currentLevel === 'aal2'`) before any service-role read or write of admin data:

| Path | After the guard |
| --- | --- |
| `src/app/(site)/admin/page.tsx` | Restaurants, user profile rows (including emails), and the latest audit entries. An AAL1 admin sees enrollment or a challenge instead, and this page does not load those rows. |
| `src/app/(site)/admin/actions.ts` | `addRestaurant`, `generateMissingSlugs`, `deleteRestaurant`, `setRestaurantPin` |
| `src/app/(site)/admin/actions-import.ts` | `attachGoogleMetadataToLatestRestaurantByName`, `searchRestaurantsFromGoogle`, `getRestaurantDetailsFromGoogle` |
| `src/app/(site)/admin/actions-places.ts` | `enrichSingleRestaurant`, `enrichAllRestaurants` |

`src/app/(site)/admin/mfa-actions.ts` is role-checked only. It enrolls or challenges the current admin and cannot read the dashboard or call the mutations above.

## Sensitive export

No sensitive export endpoint exists in this checkout. `src/` has no CSV download, `Content-Disposition` attachment, or admin export route. API routes present are:

- `src/app/api/csp-report/route.ts`
- `src/app/api/restaurant-image/[id]/route.ts`
- `src/app/api/roulette/route.ts`
- `src/app/api/webhooks/stripe/route.ts`
- `src/app/api/cron/stripe-reconcile/route.ts`
- `src/app/api/cron/webhook-outbox/route.ts`
- `src/app/api/cron/reset-swap-counters/route.ts`
- `src/app/api/cron/expire-issued-redemptions/route.ts`
- `src/app/api/cron/issue-monthly-challenges/route.ts`
- `src/app/api/cron/end-of-month-reminder/route.ts`
- `src/app/api/cron/refresh-restaurant-photos/route.ts`

None of those export admin users or audit data. Future offer, content, and export entry points must use the same `assertAdmin` guard.
