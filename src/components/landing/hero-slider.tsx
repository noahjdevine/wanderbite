'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

const SLIDES = [
  {
    id: 'cocktail',
    src: 'https://images.unsplash.com/photo-1514362545857-3bc16549766b?w=1920&q=80',
    alt: 'Moody cocktail bar',
  },
  {
    id: 'restaurant',
    src: 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=1920&q=80',
    alt: 'Restaurant vibe, lively',
  },
  {
    id: 'plated',
    src: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1920&q=80',
    alt: 'Plated food',
  },
] as const;

const ROTATE_MS = 5000;

export function HeroSlider() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setActiveIndex((i) => (i + 1) % SLIDES.length);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="relative min-h-[85vh] w-full overflow-hidden" aria-label="Hero">
      {/* Background image slider */}
      {SLIDES.map((slide, index) => (
        <div
          key={slide.id}
          className="absolute inset-0 transition-opacity duration-700 ease-in-out"
          style={{
            opacity: activeIndex === index ? 1 : 0,
            zIndex: 0,
          }}
          aria-hidden={activeIndex !== index}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={slide.src}
            alt=""
            className="h-full w-full object-cover"
            fetchPriority={index === 0 ? 'high' : undefined}
          />
        </div>
      ))}

      {/* Dark gradient overlay for readability */}
      <div
        className="absolute inset-0 z-[1] bg-gradient-to-t from-black/80 via-black/50 to-black/40"
        aria-hidden
      />

      {/* Headline and CTA */}
      <div className="relative z-10 flex min-h-[85vh] flex-col items-center justify-center px-4 py-20 text-center sm:px-6">
        <h1 className="mx-auto max-w-4xl text-4xl font-bold tracking-tight text-white drop-shadow-lg sm:text-5xl md:text-6xl">
          Dining Adventures, Curated for You.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-white/90 drop-shadow sm:text-xl">
          Stop arguing about where to eat.
        </p>
        <div className="mt-10">
          <Button size="lg" asChild className="shadow-lg">
            <Link href="/login">Start Your Journey</Link>
          </Button>
        </div>
      </div>

      {/* Slide indicators */}
      <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 gap-2" aria-hidden>
        {SLIDES.map((_, index) => (
          <button
            key={index}
            type="button"
            onClick={() => setActiveIndex(index)}
            className={`h-2 w-2 rounded-full transition-colors sm:h-2.5 sm:w-2.5 ${
              activeIndex === index ? 'bg-white' : 'bg-white/50 hover:bg-white/70'
            }`}
            aria-label={`Go to slide ${index + 1}`}
          />
        ))}
      </div>
    </section>
  );
}
