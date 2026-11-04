/**
 * BeaAvatar — Wanderbite's AI concierge (placeholder name "Bea").
 *
 * States:
 *  - "idle":     blinks and bobs gently
 *  - "thinking": takes a bite of the requested cuisine, chews, crumbs fly (loops)
 *  - "found":    happy squint + floating heart
 *
 * Below 48px it renders the face only (chat avatar / app icon size).
 * Requires the "bea-*" keyframes from wanderbite-theme.css.
 * Placeholder until a Rive version replaces it (see BEA_AI_SPEC.md §2).
 *
 * Usage:
 *   <BeaAvatar state="thinking" food="sushi" size={160} />
 *   <BeaAvatar size={28} />            // chat avatar (face only)
 */
import { useId, type CSSProperties, type ReactElement } from "react";

export type BeaState = "idle" | "thinking" | "found";
export type BeaFood = "sushi" | "pizza" | "taco" | "dumpling" | "burger" | "bbq" | "generic";

type Props = {
  state?: BeaState;
  food?: BeaFood | null;
  size?: number;           // rendered width in px
  label?: string;          // accessible label override
  className?: string;
};

const LOOP = "4.2s";

export function BeaAvatar({ state = "idle", food = null, size = 120, label, className }: Props) {
  const uid = useId().replace(/:/g, "");
  const gradId = `bea-g-${uid}`;
  const maskId = `bea-m-${uid}`;
  const faceOnly = size < 48;
  const showFood = state === "thinking" && !faceOnly;
  const foodKind = normalizeFood(food);

  const aria =
    label ??
    (state === "thinking"
      ? `Bea is thinking${showFood ? `, taking a bite of ${foodKind}` : ""}`
      : state === "found"
        ? "Bea found a pick for you"
        : "Bea, your Wanderbite concierge");

  const gradient = (
    <radialGradient id={gradId} cx="35%" cy="28%" r="80%">
      <stop offset="0" stopColor="#ffffff" />
      <stop offset=".12" stopColor="#fbcfe8" />
      <stop offset=".45" stopColor="#a78bfa" />
      <stop offset=".8" stopColor="#6d28d9" />
      <stop offset="1" stopColor="#3b0764" />
    </radialGradient>
  );

  /* ---------- Face only (small sizes) ---------- */
  if (faceOnly) {
    return (
      <svg
        role="img"
        aria-label={aria}
        width={size}
        height={size}
        viewBox="0 0 100 100"
        className={className}
      >
        <defs>{gradient}</defs>
        <circle cx="50" cy="50" r="48" fill={`url(#${gradId})`} />
        <ellipse cx="37" cy="44" rx="6" ry="8.5" fill="#1d1033" />
        <ellipse cx="63" cy="44" rx="6" ry="8.5" fill="#1d1033" />
        <path d="M38 64 Q50 74 62 64" fill="none" stroke="#3b0764" strokeWidth="6" strokeLinecap="round" />
      </svg>
    );
  }

  /* ---------- Full character ---------- */
  const anim = (name: string, extra = ""): CSSProperties => ({
    transformBox: "fill-box",
    transformOrigin: "center",
    animation: `${name} ${LOOP} ${extra} infinite`.replace(/\s+/g, " "),
  });

  const bodyStyle: CSSProperties =
    state === "thinking"
      ? { transformBox: "fill-box", transformOrigin: "50% 100%", animation: `bea-squash ${LOOP} ease-in-out infinite` }
      : { transformBox: "fill-box", transformOrigin: "50% 100%", animation: "bea-bob 3.2s ease-in-out infinite" };

  const eyeStyle: CSSProperties =
    state === "thinking" ? anim("bea-squint") : { transformBox: "fill-box", transformOrigin: "center", animation: "bea-blink 4s ease-in-out infinite" };

  // Wider viewBox when holding food, square otherwise
  const viewBox = showFood ? "0 0 200 140" : "20 18 120 120";
  const height = showFood ? Math.round(size * 0.7) : size;

  return (
    <svg
      role="img"
      aria-label={aria}
      width={size}
      height={height}
      viewBox={viewBox}
      className={className}
      style={{ overflow: "visible" }}
    >
      <defs>
        {gradient}
        {showFood && (
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="140">
            <rect width="200" height="140" fill="#fff" />
            <circle cx="114" cy="90" r="10" fill="#000" style={anim("bea-bite")} />
            <circle cx="117" cy="101" r="7" fill="#000" style={anim("bea-bite")} />
          </mask>
        )}
      </defs>

      <ellipse cx="80" cy="132" rx="38" ry="5" fill="rgba(0,0,0,0.25)" />

      {/* Body */}
      <g style={bodyStyle}>
        <circle cx="80" cy="78" r="50" fill={`url(#${gradId})`} />
        <ellipse cx="60" cy="50" rx="14" ry="7" fill="#fff" opacity=".45" transform="rotate(-30 60 50)" />
        <circle cx="58" cy="86" r="6" fill="#f472b6" opacity=".55" />
        <circle cx="104" cy="84" r="6" fill="#f472b6" opacity=".55" />

        {state === "found" ? (
          <>
            <path d="M64 70 Q70 62 76 70" fill="none" stroke="#1d1033" strokeWidth="4" strokeLinecap="round" />
            <path d="M90 70 Q96 62 102 70" fill="none" stroke="#1d1033" strokeWidth="4" strokeLinecap="round" />
            <path d="M74 88 Q83 98 92 88" fill="#3b0764" stroke="#3b0764" strokeWidth="3" strokeLinecap="round" />
          </>
        ) : (
          <>
            <ellipse cx="70" cy="68" rx="4.5" ry="6.5" fill="#1d1033" style={eyeStyle} />
            <ellipse cx="96" cy="68" rx="4.5" ry="6.5" fill="#1d1033" style={eyeStyle} />
            {state === "thinking" ? (
              <ellipse cx="88" cy="91" rx="7" ry="4.5" fill="#3b0764" style={anim("bea-mouth")} />
            ) : (
              <path d="M74 88 Q83 95 92 88" fill="none" stroke="#3b0764" strokeWidth="3.5" strokeLinecap="round" />
            )}
          </>
        )}
      </g>

      {/* Food + hand */}
      {showFood && (
        <>
          <g style={{ transformBox: "fill-box", transformOrigin: "0% 50%", animation: `bea-move ${LOOP} ease-in-out infinite` }}>
            <g mask={`url(#${maskId})`}>{FOODS[foodKind]}</g>
            <circle cx="134" cy="113" r="7" fill="#7c3aed" />
          </g>
          {[
            { cx: 104, cy: 94, r: 2.2, dx: "16px", dy: "-18px" },
            { cx: 102, cy: 98, r: 1.8, dx: "22px", dy: "4px" },
            { cx: 100, cy: 92, r: 1.6, dx: "6px", dy: "-24px" },
          ].map((c, i) => (
            <circle
              key={i}
              cx={c.cx}
              cy={c.cy}
              r={c.r}
              fill={CRUMB[foodKind]}
              style={{ ["--dx" as string]: c.dx, ["--dy" as string]: c.dy, animation: `bea-crumb ${LOOP} infinite` } as CSSProperties}
            />
          ))}
        </>
      )}

      {/* Heart on found */}
      {state === "found" && (
        <path
          d="M118 44 c-3 -4 -9 -1 -6 4 l6 6 l6 -6 c3 -5 -3 -8 -6 -4z"
          fill="#ffc9d6"
          style={{ transformBox: "fill-box", transformOrigin: "center", animation: "bea-heart 1.6s ease-out both" }}
        />
      )}
    </svg>
  );
}

