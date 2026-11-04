/**
 * SVG stand-in for Bea. Import this only from Bea.tsx.
 * Motion lives in wanderbite-theme.css (idle bob, blink, thinking bite, found hop).
 */
import { useId, type CSSProperties, type ReactElement } from "react";
import { resolveBeaFood, type BeaFood, type BeaFoodIndex } from "./food";
import { BEA_DISPLAY_NAME } from "./name";

export type BeaState = "idle" | "thinking" | "found";

type Props = {
  state?: BeaState;
  food?: BeaFood | null;
  size?: number;
  label?: string;
  className?: string;
};

const CRUMBS: Record<BeaFoodIndex, string> = {
  0: "#fdf4e3",
  1: "#fed7aa",
  2: "#fcd34d",
  3: "#fbbf24",
  4: "#e7c8a0",
  5: "#fdba74",
};

const HAND: Record<BeaFoodIndex, { cx: number; cy: number }> = {
  0: { cx: 150, cy: 114 },
  1: { cx: 152, cy: 112 },
  2: { cx: 158, cy: 118 },
  3: { cx: 150, cy: 112 },
  4: { cx: 154, cy: 122 },
  5: { cx: 164, cy: 108 },
};

function foodArt(index: BeaFoodIndex): ReactElement {
  switch (index) {
    case 1:
      return (
        <>
          <path d="M132 108 H166 Q174 108 174 100 Q174 92 166 92 H128 Q136 98 130 104 Q124 108 132 108 Z" fill="#fffaf0" stroke="#eadfcb" strokeWidth="1.5" />
          <path d="M136 93 H168 Q176 93 176 86 Q176 79 168 79 H130 Q140 84 132 90 Q126 93 136 93 Z" fill="#fb923c" />
          <path d="M148 81 l-4 10 M158 81 l-4 10" stroke="#ffedd5" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M128 86 Q138 92 130 100" fill="none" stroke="#c2410c" strokeWidth="1.5" strokeLinecap="round" />
        </>
      );
    case 2:
      return (
        <>
          <path d="M136 102 Q128 96 136 88 L168 74 L168 116 Z" fill="#fcd34d" />
          <rect x="164" y="72" width="9" height="46" rx="4.5" fill="#d97706" />
          <circle cx="152" cy="98" r="4.5" fill="#dc2626" />
          <circle cx="160" cy="88" r="3.5" fill="#dc2626" />
          <path d="M132 90 Q142 98 134 106" fill="none" stroke="#b45309" strokeWidth="1.5" strokeLinecap="round" />
        </>
      );
    case 3:
      return (
        <>
          <path d="M132 84 Q138 78 146 84 Q154 78 162 84 Q168 80 170 86 L140 86 Q132 84 128 90 Q136 86 132 84 Z" fill="#4ade80" />
          <circle cx="150" cy="83" r="3" fill="#ef4444" />
          <path d="M126 90 Q134 84 142 92 A26 22 0 0 0 170 88 Q150 112 126 96 Q120 92 126 90 Z" fill="#fbbf24" />
          <path d="M134 96 A16 12 0 0 0 160 96" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" />
          <path d="M124 90 Q132 98 126 104" fill="none" stroke="#d97706" strokeWidth="1.5" strokeLinecap="round" />
        </>
      );
    case 4:
      return (
        <>
          <path d="M138 96 Q132 90 140 84 Q156 74 168 96 Q150 100 140 96 Q134 100 138 96 Z" fill="#f6c56b" />
          <circle cx="152" cy="88" r="1.4" fill="#fff4d6" />
          <circle cx="160" cy="86" r="1.4" fill="#fff4d6" />
          <path d="M136 100 Q148 96 160 102 Q168 96 170 100" fill="none" stroke="#4ade80" strokeWidth="3" strokeLinecap="round" />
          <path d="M134 104 L170 100 L168 110 L140 114 Q132 108 134 104 Z" fill="#fbbf24" />
          <path d="M136 112 H166 Q168 118 164 120 H142 Q132 116 136 112 Z" fill="#7c3a2d" />
          <path d="M134 120 Q150 132 168 118 L166 124 Q148 136 136 124 Q128 122 134 120 Z" fill="#e8a84a" />
          <path d="M132 96 Q142 106 134 116" fill="none" stroke="#b45309" strokeWidth="1.5" strokeLinecap="round" />
        </>
      );
    case 5:
      return (
        <>
          <rect x="156" y="70" width="5" height="46" rx="2.5" fill="#d6d3d1" transform="rotate(20 158 93)" />
          <path d="M148 90 Q140 86 136 94 Q130 104 142 110 Q160 116 170 104 Q176 94 164 88 Q156 92 148 90 Z" fill="#9a3412" />
          <path d="M150 92 Q144 96 148 104 Q156 108 164 100 Q158 94 150 92 Z" fill="#c2410c" />
          <path d="M134 94 Q144 102 136 110" fill="none" stroke="#7c2d12" strokeWidth="1.6" strokeLinecap="round" />
          <rect x="150" y="86" width="14" height="5" rx="2.5" fill="#f5e6d3" transform="rotate(-16 157 88)" />
        </>
      );
    default:
      return (
        <>
          <path d="M146 112 Q138 104 142 94 Q130 88 138 82 Q168 78 174 112 Q160 104 150 108 Q142 112 146 112 Z" fill="#fdf4e3" stroke="#e9dcc3" strokeWidth="1.5" />
          <path d="M150 84 q3 7 0 12 M160 83 q3 7 0 12" fill="none" stroke="#dccbaa" strokeWidth="2" strokeLinecap="round" />
          <path d="M136 90 Q146 98 138 108" fill="none" stroke="#c4b49a" strokeWidth="1.6" strokeLinecap="round" />
        </>
      );
  }
}

