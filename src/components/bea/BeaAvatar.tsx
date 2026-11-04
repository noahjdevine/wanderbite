"use client";

/**
 * SVG Bea. Import this only from Bea.tsx.
 *
 * Motion is CSS in wanderbite-theme.css (Noah, 2026-11-04): bob, breathe,
 * two blink cycles, the thinking bite, and a found hop that chains into idle.
 * A state change holds the current pose and eases it to the shared rest pose
 * before the next loop, so a mid-bite handoff does not snap. Found stays on
 * the found label; the idle motion after the hop is the CSS chain, not a timer.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactElement, type Ref } from "react";
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

const HANDOFF_MS = 200;
const HANDOFF_SELECTOR = ".bea-body, .bea-breathe, .bea-face, .bea-food-motion, .bea-food-wobble, .bea-bite";

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

function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function restTransform(node: SVGElement): string {
  if (node.classList.contains("bea-bite")) return "scale(0)";
  return "none";
}

function clearHandoff(node: SVGElement) {
  node.style.animation = "";
  node.style.transition = "";
  node.style.transform = "";
}

/**
 * Keeps `data-state` on the pose that is actually on screen until the outgoing
 * transform has been copied. The stylesheet then eases that copy to rest.
 */
function useBeaHandoff(state: BeaState) {
  const [shown, setShown] = useState(state);
  const shownRef = useRef(state);
  const rootRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const previous = shownRef.current;
    if (previous === state) return;
    const svg = rootRef.current;
    if (!svg || prefersReducedMotion()) {
      shownRef.current = state;
      setShown(state);
      return () => {
        shownRef.current = previous;
      };
    }

    const nodes = [...svg.querySelectorAll<SVGElement>(HANDOFF_SELECTOR)];
    for (const node of nodes) {
      const transform = getComputedStyle(node).transform;
      node.style.animation = "none";
      node.style.transform = transform && transform !== "none" ? transform : "none";
    }
    shownRef.current = state;
    setShown(state);

    const frame = window.requestAnimationFrame(() => {
      for (const node of nodes) {
        node.style.transition = `transform ${HANDOFF_MS}ms cubic-bezier(0.22, 0.8, 0.3, 1)`;
        node.style.transform = restTransform(node);
      }
    });
    const timer = window.setTimeout(() => {
      for (const node of nodes) clearHandoff(node);
    }, HANDOFF_MS + 40);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      shownRef.current = previous;
    };
  }, [state]);

  return { shown, rootRef };
}

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

/**
 * Mask hole on the side nearest her mouth. It lives inside the moving food
 * group, so the bite travels with the food. Scale 0 leaves the food whole.
 */