/* ---------- Food artwork (coordinates in the 200x140 viewBox) ---------- */

type FoodKey = "sushi" | "pizza" | "taco" | "dumpling";

function normalizeFood(food: BeaFood | null): FoodKey {
  switch (food) {
    case "sushi":
    case "pizza":
    case "taco":
    case "dumpling":
      return food;
    default:
      return "dumpling"; // neutral default; add burger/bbq art later
  }
}

const CRUMB: Record<FoodKey, string> = {
  sushi: "#fed7aa",
  pizza: "#fcd34d",
  taco: "#fbbf24",
  dumpling: "#fdf4e3",
};

const FOODS: Record<FoodKey, ReactElement> = {
  sushi: (
    <>
      <rect x="114" y="93" width="48" height="16" rx="8" fill="#fffaf0" stroke="#eadfcb" strokeWidth="1.5" />
      <rect x="111" y="82" width="54" height="15" rx="7.5" fill="#fb923c" />
      <path d="M123 84 l-4 11 M135 84 l-4 11 M147 84 l-4 11 M159 84 l-4 11" stroke="#ffedd5" strokeWidth="2.5" strokeLinecap="round" />
    </>
  ),
  pizza: (
    <>
      <path d="M110 95 L164 74 L164 116 Z" fill="#fcd34d" />
      <rect x="160" y="72" width="9" height="46" rx="4.5" fill="#d97706" />
      <circle cx="140" cy="95" r="5" fill="#dc2626" />
      <circle cx="154" cy="85" r="4" fill="#dc2626" />
      <circle cx="154" cy="105" r="4" fill="#dc2626" />
    </>
  ),
  taco: (
    <>
      <path d="M112 84 Q114 80 120 82 Q126 76 132 82 Q138 76 144 82 Q150 76 156 82 Q162 78 164 84 Z" fill="#4ade80" />
      <circle cx="128" cy="83" r="3" fill="#ef4444" />
      <circle cx="148" cy="82" r="3" fill="#ef4444" />
      <path d="M110 84 A28 26 0 0 0 166 84 Z" fill="#fbbf24" />
      <path d="M118 92 A20 18 0 0 0 158 92" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  dumpling: (
    <>
      <path d="M110 108 Q112 78 138 78 Q164 78 166 108 Z" fill="#fdf4e3" stroke="#e9dcc3" strokeWidth="1.5" />
      <path d="M126 81 q3 7 0 12 M138 79 q3 7 0 12 M150 81 q3 7 0 12" fill="none" stroke="#dccbaa" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
};

export default BeaAvatar;
