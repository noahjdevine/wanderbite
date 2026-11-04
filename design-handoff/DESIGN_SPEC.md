# Wanderbite Redesign — Design Spec ("Direction 2: Golden Hour")

The source of truth for the visual redesign. The matching mockups are in `mockups/` (open any `.html` file in a browser). Tokens and utility classes are in `code/wanderbite-theme.css`. The AI concierge is specified separately in `BEA_AI_SPEC.md`.

---

## 1. The idea in one paragraph

Wanderbite should feel like a **local dining lifestyle brand with a touch of magic**: cinematic, candlelit photography, big editorial serif headlines, frosted-glass panels, and a few purposeful moving pieces. Public and discovery moments are dark and immersive ("tonight"). Member pages keep that cinematic header but put reading content on warm cream "paper" so they stay calm and legible. Everything is clean: fewer boxes, more space, one signature motion per screen.

**Reference sites** (for mood, not copying): Krea (full-bleed editorial photography + white type), Flex Elite (photo hero with a glossy floating object), Soulera (serif headline, white line-art over a photo, glass stat panels), and DIGI.CO's food discovery app on Dribbble (lifestyle food photography, pink pill label, playful rounded shapes).

**Keep from today:** the brand violet `#7c3aed`, the rose accent `#fb7185`, and Outfit as the UI font.

---

## 2. Color tokens

| Token | Hex | Use |
|---|---|---|
| `--wb-night` | `#120a24` | Primary dark background (hero, Discover, member headers) |
| `--wb-night-2` | `#1d1033` | Secondary dark surface, gradient stop |
| `--wb-plum` | `#2a1442` | Dark accent cards on cream, dark buttons, headings on cream |
| `--wb-violet` | `#7c3aed` | Brand violet (existing primary) |
| `--wb-violet-2` | `#8b5cf6` | Gradient start, progress fills |
| `--wb-lavender` | `#c4b5fd` | Light violet text/icons on dark |
| `--wb-lavender-2` | `#ddd6fe` | Secondary text on dark |
| `--wb-rose` | `#fb7185` | Existing accent; glows, XP ring |
| `--wb-pink` | `#db2777` | Gradient end, active status on cream |
| `--wb-pink-ink` | `#be185d` / `#9d174d` | Pink text on cream (passes contrast) |
| `--wb-blush` | `#ffc9d6` | Pill labels, italic accent words on dark |
| `--wb-blush-ink` | `#4a0d24` | Text on blush |
| `--wb-cream` | `#faf6ef` | Member page "paper" background |
| `--wb-paper` | `#fffdf8` | Stamp book page |
| `--wb-ink` | `#1f1530` | Body text on cream |
| `--wb-muted` | `#6b6275` | Secondary text on cream (≥4.5:1) |
| `--wb-line` | `#e6dccb` | Hairlines and dividers on cream |

**Status colors (semantic only):**
- Verified: text `#14532d` on `#dcfce7`
- Pending/verifying/code issued: text `#78350f` on `#fef3c7` (on photos: `#451a03` on `#fde68a`)
- Public: text `#1e3a8a` on `#dbeafe`
- Positive on dark: text `#a7f3d0` on `rgba(110,231,183,.14)`; check icon fill `#34d399`

**Signature gradient (primary CTA):** `linear-gradient(135deg, #8b5cf6 0%, #db2777 100%)`, with shadow `0 10px 22px rgba(219,39,119,.28)`.

**Cuisine ink colors (stamps, tiles):** Pizza `#c2410c`, Sushi/Japanese `#0f766e`, American/Bar `#6d28d9`. Extend with colors of similar lightness that pass 4.5:1 on white.

---

## 3. Typography

- **Display:** *Instrument Serif* (Google Fonts, regular + italic). Use it for headlines, big numbers, restaurant names and Bea's voice lines.
  - One italic accent word per headline, colored `--wb-blush` on dark or `--wb-pink-ink` on cream. Example: "Dinner, *curated* for you."
  - Sizes: hero desktop 96–104px (line-height .92, letter-spacing −2px); mobile hero 52–58px; page titles 42–56px; section titles 28–30px; card titles 34–36px; big stats 40–44px.
- **UI:** *Outfit* 400/500/600/700. Body 14–17px, labels 12–13px, small caps-style labels 11–13px weight 700 with letter-spacing 1.2–1.6px.
- **Bea's voice:** Instrument Serif *italic*, 18–22px, inside quotes or a speech bubble.
- Do not add other fonts.

Next.js: load both with `next/font/google` (`Instrument_Serif` with `weight: "400", style: ["normal","italic"]`, and `Outfit`). Expose them as `--font-display` and `--font-sans`.

---

