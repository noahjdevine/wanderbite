import { BEA_DISPLAY_NAME } from "./name";

/** Personality lines from BEA_AI_SPEC §1. Rotate; don't repeat the same line twice in a row. */
export const BEA_GREETINGS = [
  "Good evening, {name}.",
  "Hungry, {name}?",
  "What are we feeling tonight?",
] as const;

export const BEA_THINKING_TITLES = [
  `${BEA_DISPLAY_NAME}'s on it…`,
  "Ooh, let me think…",
  "Give me a sec…",
] as const;

export const BEA_FOUND_LINES = [
  "Ooh, I've got one for you.",
  "Okay, I'm pretty excited about this one.",
  "Found it.",
] as const;

export function pickBeaLine<T extends string>(lines: readonly T[], previous?: T): T {
  if (lines.length === 0) {
    throw new Error("Bea copy bank is empty");
  }
  if (previous === undefined) return lines[0];
  const current = lines.indexOf(previous);
  if (current === -1) return lines[0];
  return lines[(current + 1) % lines.length];
}

export function fillBeaName(line: string, name: string): string {
  return line.replaceAll("{name}", name);
}
