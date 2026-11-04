# Wanderbite Redesign — Build Plan and Ready-to-Paste Prompts

Stack assumed: Next.js (App Router) + Tailwind + shadcn/ui + Supabase + Stripe on Vercel. Work in small PRs, one step at a time. Each step has acceptance criteria and a prompt you can paste into Cursor (Agent mode) or Grok.

> **Before every prompt,** make sure Cursor can see `design-handoff/` (this folder) and the rules file `.cursor/rules/wanderbite-design.mdc`.

---

## Phase 0 — Foundation (½ day)

### 0.1 Fonts, tokens, utilities
**Prompt:**
```
Read design-handoff/DESIGN_SPEC.md sections 2–6 and design-handoff/code/wanderbite-theme.css.
1) Load Instrument Serif (400, normal+italic) and Outfit (400–700) with next/font/google in app/layout.tsx,
   exposing CSS variables --font-display and --font-sans.
2) Import wanderbite-theme.css from app/globals.css (copy it to app/styles/wanderbite-theme.css).
3) Map the --wb-* tokens into Tailwind (theme extension or @theme inline for Tailwind v4) so I can use
   classes like bg-wb-night, text-wb-blush, font-display.
4) Keep existing shadcn variables working; set --primary to #7c3aed and --accent to #fb7185 (unchanged).
Do not restyle any pages yet. Show me the diff.
```
**Done when:** fonts load with no layout shift, `bg-wb-night`/`font-display` work, and nothing else changes visually.

### 0.2 Core components
**Prompt:**
```
Using DESIGN_SPEC.md section 8, create components in components/wb/:
GlassPanel, GlowBorder, PillLabel, CtaButton (primary gradient / secondary-dark / secondary-cream),
Chip (glass, tinted, matched, unknown), StatTile, OpenStat, BeaLine, GlassTabBar (mobile),
StatusTrack (Ready → Code → Verified → Memory, plus expired/swapped variants).
Use the classes from wanderbite-theme.css. Real <button>/<a> elements, aria labels on icon buttons.
Add a /dev/components page that renders every component on dark and cream backgrounds.
Respect prefers-reduced-motion.
```
**Done when:** `/dev/components` matches the look of the mockups in `design-handoff/mockups/`.

### 0.3 Bea avatar, ready for Rive from day one
**Prompt:**
```
Copy design-handoff/code/BeaAvatar.tsx, BeaAvatarRive.tsx and Bea.tsx into components/bea/.
Install @rive-app/react-canvas. Everywhere the app shows the AI concierge, use ONLY <Bea /> from
components/bea/Bea.tsx (never BeaAvatar or BeaAvatarRive directly).
Keep NEXT_PUBLIC_BEA_RIVE unset for now so the SVG placeholder renders. Add .env.example with
NEXT_PUBLIC_BEA_RIVE=0 and a comment explaining it. Add <Bea /> in every state and size to /dev/components.
Do not create or edit any .riv file; a motion designer will deliver public/bea.riv later (design-handoff/RIVE_BRIEF.md).
```
**Done when:** the app uses `<Bea />` everywhere and the SVG renders. Noah dropped the Rive hire on 2026-11-04. The animation is in code. Do not add `@rive-app` or a `.riv` file.

---

## Phase 1 — Correctness first (2–4 days). Do this before the big visual work.

These come from a separate code/UX review (based on a **Sept 29 repo snapshot**, so verify each against current code).

### 1.1 One source of truth for member progress
**Problem:** Journey shows a hardcoded streak (`CURRENT_STREAK_MOCK = 1` in `journey-content.tsx`), while Passport and Challenges use `calculateStreak`. "First Bite" is locked on Journey (persisted `user_badges`) but shown as earned on Passport and Challenges (a derived streak badge with the same name). Counts mix redemptions with unique restaurants.
**Prompt:**
```
Create a single server function getMemberProgress(userId) returning:
{ verifiedVisits, pendingVisits, uniqueRestaurants, neighborhoods, currentMonthlyStreak, longestStreak,
  xp, level, nextLevel, badges: [{id, name, earnedAt|null, progress:{current,target}}],
  savings: { amount, isEstimate } }.
- Use one business timezone (America/Chicago) for month boundaries.
- Badges: one definition and id per badge; reconcile the persisted user_badges vs derived "First Bite".
- Remove CURRENT_STREAK_MOCK. Journey/Progress, Passport and Challenges must all read from this.
- On query failure return an error state, not zeros ("Progress temporarily unavailable").
Write unit tests for streak math, including visits near midnight and month-end.
```
**Done when:** the same account shows the same streak, visits and badges on every page.

### 1.2 Visit statuses
**Prompt:**
```
Model challenge/redemption status explicitly: ready, code_issued, verified, note_added, expired, swapped.
An issued code must never count as a visit. Expose status on challenge and visit queries,
and use it everywhere a visit appears.
```

### 1.3 Notes: privacy and editor
**Problem:** Journal says "only you can see these," but a note can be public. "Add note" on Passport opens the Journal list with no editor.
**Prompt:**
```
1) Build one NoteEditor bound to a specific visit/redemption id (rating, short note, optional dish, visibility).
   Open it from Passport, Journal/Timeline, Challenges and "Add memory" links; after save, return to the visit.
2) Show a Private/Public badge on every note with a toggle where the note is read.
   Change Journal copy to: "Your dining memories. You choose which ones to share."
3) Only allow publishing a public review for a VERIFIED redemption (check saveBiteNote and getPublicReviews).
```