## 4. Layout model

### Public and discovery pages (dark, immersive)
- Full-bleed photo or animated background on `--wb-night`.
- Dark gradient overlays keep text legible: left-to-right on desktop hero, top/bottom fades on mobile.
- Content floats on glass panels.

### Member pages (two zones)
1. **Cinematic header zone:** `--wb-night` with two slowly drifting aurora blobs (violet and rose radial gradients), the Instrument Serif title, and glass stat tiles. Bottom padding is about 64px.
2. **Paper sheet:** `--wb-cream`, `margin-top: -30px`, `border-radius: 32px 32px 0 0`, so it slides up over the header. Content sits mostly in the open, separated by space and hairlines. Use cards only for things that act as objects (tickets, memories, the next-move card).

### Navigation
- **Mobile:** a floating glass tab bar 16px from the screen edges and 18px from the bottom, 64px tall, fully rounded. It's dark glass (`rgba(18,10,36,.86)` + blur) on every screen. Tabs: Discover, Challenges, Progress, Passport. The active tab is `--wb-blush` and bold.
- **Desktop public:** a logo (Instrument Serif), a center glass pill with the links, and a white "Sign in" pill. **Collapse to a menu earlier than today.** The current nav breaks at 800px. Test at 390, 768, 800, 1024 and wide.

### Spacing and radii
- Spacing scale: 4, 8, 12, 14, 16, 20, 22, 26, 30px. Page gutter is 16px on mobile (20px in the header zone).
- Radii: pills 999px, chips 999px, tiles 14–18px, cards 22–28px, sheet top 32px, tab bar 32px.
- Touch targets ≥ 44px.

---

## 5. Glass, glow and depth recipes

- **Glass panel (on dark):** `background: rgba(255,255,255,.08–.12); border: 1px solid rgba(255,255,255,.16–.28); backdrop-filter: blur(16–24px) saturate(140%); box-shadow: inset 0 1px 0 rgba(255,255,255,.3), 0 20–30px 50–70px rgba(0,0,0,.4);`
- **Dark glass result card:** `background: rgba(36,21,64,.78)` with the same border and blur.
- **Glow border (prompt box, next-move card):** a wrapper with `padding: 1.5px; overflow: hidden; border-radius: R`. Inside it, an oversized absolutely positioned `conic-gradient` (mostly a faint base color, with a `#fb7185 → #a78bfa` arc) rotates continuously (6–7s linear). The inner content has `border-radius: R - 1.5px` and an opaque or near-opaque background.
- **Card shadow on cream:** `0 18px 40px rgba(42,20,66,.12), 0 1px 2px rgba(42,20,66,.06)`.

Classes for all of these are in `code/wanderbite-theme.css` (`.wb-glass`, `.wb-glow`, `.wb-cta`, and so on).

---

## 6. Motion

**Principle:** each screen gets one signature motion plus a few quiet ambient loops. Never animate a claim the system isn't actually making. Respect `prefers-reduced-motion` by turning every loop off and showing final states.

| Motion | Where | Spec |
|---|---|---|
| Photo drift (Ken Burns) | Hero and result photos, ticket photos | scale 1.06→1.16 + translate −3%/−2%, 18–22s ease-in-out infinite |
| Bokeh float | Over dark photos (subtle) | blurred circles drifting 10–18px, 6–11s |
| Aurora | Member headers, Thinking screen | 2–3 large radial blobs, translate 30–50px + scale, 12–16s |
| Glow border spin | Prompt box, next-move card | conic gradient rotate 360°, 6–7s linear |
| Placeholder cycle | Discover input | 3 example prompts fading in and out, 12s total |
| Thinking steps | Bea thinking | each step fades and slides in as the backend emits it (see Bea spec) |
| Result reveal | Pick card | rise 46px + fade + scale .97→1, ~.8s cubic-bezier(.2,.8,.2,1) |
| Stamp slam | New verified stamp | scale 1.7→.94→1, rotate −18°→6°→5°, ink burst behind, ~1s, **once** on unlock |
| XP fill + shine | Progress XP bar | fill from 0 on mount (1.4s) + a soft highlight sweep |
| Partner marquee | Home hero bottom | partner names scrolling, ~38s linear |
| Line-art draw | Home hero doodle | stroke-dashoffset draw, 6s alternate |

Implementation: CSS keyframes (provided) for ambient loops. Use Framer Motion / Motion for page transitions, the result reveal, the stamp slam and list staggering. Add **page transitions** (fade + 8–12px slide) and **scroll reveals** (sections fade up once as they enter the viewport) to get the "alive as you scroll" feel. Keep shimmer and animation away from the redemption QR code itself.

---

## 7. Photography

