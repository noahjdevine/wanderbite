import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bea, BEA_DISPLAY_NAME } from "@/components/bea/Bea";
import { pickBeaLine, BEA_FOUND_LINES } from "@/components/bea/copy";
import { resolveBeaFood } from "@/components/bea/food";
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

describe("component gallery gate", () => {
  it("is closed in production and open otherwise", () => {
    expect(isComponentGalleryEnabled("production")).toBe(false);
    expect(isComponentGalleryEnabled("development")).toBe(true);
    expect(isComponentGalleryEnabled("test")).toBe(true);
  });
});
