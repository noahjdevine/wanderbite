import { readFileSync } from "node:fs";
import path from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bea, type BeaState, BEA_DISPLAY_NAME } from "@/components/bea/Bea";
import { pickBeaLine, BEA_FOUND_LINES } from "@/components/bea/copy";
import { resolveBeaFood, type BeaFoodIndex } from "@/components/bea/food";
import { MemoryCard } from "@/components/wb/memory-card";
import { isComponentGalleryEnabled } from "@/lib/dev/component-gallery";

describe("Bea avatar", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  async function render(node: ReactElement) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(node);
    });
    return container;
  }

  it("names each state with the placeholder display name", async () => {
    const view = await render(
      <div>
        <Bea state="idle" />
        <Bea state="thinking" food={1} />
        <Bea state="found" />
      </div>
    );
    const labels = [...view.querySelectorAll("svg")].map((node) => node.getAttribute("aria-label"));
    expect(labels[0]).toBe(`${BEA_DISPLAY_NAME}, your Wanderbite concierge`);
    expect(labels[1]).toBe(`${BEA_DISPLAY_NAME} is thinking, taking a bite of nigiri`);
    expect(labels[2]).toBe(`${BEA_DISPLAY_NAME} found a pick for you`);
    expect(view.querySelector('[data-state="thinking"]')?.getAttribute("data-food")).toBe("1");
  });

  it("shows only the face below 48px", async () => {
    const view = await render(<Bea state="thinking" food={4} size={32} />);
    const svg = view.querySelector("svg");
    expect(svg?.getAttribute("data-face-only")).toBe("true");
    expect(svg?.getAttribute("aria-label")).toBe(`${BEA_DISPLAY_NAME} is thinking`);
    expect(svg?.querySelector(".bea-food")).toBeNull();
  });

  it("resolves food numbers and spec names onto one index", () => {
    expect(resolveBeaFood(0).label).toBe("dumpling");
    expect(resolveBeaFood("generic").index).toBe(0);
    expect(resolveBeaFood("sushi")).toEqual(resolveBeaFood(1));
    expect(resolveBeaFood("bbq").index).toBe(5);
    expect(resolveBeaFood(4).label).toBe("burger");
  });

  it("does not repeat the same Bea line twice in a row", () => {
    const first = pickBeaLine(BEA_FOUND_LINES);
    const second = pickBeaLine(BEA_FOUND_LINES, first);
    expect(second).not.toBe(first);
    expect(pickBeaLine(BEA_FOUND_LINES, BEA_FOUND_LINES[2])).toBe(BEA_FOUND_LINES[0]);
  });

  it("keeps a memory private until the share control is pressed", async () => {
    const view = await render(
      <MemoryCard
        name="The Yard"
        meta="Apr 26"
        note="A sunny patio."
        rating={5}
        photoLabel="YOUR PHOTO"
        editHref="#edit"
        addPhotoHref="#photo"
      />
    );
    expect(view.textContent).toContain("Private");
    expect(view.textContent).toContain("Only you can see this memory");
    const share = view.querySelector("button");
    expect(share?.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      share?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(view.textContent).toContain("Public");
    expect(share?.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Bea motion", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function mockMotion(reduce: boolean) {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }));
  }

  const states: BeaState[] = ["idle", "thinking", "found"];
  const foods: BeaFoodIndex[] = [0, 1, 2, 3, 4, 5];

  it("renders each state and food with a bite mark, the hand, crumbs, and the heart", () => {
    for (const state of states) {
      for (const food of foods) {
        const view = render(<Bea state={state} food={food} size={120} />);
        const svg = view.container.querySelector("svg");
        expect(svg?.getAttribute("data-state")).toBe(state);
        expect(svg?.getAttribute("data-food")).toBe(String(food));
        expect(svg?.getAttribute("data-face-only")).toBe("false");
        expect(svg?.querySelector(".bea-food")).not.toBeNull();
        expect(svg?.querySelector(".bea-hand")).not.toBeNull();
        expect(svg?.querySelectorAll(".bea-crumb")).toHaveLength(3);
        expect(svg?.querySelector(".bea-heart")).not.toBeNull();
        expect(svg?.querySelector(".bea-bite")?.getAttribute("data-bite")).toBe(String(food));
        view.unmount();
      }
    }
  });

  it("keeps the face only under 48px", () => {
    const view = render(<Bea state="found" food={3} size={32} />);
    const svg = view.container.querySelector("svg");
    expect(svg?.getAttribute("data-face-only")).toBe("true");
    expect(svg?.getAttribute("aria-label")).toBe(`${BEA_DISPLAY_NAME} found a pick for you`);
    expect(svg?.querySelector(".bea-face")).not.toBeNull();
    expect(svg?.querySelector(".bea-food")).toBeNull();
    expect(svg?.querySelector(".bea-hand")).toBeNull();
    expect(svg?.querySelector(".bea-crumb")).toBeNull();
    expect(svg?.querySelector(".bea-heart")).toBeNull();
    expect(svg?.querySelector(".bea-bite")).toBeNull();
  });

  it("keeps the found label while the hop chains into idle", () => {
    const css = readFileSync(path.resolve(__dirname, "../../app/styles/wanderbite-theme.css"), "utf8");
    const motion = css.slice(css.indexOf("/* ---------- Bea motion"), css.indexOf("/* Passport book"));
    expect(motion).toContain(
      "animation: bea-hop 1.5s cubic-bezier(0.2, 0.8, 0.2, 1) both, bea-bob 3.6s ease-in-out 1.5s infinite;"
    );
    expect(motion).toContain(':not([data-face-only="true"])[data-state="found"] .bea-body');
    expect(motion).toContain('[data-face-only="true"] .bea-face');
    expect(motion).not.toContain('[data-face-only="true"] .bea-body');
    const view = render(<Bea state="found" food={2} size={160} />);
    expect(view.container.querySelector("svg")?.getAttribute("aria-label")).toBe(
      `${BEA_DISPLAY_NAME} found a pick for you`
    );
    expect(view.container.querySelector("svg")?.getAttribute("data-state")).toBe("found");
  });

  it("eases a state change, then lets the stylesheet run", () => {
    mockMotion(false);
    vi.useFakeTimers();
    const view = render(<Bea state="thinking" food={1} size={140} />);
    view.rerender(<Bea state="found" food={1} size={140} />);
    const body = view.container.querySelector(".bea-body") as SVGElement;
    expect(body.style.animation).toBe("none");
    act(() => {
      vi.runAllTimers();
    });
    expect(body.style.animation).toBe("");
    expect(view.container.querySelector("svg")?.getAttribute("data-state")).toBe("found");
    expect(view.container.querySelector("svg")?.getAttribute("aria-label")).toBe(
      `${BEA_DISPLAY_NAME} found a pick for you`
    );
  });

  it("skips the pose handoff when reduced motion is on", () => {
    mockMotion(true);
    const view = render(<Bea state="thinking" food={4} size={140} />);
    view.rerender(<Bea state="found" food={4} size={140} />);
    expect(view.container.querySelector(".bea-body")?.getAttribute("style")).toBeNull();
    expect(view.container.querySelector("svg")?.getAttribute("data-state")).toBe("found");
    expect(view.container.querySelector("svg")?.getAttribute("aria-label")).toBe(
      `${BEA_DISPLAY_NAME} found a pick for you`
    );
  });

  it("lists every Bea animation selector under prefers-reduced-motion", () => {
    const css = readFileSync(path.resolve(__dirname, "../../app/styles/wanderbite-theme.css"), "utf8");
    const motion = css.slice(css.indexOf("/* ---------- Bea motion"), css.indexOf("/* Passport book"));
    const reduced = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)"),
      css.indexOf("/* ---------- Phase 0")
    );
    const names = new Set<string>();
    for (const block of motion.split("}")) {
      const [selector, body] = block.split("{");
      if (!body || !/animation\s*:/.test(body)) continue;
      for (const match of selector.matchAll(/\.([a-z0-9-]+)/g)) names.add(match[1]);
    }
    expect(names.size).toBeGreaterThan(8);
    for (const name of names) {
      expect(reduced, name).toContain(`.${name}`);
    }
    expect(reduced).toContain(".bea-bite { transform: scale(0) !important; }");
    expect(reduced).toContain("translate(-18%, 2%) rotate(-10deg)");
    expect(motion).toContain("@keyframes bea-blink-a");
    expect(motion).toContain("@keyframes bea-blink-b");
    const blinkB = motion.slice(motion.indexOf("@keyframes bea-blink-b"), motion.indexOf("@keyframes bea-hop"));
    expect(blinkB).toContain("64%, 80%");
    expect(blinkB).toContain("scaleY(0.08)");
  });
});

describe("component gallery gate", () => {
  it("is closed in production and open otherwise", () => {
    expect(isComponentGalleryEnabled("production")).toBe(false);
    expect(isComponentGalleryEnabled("development")).toBe(true);
    expect(isComponentGalleryEnabled("test")).toBe(true);
  });
});