Photography is what makes this design pop. Every labeled "PHOTO" frame in the mockups is a slot for a real photo.

- **Style:** warm, candlelit or golden-hour, people enjoying food, close-ups of dishes, real partner interiors. Avoid generic stock where a recognizable McKinney partner photo exists.
- **Slots:** home hero (friends dining, warm light); Discover hero (couple at a candlelit table); result card (the picked restaurant's best dish); challenge tickets (partner interior or dish); memory cards (the member's own photo); recent-adventure thumbnails (dish).
- **Treatment:** `object-fit: cover` in fixed-ratio frames. Never let a portrait image change card height. Use dark overlay gradients for legibility, and Ken Burns drift on hero and result frames only.
- **Attribution:** keep Google Places photo credits inside the frame (bottom-left, 11px, white at 85%). Decode HTML entities (fix the current `&amp;` bug).
- **Formats:** Next.js `<Image>`, AVIF/WebP, `sizes` set correctly, `priority` only on the hero.

---

## 8. Components

| Component | Notes |
|---|---|
| `GlassPanel` | Variants: `light-on-dark` (default), `dark-card`. Props: `radius`, `padding`. |
| `GlowBorder` | Wraps any child with the rotating conic border. Props: `radius`, `speed`, `baseColor` (dark or cream). |
| `PillLabel` | Blush background, blush-ink text, optional −2° to −3° tilt. Used for "Picked for you, Noah", "27 days left this month", and similar. |
| `CtaButton` | Signature gradient, 44–52px, pill. Secondary: glass outline on dark, plum or outlined on cream. |
| `Chip` | Glass chip on dark; on cream, a tinted fill. "Matched" chips include a check icon (green); "unknown" chips are amber with honest text. |
| `ChallengeTicket` | Photo top (fixed height 170–210px), perforation notches (24px cream circles at the left and right edges), restaurant name in display font, offer block ("$10 off" in display + "when you spend $40+"), `StatusTrack`, primary action, small secondary text. |
| `StatusTrack` | 4 segments: **Ready → Code → Verified → Memory**. Completed segments are `--wb-pink`; the current label is bold `--wb-pink-ink`. There are also separate Expired and Swapped states. |
| `Stamp` | Round (double ring, dashed inner ring) or rectangular (4px double border). Ink color comes from the cuisine. Name, date and neighborhood are in letter-spaced caps, with the date in display font. Slightly rotated (−8° to 6°). |
| `PendingStamp` | Dashed teal ring that rotates slowly, a clock icon, and "Stamps once verified." Never show an issued code as a stamp. |
| `EmptyStampSlot` | Dashed tan circle, "+", "Next stamp" and the next challenge name. Links to Challenges. |
| `BadgeMedallion` | 72px circle. Earned: glossy violet gradient + icon + a periodic shine sweep. Locked: a conic progress ring (badge color over `#ebe4d6`) around a cream disc with a muted icon, plus an "x of y" label. |
| `MemoryCard` | Photo top, Verified chip, name, meta, rating, the note in italic display, a **Private/Public row with a toggle** ("Only you can see this memory"), "Edit memory" and "Add photo". |
| `BeaLine` | Bea avatar (28–34px) + italic display text, optionally with 1–2 small action buttons. |
| `NextMoveCard` | GlowBorder (cream base) + "YOUR NEXT MOVE" label + one sentence in display font + meta + CTA. Exactly one per Progress page. |
| `StatTile` (dark) | Glass, big display number + 12px label. |
| `OpenStat` (cream) | Display number + 2-line muted label, separated by hairlines. No box. |
| `GlassTabBar` | See Navigation. |

---

## 9. Pages

Mockup file names are in brackets.

### Home (public) [`home-hero.html`]
- Full-bleed hero photo with drift and bokeh, dark left-to-right overlay.
- Glass pill nav.
- Blush pill: "Now curating McKinney, TX".
- Headline: "Dinner, *curated* for you." Subhead: "Tell Bea what you're craving. She knows every partner spot in town, and she remembers what you love."
- Glowing glass prompt with cycling placeholders, a mic button, and an "Ask Bea" gradient button, followed by 4 glass quick-start chips.
- Right side (desktop only; hide under ~960px): a floating glass pick card (photo, "Picked for you", name, offer), a floating "Stamped" seal, a glass facts panel ("23 local partner spots", "2 curated adventures a month"), and a white line-art doodle.
- Partner name marquee along the bottom.
- Below the fold (not mocked; follow the system): how it works in 3 steps, partner photo grid, member Passport preview, and an honest membership section (checkout status must match reality).