function labelFor(state: BeaState, foodLabel: string, faceOnly: boolean, label?: string): string {
  if (label) return label;
  if (state === "thinking") {
    return faceOnly
      ? `${BEA_DISPLAY_NAME} is thinking`
      : `${BEA_DISPLAY_NAME} is thinking, taking a bite of ${foodLabel}`;
  }
  if (state === "found") return `${BEA_DISPLAY_NAME} found a pick for you`;
  return `${BEA_DISPLAY_NAME}, your Wanderbite concierge`;
}

export function BeaAvatar({ state = "idle", food = 0, size = 120, label, className }: Props) {
  const uid = useId().replace(/:/g, "");
  const gradId = `bea-g-${uid}`;
  const faceOnly = size < 48;
  const resolved = resolveBeaFood(food);
  const aria = labelFor(state, resolved.label, faceOnly, label);
  const hand = HAND[resolved.index];

  const gradient = (
    <radialGradient id={gradId} cx="32%" cy="30%" r="80%">
      <stop offset="0" stopColor="#ffffff" />
      <stop offset="0.14" stopColor="#fbcfe8" />
      <stop offset="0.48" stopColor="#a78bfa" />
      <stop offset="0.78" stopColor="#6d28d9" />
      <stop offset="1" stopColor="#3b0764" />
    </radialGradient>
  );

  if (faceOnly) {
    return (
      <svg
        role="img"
        aria-label={aria}
        width={size}
        height={size}
        viewBox="0 0 100 100"
        className={`bea-avatar ${className ?? ""}`.trim()}
        data-state={state}
        data-food={resolved.index}
        data-face-only="true"
      >
        <defs>{gradient}</defs>
        <circle cx="50" cy="50" r="48" fill={`url(#${gradId})`} />
        <ellipse cx="36" cy="42" rx="16" ry="8" fill="#fff" opacity="0.45" transform="rotate(-28 36 42)" />
        <circle cx="34" cy="62" r="5" fill="#f472b6" opacity="0.55" />
        <circle cx="66" cy="62" r="5" fill="#f472b6" opacity="0.55" />
        <g className="bea-idle-eyes">
          <ellipse className="bea-eye" cx="38" cy="48" rx="5.5" ry="7.5" fill="#1d1033" />
          <ellipse className="bea-eye" cx="62" cy="48" rx="5.5" ry="7.5" fill="#1d1033" />
        </g>
        <g className="bea-found-eyes">
          <path d="M32 50 Q38 42 44 50" fill="none" stroke="#1d1033" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M56 50 Q62 42 68 50" fill="none" stroke="#1d1033" strokeWidth="3.5" strokeLinecap="round" />
        </g>
        <path className="bea-mouth-idle" d="M40 66 Q50 76 60 66" fill="none" stroke="#3b0764" strokeWidth="4" strokeLinecap="round" />
        <ellipse className="bea-mouth-think" cx="52" cy="68" rx="6" ry="4" fill="#3b0764" />
        <path className="bea-mouth-found" d="M40 64 Q50 78 60 64" fill="#3b0764" />
      </svg>
    );
  }

  const crumbStyle = (dx: string, dy: string, delay: string): CSSProperties =>
    ({ "--dx": dx, "--dy": dy, animationDelay: delay }) as CSSProperties;

  return (
    <svg
      role="img"
      aria-label={aria}
      width={size}
      height={Math.round(size * 0.7)}
      viewBox="0 0 200 140"
      className={`bea-avatar ${className ?? ""}`.trim()}
      data-state={state}
      data-food={resolved.index}
      data-face-only="false"
      style={{ overflow: "visible" }}
    >
      <defs>{gradient}</defs>

      <ellipse cx="80" cy="128" rx="36" ry="5" fill="rgba(0,0,0,0.28)" />

      <g className="bea-body">
        <circle cx="80" cy="78" r="50" fill={`url(#${gradId})`} />
        <ellipse cx="58" cy="52" rx="16" ry="8" fill="#fff" opacity="0.5" transform="rotate(-32 58 52)" />
        <circle cx="58" cy="90" r="6.5" fill="#f472b6" opacity="0.55" />
        <circle cx="104" cy="88" r="6.5" fill="#f472b6" opacity="0.55" />
        <g className="bea-idle-eyes">
          <ellipse className="bea-eye" cx="68" cy="72" rx="5" ry="7" fill="#1d1033" />
          <ellipse className="bea-eye" cx="96" cy="72" rx="5" ry="7" fill="#1d1033" />
        </g>
        <g className="bea-found-eyes">
          <path d="M60 74 Q68 64 76 74" fill="none" stroke="#1d1033" strokeWidth="4" strokeLinecap="round" />
          <path d="M88 74 Q96 64 104 74" fill="none" stroke="#1d1033" strokeWidth="4" strokeLinecap="round" />
        </g>
        <path className="bea-mouth-idle" d="M72 90 Q84 98 96 90" fill="none" stroke="#3b0764" strokeWidth="3.5" strokeLinecap="round" />
        <ellipse className="bea-mouth-think" cx="88" cy="92" rx="7" ry="4.5" fill="#3b0764" />
        <path className="bea-mouth-found" d="M72 88 Q84 102 96 88" fill="#3b0764" />
      </g>

      <g className="bea-food">
        <g className="bea-food-motion">
          {foodArt(resolved.index)}
          <circle cx={hand.cx} cy={hand.cy} r="7" fill="#7c3aed" />
        </g>
      </g>
      <circle className="bea-crumb" cx="108" cy="96" r="2.2" fill={CRUMBS[resolved.index]} style={crumbStyle("16px", "-18px", "0s")} />
      <circle className="bea-crumb" cx="104" cy="100" r="1.8" fill={CRUMBS[resolved.index]} style={crumbStyle("22px", "6px", "0.08s")} />
      <circle className="bea-crumb" cx="102" cy="92" r="1.6" fill={CRUMBS[resolved.index]} style={crumbStyle("8px", "-22px", "0.16s")} />

      <path
        className="bea-heart"
        d="M118 46 c-3 -4 -9 -1 -6 4 l6 6 l6 -6 c3 -5 -3 -8 -6 -4z"
        fill="#ffc9d6"
      />
    </svg>
  );
}
