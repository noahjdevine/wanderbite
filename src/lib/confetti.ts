/**
 * Lightweight wrapper around canvas-confetti. Loaded dynamically so it never
 * affects the initial bundle, and skipped entirely when the user prefers
 * reduced motion.
 */
export async function celebrate(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  try {
    const confetti = (await import('canvas-confetti')).default;
    const burst = (originX: number) =>
      confetti({
        particleCount: 60,
        spread: 70,
        startVelocity: 45,
        origin: { x: originX, y: 0.6 },
        colors: ['#FF6B35', '#F7B801', '#E84855', '#2EC4B6', '#7C3AED'],
        scalar: 0.9,
      });

    burst(0.3);
    window.setTimeout(() => burst(0.7), 150);
  } catch {
    // Confetti is non-essential; ignore load/runtime failures.
  }
}
