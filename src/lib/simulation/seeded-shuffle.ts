/**
 * Deterministic shuffle for the supply gate.
 *
 * `generate.ts` mentions a `src/lib/challenges/**` crypto rule and satisfies it
 * with `node:crypto` `randomInt`. The file that states that rule was not found
 * (the only mention is the comment in `generate.ts`). This PRNG stays outside
 * `src/lib/challenges` so the gate never calls `Math.random`.
 */

/** mulberry32. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates over a copy. One closure advances one PRNG for the whole trial. */
export function createSeededShuffle(seed: number): <T>(items: readonly T[]) => T[] {
  const random = mulberry32(seed);
  return <T>(items: readonly T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const current = out[i];
      const swap = out[j];
      if (current === undefined || swap === undefined) continue;
      out[i] = swap;
      out[j] = current;
    }
    return out;
  };
}
