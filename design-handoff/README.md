# Wanderbite Redesign — Handoff Pack

Everything Cursor and Grok need to rebuild wanderbite.co in the new "Golden Hour" direction (cinematic photography, editorial serif type, glass panels, and Bea, the AI concierge).

## What's inside

| File | What it's for |
|---|---|
| `DESIGN_SPEC.md` | **Start here.** Colors, type, layout, motion, photography, components and page-by-page specs. |
| `BEA_AI_SPEC.md` | The AI concierge: personality, avatar states, the "show your thinking" steps, the streaming API contract, and honest-matching rules. |
| `BUILD_PLAN.md` | A phased plan with acceptance criteria and **ready-to-paste prompts** for each step. |
| `code/wanderbite-theme.css` | Design tokens, keyframes and utility classes (`.wb-glass`, `.wb-glow`, `.wb-cta`, …). |
| `RIVE_BRIEF.md` | **For you, not the AI tools.** A ready-to-post job brief for hiring a motion designer to build Bea in Rive. |
| `code/Bea.tsx` | The single avatar component the app uses. It shows the SVG today and switches to Rive with one env var. |
| `code/BeaAvatar.tsx` | The SVG placeholder avatar (`idle` / `thinking` / `found`, eats the requested cuisine). |
| `code/BeaAvatarRive.tsx` | The Rive version, wired to the input names in the brief. It's used automatically once `bea.riv` exists. |
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

## Bea's animation: what's on you vs. the AI tools

- **Cursor/Grok** build everything around `<Bea />` (step 0.3 in the build plan) using the SVG placeholder, so the site works fully today.
- **You** hire a motion designer with `RIVE_BRIEF.md` to make the polished Rive character. AI coding tools can't produce this.
- **When `bea.riv` arrives,** drop it in `public/` and run the Phase 3 Rive prompt. No other code changes are needed.

## Order matters

Do **Phase 1 (correctness)** before the big visual work. Progress, badges, statuses, note privacy and the Discover fallback need to be reliable first, or the new design will just showcase the bugs. The Phase 1 file and line references come from a Sept 29 code snapshot, so have Cursor verify them against the current code.