### Discover: Ask [`discover-1-ask.html`]
- Hero photo across the top 2/3. Greeting pill "Good evening, Noah" for signed-in users; for guests, "Free · no account needed".
- Headline: "Where should we eat *tonight?*"
- Bea row (avatar + "Bea · your Wanderbite concierge").
- Glowing prompt: textarea, cycling placeholders, **dietary status button** ("Dietary: none set", always visible, opens settings), mic, and a send button.
- Quick-start chips. All the detailed filters (cuisine, price, time, vibe) go behind a **Refine** control, not on the first screen.

### Discover: Thinking [`discover-2-thinking.html`]
- Aurora background, large animated Bea, the title "Bea's on it…", and the request echoed in italic quotes.
- Glass step cards appear as the backend emits them (see `BEA_AI_SPEC.md`). Then Bea's speech bubble: "Ooh, I've got one for you."
- "Skip to the pick" link.

### Discover: Pick [`discover-3-pick.html`]
- Photo top with drift. A spinning "NEW TO YOUR PASSPORT" badge appears if the member hasn't visited.
- Dark glass result card rises in. It contains: the pill "Picked for you, Noah"; the name; cuisine and area; the offer chip (members only, and only if a real offer exists); Bea's one-sentence reason in italic; **matched chips (green check) and unknown or unmet chips (amber, honest)**; the CTAs "Let's go" (directions) and "Another idea"; and the refine row "Closer · Cheaper · New vibe", which keeps the original request in context.

### Challenges (member) [`challenges.html`]
- Header: pill "27 days left this month", title "Your *November* adventures", and 3 glass stat tiles (verified x/2, codes issued, swaps left).
- Sheet: the two `ChallengeTicket`s come first. At 390×844, the first ticket's name, offer, status and primary action must be visible without much scrolling.
- Ready state: "I'm here — get my code" (gradient).
- Code issued state: "Show code to your server" (plum) + a memory row with a Public/Private chip.
- Below the tickets: a BeaLine reminder offer (only if reminders are actually built).

### Redemption (not mocked; follow the system)
- Full-screen, minimal: a large QR + readable code, the offer and minimum spend, the **real validity deadline**, and live verification status (with an `aria-live` update when verified).
- No shimmer on the QR.

### Progress (member, replaces Journey) [`progress.html`]
- Header: avatar with a conic XP ring, "Good evening, *Noah*", the level, and a glass XP panel ("200 / 300 XP", "100 to The Explorer", bar fill + shine, "100 XP for every verified visit").
- Sheet, in order:
  1. `NextMoveCard`
  2. Open stats: verified visits (+ pending), saved so far **(estimated)** until real settled amounts exist, and neighborhoods explored
  3. Monthly streak row (6 months; the current month shows a pending clock if its visit isn't verified yet) + one explanatory sentence
  4. Badge medallions + a "Road to Local Legend" disclosure row (the full level list lives behind it)
  5. Recent adventures list with status chips ("Add memory" for visits without a note)

### Passport + Journal (member) [`passport.html`]
- Header: "Noah's *Passport*", share button, glass stat chips, and a glass segmented control **Stamps / Timeline / Map**. Timeline is the Journal view; Map comes later.
- Sheet:
  1. Stamp page (lined paper texture) with stamps, pending stamps and the next-stamp slot
  2. The selected `MemoryCard` (Journal entry) with the privacy toggle
  3. A dark plum "Bea asks" quick-memory card (one-tap rating, "Memories stay private unless you choose to share them")
  4. Cuisines tried chips
- **Share:** use the correct `wanderbite.co` URL. The share preview must exclude private notes, email and codes by default.

### Restaurants directory (not mocked)
- Use the same ticket/photo card system with fixed media ratios, reliable cuisine, neighborhood, price, and a short reason to visit.

---

## 10. Accessibility checklist

- Text contrast ≥ 4.5:1 (≥ 3:1 at 24px+). The colors in this spec were chosen to pass on their intended backgrounds.
- Use real `<button>`, `<a href>`, `<input>` + `<label>`. Give icon-only buttons an `aria-label`. Decorative SVGs get `aria-hidden="true"`.
- Avatar and status meaning must never rely on color alone (always pair it with a text label).
- The tab bar uses links with `aria-current="page"`. The Stamps/Timeline/Map control is either real links or a complete ARIA tabs pattern with arrow keys.
- The thinking steps container uses `aria-live="polite"`. Verification status updates are announced.
- Respect `prefers-reduced-motion`.
- Keep focus rings visible (2px `--wb-blush` on dark, 2px `--wb-violet` on cream).

---

## 11. Copy voice

Warm, short, first person from Bea, second person to the member. Use the member's first name sparingly (the greeting and the pick). Never overclaim: say "estimated", "can't confirm" and "pending" when they're true.