### 1.4 Redemption expiry consistency
**Problem:** UI copy says 15 minutes (`restaurant-card.tsx`); `redemption-expiry.ts` says 35 days; `getRedemptionCode` doesn't check `expires_at`.
**Prompt:**
```
Ask me which expiry policy is correct, then make issuance, retrieval, verification, expiry jobs and all copy agree.
Enforce expiry server-side in getRedemptionCode. Refresh the visible countdown from the authoritative deadline.
```

### 1.5 Discover fallback diagnosis
**Prompt:**
```
Read design-handoff/BEA_AI_SPEC.md section 5. Instrument every path in the Discover API that falls back
to a random/non-AI pick: log a reason code (parse_failed, provider_error, budget_exceeded, no_candidates,
missing_metadata) to server logs. Keep dietary constraints enforced in fallback. Don't log note text or tokens.
Then list the reasons you see in the last 50 requests.
```

### 1.6 Small fixes
**Prompt:**
```
Fix: public nav overlapping at 800px (collapse earlier; test 390/768/800/1024/1440); footer shows Sign up/Sign in
when signed in (show account actions instead); signed-in nav sometimes stale right after sign-in;
"&amp;" in photo credits (decode entities); "No tags" text (hide when empty); "1 restaurants" pluralization;
Share My Passport uses wanderbite.com — must be wanderbite.co; Journey header shows raw email (use first name).
```

**Phase 1 acceptance:** consistent progress everywhere; issued vs. verified is clear; "Add note" edits the right visit; public notes are labeled; expiry copy matches enforcement; fallback reasons are logged; nav works at tablet widths.

---

## Phase 2 — Visual redesign (1–2 weeks)

Build in this order and compare each page against its mockup in `design-handoff/mockups/`.

### 2.1 Home hero + Discover (Ask → Thinking → Pick)
**Prompt:**
```
Rebuild the homepage hero and the Discover flow to match design-handoff/mockups/home-hero.html,
discover-1-ask.html, discover-2-thinking.html and discover-3-pick.html, following DESIGN_SPEC.md section 9
and BEA_AI_SPEC.md.
- Use components from components/wb and <Bea /> from components/bea/Bea.tsx (state + food props driven by the stream).
- Discover API streams DiscoverEvent (BEA_AI_SPEC.md section 4). The Thinking screen renders steps as they arrive
  (min ~700ms dwell each), skips the memory step for guests/no history.
- Pick screen shows matched / unknown / unmet chips, Bea's reason, "Let's go" (directions) and "Another idea";
  refine chips (Closer / Cheaper / New vibe) keep the original request.
- Move detailed filters behind a "Refine" control; keep the dietary status button always visible.
- Photos: use next/image with the partner photo; keep attribution inside the frame. Placeholders for now are fine.
- Page transitions and the result reveal with Motion (framer-motion). Respect reduced motion.
Mobile first (390px), then desktop.
```

### 2.2 Challenges + Redemption
**Prompt:**
```
Rebuild /challenges to match design-handoff/mockups/challenges.html: dark header (pill with real days left,
"Your {Month} adventures", 3 glass stat tiles), cream sheet with two ChallengeTicket components using
StatusTrack and real statuses from Phase 1. At 390x844 the first ticket's name, offer, status and action
must be visible without scrolling past a big streak panel. Fixed photo heights (no layout jumps).
Then restyle the redemption screen: full-screen, large QR + readable code, offer, min spend, real deadline,
live verification status with aria-live. No animation on the QR itself.
```

### 2.3 Progress (replaces My Journey)
**Prompt:**
```
Rebuild /journey (Journey tab, rename the label to "Progress" but keep the URL working) to match
design-handoff/mockups/progress.html using getMemberProgress(): header with XP ring + XP panel,
NextMoveCard (exactly one next action), open stats (savings labeled "estimated" if isEstimate),
monthly streak row, BadgeMedallion grid with progress rings, "Road to Local Legend" disclosure,
recent adventures with status chips and "Add memory" links to NoteEditor.
XP copy must match the real rule (currently 100 XP per verified visit; no note XP unless implemented).
```

### 2.4 Passport + Journal (Timeline)
**Prompt:**
```
Rebuild Passport to match design-handoff/mockups/passport.html: header with stats + segmented
Stamps / Timeline / Map control (Timeline = Journal; preserve existing journal URLs; Map can come later).
Stamps view: lined paper page, Stamp per verified visit (cuisine ink color, slight rotation),
PendingStamp for code_issued, EmptyStampSlot linking to the next challenge.
Selecting a stamp shows the MemoryCard with Private/Public toggle and "Edit memory" (NoteEditor).
Bea "quick memory" card for verified visits without a note. Share uses wanderbite.co and excludes private
notes, email and codes by default.
```

**Phase 2 acceptance:** each page visually matches its mockup at 390px and desktop; no layout shift from photos; contrast and keyboard checks pass; reduced motion disables loops.

---

## Phase 3 — Delight (after Phases 1–2 work)

- **Bea animation (Noah, 2026-11-04):** the Rive hire was dropped. Motion is in the SVG avatar and `wanderbite-theme.css`. `RIVE_BRIEF.md` and `code/BeaAvatarRive.tsx` stay as reference. Do not install `@rive-app` or add a `.riv` file.
- **Stamp unlock moment:** the stamp slam + ink burst plays once when a visit becomes verified.
- **Share card:** generate a passport share image with `next/og` (stamps, level, opt-in only).
- **Scroll reveals** on the homepage sections; partner photo grid.
- Later, if data supports it: collections (cuisines tried, downtown route), the map view, and monthly recaps.

**Measure:** recommendation → directions rate, fallback frequency by reason, challenge → verified conversion, note completion, return visits.
