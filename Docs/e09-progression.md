# E09-A1 continuing progression

Pure helpers in `src/lib/progression/`. No migration. No UI change. No award write. Nothing in the app reads these modules yet. Journey still uses `levelFromXp` in `src/lib/progress/rules.ts`, which stops at The Local Legend. This does not claim E09, E07, or E02 acceptance.

## Schedule v1

`PROGRESSION_SCHEDULE_VERSION` is `v1`. Levels 1–4 are today's thresholds: Explorer 300, Tastemaker 1000, Connoisseur 1500, Local Legend 2500. Verified-visit XP stays `XP_PER_VERIFIED_VISIT` (100). After 2500 XP, each new level costs 1000 XP (10 verified visits), with no cap. Level 5 is The Local Legend II at 3500 XP. Level 6 is The Local Legend III at 4500 XP. Naming and step size are provisional and will be revisited. Both live on `PROGRESSION_SCHEDULE_V1`.

`levelForXp(xp, schedule)` works for any explicit level count. Under v1, `nextLevel` is never null. A schedule with `continuingStepXp` of 0 or less still caps at its last explicit level. `levelFromXp(2500)` is unchanged: `nextLevel` is null and progress is 100%.

## Milestones

`milestonesFromVerifiedVisits({ verifiedAtAsc, schedule })` returns one entry per level the visits have already reached, in level order:

- `reachedAt` is the original timestamp string of the visit whose running XP first met `minXp`. Running XP is 100 times the count of valid timestamps up to and including that visit.
- `quarterKey` is the America/Chicago calendar quarter of that instant, such as `2026-Q4`. It uses the event time, not the time the helper runs.
- `milestoneKey` is `${scheduleVersion}:level:${level}`, for example `v1:level:5`.

No verified visits, or none that reach 300 XP, returns an empty list. The helper does not invent a `reachedAt`.

A timestamp is valid when `Date.parse` returns a finite instant. Invalid timestamps are dropped and do not throw. Strings are not trimmed and are not rewritten. Valid instants are sorted ascending. Equal instants keep their input order, so a repeated timestamp still counts as its own visit. The same input returns the same milestones.

A make-up visit is a normal verified visit: if its timestamp is in the list, it counts the same way. This helper does not read correction rows, badges, or the database. Ordinary QR issuance, recipes, activity checkmarks, public reviews, and negative reviews are not inputs, so they award nothing here.

## Quarters

`chicagoQuarterKey` uses `Intl.DateTimeFormat` with `timeZone: 'America/Chicago'`, the same calendar as `chicagoCalendarDate`. Q1 is January–March, Q2 April–June, Q3 July–September, Q4 October–December. An instant at 2026-12-31 23:30 America/Chicago (`2027-01-01T05:30:00.000Z`) is `2026-Q4`. An instant at 2027-01-01 00:30 America/Chicago is `2027-Q1`.

## Not in this slice

No ledger table, no backfill, and no change to `user_badges` or the badge-award path. Campaign budget checks are E09-B1 below and still have no table. Revert this PR to roll it back. Nothing else calls these functions.

## Campaigns (E09-B1)

Pure helpers in `src/lib/drawings/campaign.ts`. No migration, no UI, no flag, and no database read or write. Nothing in the app calls them yet. This does not claim E09, E07, or E02 acceptance.

`validateCampaignDraft` and `checkCampaignEdit` add each prize's quantity times `unitValueCents` to `fulfillmentAllowanceCents`. That sum is `committedCents`. Amounts are integer cents. The sum may equal `totalBudgetCents`. Anything larger is `over_budget`. A valid current campaign does not allow the next draft to exceed its authorized total. Lowering `totalBudgetCents` below the cents still committed is rejected.

Sample mode requires every prize to have `isSample: true` and a label containing `Sample prize`. `displayPrizeLabel` starts sample labels with that marker. Live mode rejects an `isSample` prize. The only entry source is `level_milestone`. Reviews, QR issuance, and recipes are rejected. A public-review source is never eligible.

`campaignWindow` uses `chicagoQuarterKey` for the America/Chicago quarter, start inclusive and end exclusive. `2026-Q4` starts at 2026-10-01 00:00 America/Chicago and ends at 2027-01-01 00:00 America/Chicago, including the November DST change. These helpers do not set official rules or real prize values. Noah funds the drawings. No restaurant sponsorship is recorded here.

Revert the PR to roll the helpers back. Nothing in the app calls them yet.
