"use client";

import { useEffect, useRef, useState } from "react";
import { Bea, type BeaState } from "@/components/bea/Bea";
import type { BeaFoodIndex } from "@/components/bea/food";

const FOODS: BeaFoodIndex[] = [0, 1, 2, 3, 4, 5];
const FOOD_NAMES = ["Dumpling", "Nigiri", "Pizza", "Taco", "Burger", "BBQ"] as const;
const STATES: BeaState[] = ["idle", "thinking", "found"];
const SIZES = [32, 120, 320] as const;

const PLUM = "#120a24";
const CREAM = "#faf6ef";

export function BeaGallery() {
  const [state, setState] = useState<BeaState>("idle");
  const [food, setFood] = useState<BeaFoodIndex>(1);
  const [size, setSize] = useState<(typeof SIZES)[number]>(120);
  const [note, setNote] = useState("Idle");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const bucket = timers;
    return () => {
      for (const timer of bucket.current) window.clearTimeout(timer);
    };
  }, []);

  function clearTimers() {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current.length = 0;
  }

  function later(delay: number, next: BeaState, label: string) {
    const timer = window.setTimeout(() => {
      setState(next);
      setNote(label);
    }, delay);
    timers.current.push(timer);
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-4 lg:grid-cols-2">
        <SwitcherPanel background={PLUM} color="#fff" title="Switcher on plum" state={state} food={food} size={size} note={note} />
        <SwitcherPanel background={CREAM} color="#2a1442" title="Switcher on cream" state={state} food={food} size={size} note={note} />
      </div>
      <div className="flex flex-wrap gap-2">
        {STATES.map((next) => (
          <button
            key={next}
            type="button"
            aria-pressed={state === next}
            className="min-h-11 rounded-full border border-white/30 bg-white/10 px-4 text-sm font-semibold capitalize text-white"
            onClick={() => {
              clearTimers();
              setState(next);
              setNote(next);
            }}
          >
            {next}
          </button>
        ))}
        <button
          type="button"
          className="min-h-11 rounded-full bg-white px-4 text-sm font-semibold text-[#2a1442]"
          onClick={() => {
            clearTimers();
            setState("idle");
            setNote("Idle");
            later(500, "thinking", "Thinking");
            later(2200, "found", "Found");
            later(4200, "idle", "Back to idle");
          }}
        >
          Idle, thinking, found, idle
        </button>
        <button
          type="button"
          className="min-h-11 rounded-full bg-[#ffc9d6] px-4 text-sm font-semibold text-[#2a1442]"
          onClick={() => {
            clearTimers();
            setState("thinking");
            setNote("Thinking, bite in progress");
            later(1800, "found", "Found, from mid-bite");
          }}
        >
          Thinking to found mid-bite
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {FOODS.map((next) => (
          <button
            key={next}
            type="button"
            aria-pressed={food === next}
            className="min-h-11 rounded-full border border-white/25 px-3 text-sm text-white"
            onClick={() => setFood(next)}
          >
            {FOOD_NAMES[next]}
          </button>
        ))}
        {SIZES.map((next) => (
          <button
            key={next}
            type="button"
            aria-pressed={size === next}
            className="min-h-11 rounded-full border border-white/25 px-3 text-sm text-white"
            onClick={() => setSize(next)}
          >
            {next}px
          </button>
        ))}
      </div>
      <Stage background={PLUM} color="#fff" label="Every state and food on plum" />
      <Stage background={CREAM} color="#2a1442" label="Every state and food on cream" />
    </div>
  );
}

function Stage({
  background,
  color,
  label,
}: {
  background: string;
  color: string;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-6 rounded-[28px] px-4 py-6" style={{ background, color }}>
      <h3 className="font-display m-0 text-[28px] font-normal">{label}</h3>
      {STATES.map((state) => (
        <div key={state} className="flex flex-col gap-2">
          <p className="m-0 text-xs font-semibold tracking-[0.14em] uppercase opacity-70">{state}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {FOODS.map((food) => (
              <figure key={`${state}-${food}`} className="m-0 flex flex-col items-center gap-1">
                <Bea state={state} food={food} size={120} />
                <figcaption className="text-sm font-semibold">{FOOD_NAMES[food]}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-8">
        {SIZES.map((size) => (
          <figure key={size} className="m-0 flex flex-col items-center gap-1">
            <Bea state={size < 48 ? "idle" : "thinking"} food={0} size={size} />
            <figcaption className="text-xs opacity-70">{size}px</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function SwitcherPanel({
  background,
  color,
  title,
  state,
  food,
  size,
  note,
}: {
  background: string;
  color: string;
  title: string;
  state: BeaState;
  food: BeaFoodIndex;
  size: number;
  note: string;
}) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-[28px] px-4 py-6" style={{ background, color }}>
      <h3 className="font-display m-0 text-[26px] font-normal">{title}</h3>
      <Bea state={state} food={food} size={size} />
      <p className="m-0 text-sm opacity-80">{note}</p>
    </div>
  );
}
