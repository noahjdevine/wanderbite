# Bea — AI Concierge Spec

"Bea" is a placeholder name; rename it freely. She powers "Where should we eat tonight?" (Discover). The goals: **feel human and personal, show the thinking in a fun way, and never fake it.**

---

## 1. Personality and voice

- A warm, local friend who knows every partner spot and remembers what you liked. She's playful but brief.
- She speaks in the first person ("I think…", "I've got one"), uses the member's first name sparingly, and never uses corporate filler.
- She's honest about uncertainty: "Quiet? Can't confirm, ask for a booth."
- Visually, her lines are set in Instrument Serif *italic* inside quotes or a blush speech bubble.

**Copy bank (rotate; don't repeat the same line twice in a row):**
- Greeting: "Good evening, {name}." / "Hungry, {name}?" / "What are we feeling tonight?"
- Thinking title: "Bea's on it…" / "Ooh, let me think…" / "Give me a sec…"
- Found: "Ooh, I've got one for you." / "Okay, I'm pretty excited about this one." / "Found it."
- Reason template: "It's {new to your Passport | one of your favorites}, and {personal hook}."
- Fallback/near-miss: "I couldn't find a perfect match for {unmet}, but this is close because {reason}."

---

## 2. Avatar

The concept is a round, glossy violet character (brand gradient) with simple eyes, rosy cheeks and a small mouth, plus a tiny hand that holds food. A reference implementation is in `code/BeaAvatar.tsx`, and the animated mockup is in `mockups/bea-avatar.html`.

| State | When | Animation |
|---|---|---|
| `idle` | Discover input, chat lines | Blink every ~4s, gentle bob |
| `thinking` | While the request is processing | Takes a bite of the **cuisine the member asked for** (sushi, pizza, taco, dumpling…), chews, crumbs fly; loops |
| `found` | Result revealed | Happy squint + a small floating heart, then idle |

- At small sizes (< 48px: chat avatar, app icon, favicon), show **only the face**, with no food or hand.
- If no cuisine was parsed, use a neutral food (dumpling) or a generic plate.
- **In code, always render `<Bea />` (`src/components/bea/Bea.tsx`).** Noah dropped the Rive hire on 2026-11-04. The animation is in the SVG and in `src/app/styles/wanderbite-theme.css`. `RIVE_BRIEF.md` and `code/BeaAvatarRive.tsx` are reference only. Do not add `@rive-app` or a `.riv` file. Reduced-motion users get a static pose. Sizes under 48px are the face only.

---

## 3. The thinking experience: show real work

The thinking screen shows steps **only as the backend actually completes them**. Every step maps to a real pipeline stage:

| Step id | Label shown | Real backend work | Detail shown |
|---|---|---|---|
| `parse` | "Reading your vibe" | LLM/structured parse of the request into constraints | Chips for each parsed constraint: `quiet`, `date night`, `Japanese`, `~$40 / person`, plus dietary settings |
| `filter` | "Looking through {N} local partners" | Query partners; apply hard constraints (dietary, cuisine, budget, distance if known) | "Keeping the Japanese spots in budget" + a fanned stack of 3 partner photos |
| `memory` | "Remembering what you love" | Read the member's verified visits, ratings and notes (signed-in only, with consent) | One true personal line, e.g. "You gave Zen Sushi five stars for huge, fresh rolls." **Skip this step for guests or members with no history.** |
| `rank` | "Down to two…" | Score and pick; keep the runner-up | Two mini cards: winner ("New to you") vs. runner-up ("An old favorite") |
| `found` | Bea: "Ooh, I've got one for you." | Final pick ready | Transition to the result |

**Rules:**
- Never show a step for work that didn't happen (no "checking who's open" unless opening hours are actually checked).
- Steps appear in order with a minimum dwell time of about 600–900ms each, so the animation is readable even if the backend is fast. Don't add artificial delay beyond about 3s total.
- If a step fails, show a calm fallback line and keep going if you can.

---

## 4. Streaming contract (suggested)

Stream with the Vercel AI SDK or Server-Sent Events from a Next.js Route Handler (`app/api/discover/route.ts`).

```ts
// Shared types
type Constraint = {
  key: "cuisine" | "vibe" | "occasion" | "budget" | "dietary" | "time" | "area";
  label: string;            // "Japanese", "date night", "~$40 / person"
  required: boolean;        // dietary is always required
};

type PartnerLite = {
  id: string;
  name: string;
  cuisine?: string;
  neighborhood?: string;
  photoUrl?: string;
  photoCredit?: string;
};

type DiscoverEvent =
  | { type: "step"; id: "parse"; label: string; constraints: Constraint[] }
  | { type: "step"; id: "filter"; label: string; detail: string; sample: PartnerLite[]; total: number }
  | { type: "step"; id: "memory"; label: string; line: string }           // omit for guests/no history
  | { type: "step"; id: "rank"; label: string; winner: PartnerLite; runnerUp?: PartnerLite;
      winnerTag: "New to you" | "A favorite"; runnerUpTag?: string }
  | { type: "pick";
      partner: PartnerLite & { offer?: { amountOff: number; minSpend: number } }; // members only, only if real
      reason: string;                    // Bea's one-sentence reason
      matched: string[];                 // labels satisfied
      unknown: { label: string; note: string }[];   // e.g. { label: "Quiet", note: "Can't confirm, ask for a booth" }
      unmet: string[];                   // constraints not satisfied (near-miss)
      isNewToMember: boolean;
      food: "sushi" | "pizza" | "taco" | "dumpling" | "burger" | "bbq" | "generic"; // drives the avatar
    }
  | { type: "fallback"; reason: "no_match" | "provider_error" | "timeout"; message: string }
  | { type: "error"; message: string };
```

The client keeps the **original request plus parsed constraints** in state, so "Another idea", "Closer", "Cheaper" and "New vibe" re-run the request with a modified constraint set instead of starting over.

---

## 5. Honest matching rules

1. **Dietary constraints are hard filters**, including in fallback. Never imply allergy safety. Keep the existing "Discovery cannot assess allergies. Ask the restaurant." notice on the result screen.
2. On the result, show **matched** (green check), **unknown** (amber, with an honest note) and **unmet** (shown when the pick is a near-miss) constraints.
3. If nothing matches, say so and label the alternative clearly as an alternative. Don't present a random partner as a match.
4. **Instrument fallbacks:** log the fallback reason (missing data, provider error, parse failure, budget limit) to your server logs or analytics. Don't log private note text or redemption tokens. The current site has been seen returning off-request picks (a bar or BBQ for a Japanese date-night request), and this is the #1 thing to fix before polishing the UI.
5. Personal lines must come from **verified data the member created** (ratings and notes). If unsure, skip the memory step.
6. Offers appear on results only for members with a real, currently available offer. Don't show blurred or teaser discounts while checkout is paused.

---

## 6. Where Bea shows up outside Discover

- **Challenges:** one optional line, e.g. reminder offers ("Want a nudge before the month runs out?"), but only if reminders are implemented.
- **Progress:** the "Your next move" card label.
- **Passport:** "Bea asks: How was {restaurant}? One tap is enough." (quick rating; notes are private by default).
- Keep it to one Bea moment per screen.

---

## 7. Model prompt starter (for the parse and reason steps)

```
You are Bea, Wanderbite's dining concierge in McKinney, TX.
Task A (parse): Convert the user's request into JSON constraints:
{cuisine?, vibe?, occasion?, budget_per_person?, dietary[], time?, area?}. Mark dietary as required.
Do not invent constraints the user didn't imply.

Task B (reason): Given the chosen partner, the matched/unknown constraints and (optionally)
up to two facts from the member's own verified history, write ONE warm sentence (max 22 words)
in first person explaining the pick. Only use facts provided. Never claim hours, noise level,
availability, or allergy safety unless provided as data.
```
