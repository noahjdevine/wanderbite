'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: 'Where is WanderBite available?',
    answer:
      'Wanderbite currently serves McKinney, Texas. We are not collecting waitlist details.',
  },
  {
    question: 'Can I cancel anytime?',
    answer: 'Yes, one click in your profile.',
  },
  {
    question: 'Do the discounts expire?',
    answer:
      'Yes, you have 30 days to use your discounts from the moment you generate the challenge. This keeps the adventure fresh!',
  },
  {
    question: "What if I don't like the restaurant?",
    answer: 'We get it. You get 1 free swap per month to reroll your adventure.',
  },
  {
    question: 'How often can I patron the same spot?',
    answer:
      'Variety is spice! Restaurants are limited to two visits per year, with a minimum 6-month gap between visits.',
  },
];

type PricingFaqProps = {
  /**
   * Golden Hour classes for /how-it-works only.
   * The default keeps the previous pricing-page classes.
   */
  tone?: 'default' | 'golden';
};

export function PricingFaq({ tone = 'default' }: PricingFaqProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const golden = tone === 'golden';

  return (
    <section className={golden ? 'mt-16 border-t border-wb-line pt-16' : 'mt-16 border-t pt-16'}>
      <h2
        className={
          golden
            ? 'mb-8 font-display text-[28px] leading-none font-normal text-wb-ink'
            : 'mb-8 text-xl font-semibold tracking-tight'
        }
      >
        Frequently Asked Questions
      </h2>
      <ul className="space-y-2">
        {FAQ_ITEMS.map((item, index) => (
          <li
            key={index}
            className={
              golden
                ? 'rounded-[22px] border border-wb-line bg-white shadow-[var(--wb-shadow-card)]'
                : 'rounded-lg border bg-card'
            }
          >
            <button
              type="button"
              onClick={() => setOpenIndex(openIndex === index ? null : index)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                if (event.repeat) return;
                setOpenIndex(openIndex === index ? null : index);
              }}
              className={
                golden
                  ? 'flex min-h-11 w-full items-center justify-between gap-4 px-4 py-4 text-left font-medium text-wb-ink hover:bg-wb-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wb-violet'
                  : 'flex w-full items-center justify-between gap-4 px-4 py-4 text-left font-medium transition-colors hover:bg-muted/50'
              }
              aria-expanded={openIndex === index}
            >
              <span>{item.question}</span>
              <ChevronDown
                className={
                  golden
                    ? cn(
                        'size-5 shrink-0 text-wb-plum motion-safe:transition-transform motion-reduce:transition-none',
                        openIndex === index && 'rotate-180',
                      )
                    : cn('size-5 shrink-0 transition-transform', openIndex === index && 'rotate-180')
                }
                aria-hidden
              />
            </button>
            <div
              className={
                golden
                  ? cn(
                      'overflow-hidden motion-safe:transition-all motion-safe:duration-200 motion-reduce:transition-none',
                      openIndex === index ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0',
                    )
                  : cn(
                      'overflow-hidden transition-all duration-200',
                      openIndex === index ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0',
                    )
              }
              aria-hidden={openIndex !== index}
            >
              <p
                className={
                  golden
                    ? 'border-t border-wb-line px-4 py-3 text-sm text-wb-muted'
                    : 'border-t px-4 py-3 text-sm text-muted-foreground'
                }
              >
                {item.answer}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
