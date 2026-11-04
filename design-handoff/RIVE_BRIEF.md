# Motion Design Brief — "Bea," Wanderbite's AI Concierge (Rive)

*Post this as-is on Upwork, Fiverr, Contra, Dribbble hiring, or the Rive community. Attach `mockups/bea-avatar.html`, or a screen recording of it.*

---

## About the project

Wanderbite is a restaurant discovery app in McKinney, Texas. Members ask our AI concierge, currently called "Bea" (the name may change), "Where should we eat tonight?" While Bea thinks, she takes a bite of the food the member asked for. When she finds a pick, she gets happy.

We need a polished, **interactive Rive character** with a state machine that our Next.js app controls.

## The character

- A round, glossy, violet "orb" creature: soft radial gradient, a white specular highlight in the upper left, two simple dark oval eyes, rosy cheeks, a small mouth, and one tiny round hand (no arms) that holds food.
- She should feel cute, warm and a little magical, not childish. Think friendly app mascot with premium polish.
- A rough working prototype is attached (`bea-avatar.html`). Please improve on it: better squash and stretch, chewing, timing and charm.

**Palette**
| Part | Color |
|---|---|
| Body gradient | `#ffffff` → `#fbcfe8` → `#a78bfa` → `#6d28d9` → `#3b0764` |
| Eyes / mouth | `#1d1033` / `#3b0764` |
| Cheeks | `#f472b6` at ~55% |
| Hand | `#7c3aed` |
| Heart / accents | `#ffc9d6`, `#fb7185` |

It will appear mostly on a dark plum background (`#120a24`) and sometimes on cream (`#faf6ef`), so it must read well on both.

## States (Rive state machine)

| State | Behavior | Length |
|---|---|---|
| **Idle** | Gentle bob, natural blinking (every 3–5s, occasionally a double blink), subtle breathing. | Seamless loop, ~3–4s |
| **Thinking** | Brings the food to her mouth, takes a bite (a bite mark appears in the food), chews happily with a squint, crumbs fall. Repeats with small variations. | Seamless loop, ~4s |
| **Found** | Happy reaction: big squint/smile, a small hop, and a heart pops up. Then she settles back into Idle automatically. | One-shot, ~1.5s |

Every state must transition smoothly from every other state, with no snapping (for example, Thinking → Found mid-bite).

## Food variants (swapped by an input)

| Value | Food |
|---|---|
| 0 | Dumpling (default / generic) |
| 1 | Salmon nigiri |
| 2 | Pizza slice |
| 3 | Taco |
| 4 | Burger |
| 5 | BBQ (rib or brisket on a fork) |

Use a flat, simple style that matches the character. The bite mark should look like it was taken from the side nearest her mouth.

## Technical contract (must match exactly)

- **Artboard name:** `Bea`
- **State machine name:** `Bea`
- **Inputs:**
  - `state`: **Number**. `0` = Idle, `1` = Thinking, `2` = Found
  - `food`: **Number**. `0`–`5` per the table above (only visible during Thinking)
- Transparent background, square artboard (e.g. 500×500), with the character centered and leaving room for the food on the right.
- It will be displayed from ~120px to ~520px wide. (The small face-only avatar is handled separately in code, so it's not needed here.)
- No text, fonts or raster images inside the file. Vector only.
- Target `.riv` size under ~150 KB. It should run smoothly on a mid-range phone.
- Should respect our code's ability to pause animation (we fall back to a static version for reduced-motion users).

## Deliverables

1. `bea.riv` (runtime file)
2. The Rive source/editor file, so we can make edits later
3. A short screen recording of each state and each food
4. A note on any extra inputs you add (optional extras are welcome: a "wave" trigger, a "sleepy" idle variation)

## Rights

Original work, with full commercial rights transferred to Wanderbite (Devine Enterprises LLC). No third-party assets with unclear licenses.

## To apply, please send

- 2–3 Rive character pieces with state machines (links to the Rive community or live files preferred)
- Your price and timeline for this scope
- One sentence on how you'd make the chewing feel charming

*Budget note for us (don't post): character and state-machine work at this scope varies widely by designer and region. Get at least 3 quotes and compare portfolios before price. Ask for a rough animatic or WIP check-in partway through.*
