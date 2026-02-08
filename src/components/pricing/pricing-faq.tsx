'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: 'Where is WanderBite available?',
    answer:
      'Currently, we are exclusively exploring the hidden gems of the Dallas Metroplex, but we are expanding soon!',
  },
  {
    question: 'Can I cancel anytime?',
    answer: 'Yes, one click in your profile.',
  },
  {
    question: 'Do the discounts expire?',
    answer: 'You have all month to use them.',
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

export function PricingFaq() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="mt-16 border-t pt-16">
      <h2 className="mb-8 text-xl font-semibold tracking-tight">Frequently Asked Questions</h2>
      <ul className="space-y-2">
        {FAQ_ITEMS.map((item, index) => (
          <li
            key={index}
            className="rounded-lg border bg-card"
          >
            <button
              type="button"
              onClick={() => setOpenIndex(openIndex === index ? null : index)}
              className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left font-medium transition-colors hover:bg-muted/50"
              aria-expanded={openIndex === index}
            >
              <span>{item.question}</span>
              <ChevronDown
                className={cn('size-5 shrink-0 transition-transform', openIndex === index && 'rotate-180')}
                aria-hidden
              />
            </button>
            <div
              className={cn(
                'overflow-hidden transition-all duration-200',
                openIndex === index ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0'
              )}
              aria-hidden={openIndex !== index}
            >
              <p className="border-t px-4 py-3 text-sm text-muted-foreground">
                {item.answer}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