function biteMark(index: BeaFoodIndex): ReactElement {
  const hole: Record<BeaFoodIndex, ReactElement> = {
    0: (
      <>
        <ellipse cx="141" cy="98" rx="11" ry="9" />
        <ellipse cx="149" cy="108" rx="7" ry="5.5" />
      </>
    ),
    1: (
      <>
        <ellipse cx="134" cy="96" rx="10" ry="8" />
        <ellipse cx="142" cy="104" rx="6" ry="5" />
      </>
    ),
    2: (
      <>
        <path d="M132 92 Q140 86 148 96 Q140 108 130 100 Q128 96 132 92 Z" />
      </>
    ),
    3: (
      <>
        <ellipse cx="132" cy="94" rx="10" ry="8" />
        <ellipse cx="140" cy="102" rx="6" ry="5" />
      </>
    ),
    4: (
      <>
        <ellipse cx="140" cy="112" rx="11" ry="9" />
        <circle cx="148" cy="102" r="6" />
      </>
    ),
    5: (
      <>
        <ellipse cx="142" cy="100" rx="10" ry="8" />
        <ellipse cx="150" cy="108" rx="6" ry="5" />
      </>
    ),
  };
  return (
    <g className="bea-bite" data-bite={index} fill="#000">
      {hole[index]}
    </g>
  );
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

function Face({ tiny }: { tiny: boolean }) {
  if (tiny) {
    return (
      <>
        <g className="bea-blink-a">
          <g className="bea-blink-b">
            <g className="bea-idle-eyes">
              <ellipse className="bea-eye" cx="38" cy="48" rx="5.5" ry="7.5" fill="#1d1033" />
              <ellipse className="bea-eye" cx="62" cy="48" rx="5.5" ry="7.5" fill="#1d1033" />
            </g>
          </g>
        </g>
        <g className="bea-found-eyes">
          <path d="M32 50 Q38 42 44 50" fill="none" stroke="#1d1033" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M56 50 Q62 42 68 50" fill="none" stroke="#1d1033" strokeWidth="3.5" strokeLinecap="round" />
        </g>
        <path className="bea-mouth-idle" d="M40 66 Q50 76 60 66" fill="none" stroke="#3b0764" strokeWidth="4" strokeLinecap="round" />
        <ellipse className="bea-mouth-think" cx="52" cy="68" rx="6" ry="4" fill="#3b0764" />
        <path className="bea-mouth-found" d="M40 64 Q50 78 60 64" fill="#3b0764" />
      </>
    );
  }
  return (
    <>
      <g className="bea-blink-a">
        <g className="bea-blink-b">
          <g className="bea-idle-eyes">
            <ellipse className="bea-eye" cx="68" cy="72" rx="5" ry="7" fill="#1d1033" />
            <ellipse className="bea-eye" cx="96" cy="72" rx="5" ry="7" fill="#1d1033" />
          </g>
        </g>
      </g>
      <g className="bea-found-eyes">
        <path d="M60 74 Q68 62 76 74" fill="none" stroke="#1d1033" strokeWidth="4" strokeLinecap="round" />
        <path d="M88 74 Q96 62 104 74" fill="none" stroke="#1d1033" strokeWidth="4" strokeLinecap="round" />
      </g>
      <path className="bea-mouth-idle" d="M72 90 Q84 98 96 90" fill="none" stroke="#3b0764" strokeWidth="3.5" strokeLinecap="round" />
      <ellipse className="bea-mouth-think" cx="88" cy="92" rx="7" ry="4.5" fill="#3b0764" />
      <path className="bea-mouth-found" d="M70 88 Q84 104 98 88" fill="#3b0764" />
    </>
  );
}

function crumbStyle(dx: string, dy: string, delay: string): CSSProperties {
  return { "--dx": dx, "--dy": dy, animationDelay: delay } as CSSProperties;
}

export function BeaAvatar({ state = "idle", food = 0, size = 120, label, className }: Props) {
  const uid = useId().replace(/:/g, "");
  const gradId = `bea-g-${uid}`;
  const maskId = `bea-bite-${uid}`;
  const faceOnly = size < 48;
  const resolved = resolveBeaFood(food);
  const aria = labelFor(state, resolved.label, faceOnly, label);
  const { shown, rootRef } = useBeaHandoff(state);
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
        ref={rootRef as Ref<SVGSVGElement>}
        role="img"
        aria-label={aria}
        width={size}
        height={size}
        viewBox="0 0 100 100"
        className={`bea-avatar ${className ?? ""}`.trim()}
        data-state={shown}
        data-food={resolved.index}
        data-face-only="true"
      >
        <defs>{gradient}</defs>
        <g className="bea-face">
          <circle cx="50" cy="50" r="48" fill={`url(#${gradId})`} />
          <ellipse cx="36" cy="42" rx="16" ry="8" fill="#fff" opacity="0.45" transform="rotate(-28 36 42)" />
          <circle cx="34" cy="62" r="5" fill="#f472b6" opacity="0.55" />
          <circle cx="66" cy="62" r="5" fill="#f472b6" opacity="0.55" />
          <Face tiny />
        </g>
      </svg>
    );
  }

  return (
    <svg
      ref={rootRef as Ref<SVGSVGElement>}
      role="img"
      aria-label={aria}
      width={size}
      height={Math.round(size * 0.7)}
      viewBox="0 0 200 140"
      className={`bea-avatar ${className ?? ""}`.trim()}
      data-state={shown}
      data-food={resolved.index}
      data-face-only="false"
      style={{ overflow: "visible" }}
    >
      <defs>{gradient}</defs>

      <ellipse className="bea-shadow" cx="80" cy="128" rx="36" ry="5" fill="rgba(0,0,0,0.28)" />

      <g className="bea-body">
        <g className="bea-breathe">
          <circle cx="80" cy="78" r="50" fill={`url(#${gradId})`} />
          <ellipse cx="58" cy="52" rx="16" ry="8" fill="#fff" opacity="0.5" transform="rotate(-32 58 52)" />
          <circle cx="58" cy="90" r="6.5" fill="#f472b6" opacity="0.55" />
          <circle cx="104" cy="88" r="6.5" fill="#f472b6" opacity="0.55" />
          <Face tiny={false} />
        </g>
      </g>

      <g className="bea-food">
        <g className="bea-food-motion">
          <rect className="bea-metric" x="0" y="0" width="200" height="140" fill="none" />
          <g className="bea-food-wobble">
            <mask id={maskId} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="200" height="140">
              <rect x="0" y="0" width="200" height="140" fill="#fff" />
              {biteMark(resolved.index)}
            </mask>
            <g mask={`url(#${maskId})`}>{foodArt(resolved.index)}</g>
            <circle className="bea-hand" cx={hand.cx} cy={hand.cy} r="7" fill="#7c3aed" />
          </g>
        </g>
      </g>
      <g className="bea-crumb" style={crumbStyle("28%", "-36%", "0s")}>
        <rect className="bea-metric" x="88" y="78" width="40" height="36" fill="none" />
        <circle cx="108" cy="96" r="2.2" fill={CRUMBS[resolved.index]} />
      </g>
      <g className="bea-crumb" style={crumbStyle("42%", "16%", "0.1s")}>
        <rect className="bea-metric" x="86" y="82" width="40" height="36" fill="none" />
        <circle cx="104" cy="100" r="1.8" fill={CRUMBS[resolved.index]} />
      </g>
      <g className="bea-crumb" style={crumbStyle("18%", "-48%", "0.18s")}>
        <rect className="bea-metric" x="84" y="74" width="40" height="36" fill="none" />
        <circle cx="102" cy="92" r="1.6" fill={CRUMBS[resolved.index]} />
      </g>

      <g className="bea-heart">
        <rect className="bea-metric" x="100" y="6" width="56" height="58" fill="none" />
        <path d="M128 18 c-8 -12 -24 -4 -16 8 l16 18 l16 -18 c8 -12 -8 -20 -16 -8z" fill="#ffc9d6" />
      </g>
    </svg>
  );
}
