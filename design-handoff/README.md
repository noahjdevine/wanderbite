# Wanderbite Redesign — Handoff Pack

Everything Cursor and Grok need to rebuild wanderbite.co in the new "Golden Hour" direction (cinematic photography, editorial serif type, glass panels, and Bea, the AI concierge).

## What's inside

| File | What it's for |
|---|---|
| `DESIGN_SPEC.md` | **Start here.** Colors, type, layout, motion, photography, components and page-by-page specs. |
| `BEA_AI_SPEC.md` | The AI concierge: personality, avatar states, the "show your thinking" steps, the streaming API contract, and honest-matching rules. |
| `BUILD_PLAN.md` | A phased plan with acceptance criteria and **ready-to-paste prompts** for each step. |
| `code/wanderbite-theme.css` | Design tokens, keyframes and utility classes (`.wb-glass`, `.wb-glow`, `.wb-cta`, …). |
| `RIVE_BRIEF.md` | Reference for Bea's states. Noah dropped the Rive hire on 2026-11-04. The animation is in code. |
| `code/Bea.tsx` | Reference copy. The app renders `src/components/bea/Bea.tsx`. |
| `code/BeaAvatar.tsx` | Early SVG reference (`idle` / `thinking` / `found`). The live avatar is `src/components/bea/BeaAvatar.tsx`. |
| `code/BeaAvatarRive.tsx` | Reference only. Not wired. Do not add `@rive-app` or a `.riv` file. |
| `cursor-rules/wanderbite-design.mdc` | A Cursor rules file so every edit follows the design system. |
| `mockups/*.html` | Standalone HTML of every redesigned screen. Open them in a browser to see the motion. |

`RIVE_BRIEF.md` and `code/BeaAvatarRive.tsx` are reference only. Bea's animation is built in code; do not add `@rive-app` or a `.riv` file.

### Mockups
- `home-hero.html`: desktop home hero
- `discover-1-ask.html`, `discover-2-thinking.html`, `discover-3-pick.html`: the Bea flow (phone)
- `challenges.html`, `progress.html`, `passport.html`: member pages (phone)
- `bea-avatar.html`: the avatar taking a bite (with cuisine variants)

Photo areas in the mockups are **animated placeholders labeled with the shot they need**. Replace them with real partner and lifestyle photos.

## How to use with Cursor

1. Copy this whole folder into your repo as `design-handoff/`.
2. Copy `cursor-rules/wanderbite-design.mdc` to `.cursor/rules/wanderbite-design.mdc`.
3. Open `BUILD_PLAN.md` and paste the prompts one at a time, in order. Review each diff before moving on.
4. When Cursor builds a page, also tell it: *"Open design-handoff/mockups/<page>.html and match it."*

## How to use with Grok

Grok works best with the specs pasted in directly:
1. Paste `DESIGN_SPEC.md` and `BEA_AI_SPEC.md` (or attach them).
2. Attach the relevant mockup `.html` file(s), or screenshots of them.
3. Paste one step's prompt from `BUILD_PLAN.md` at a time.

## Bea's animation

Noah dropped the Rive hire on 2026-11-04. The animation is in code: `src/components/bea/BeaAvatar.tsx` and `src/app/styles/wanderbite-theme.css`. `RIVE_BRIEF.md` and `code/BeaAvatarRive.tsx` stay as the motion reference. Do not add `@rive-app` or a `.riv` file.

## Order matters

Do **Phase 1 (correctness)** before the big visual work. Progress, badges, statuses, note privacy and the Discover fallback need to be reliable first, or the new design will just showcase the bugs. The Phase 1 file and line references come from a Sept 29 code snapshot, so have Cursor verify them against the current code.
