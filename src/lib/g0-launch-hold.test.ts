import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAUNCH_HOLD_BODY, LAUNCH_HOLD_HEADING } from '@/components/launch-hold-notice';

const ROOT = path.resolve(__dirname, '../..');

const ANNUAL_PRICE_PATTERNS: { name: string; re: RegExp }[] = [
  { name: '$120', re: /\$120/ },
  { name: 'Save $60 a year', re: /Save \$60 a year/i },
  { name: 'billing interval annual', re: /BillingInterval/ },
  { name: "literal 'annual' plan", re: /['"]annual['"]/ },
  { name: '$120/year copy', re: /\$120\/year/ },
];

const CHECKOUT_UI_FILES = [
  'src/components/pricing/pricing-client.tsx',
  'src/components/onboarding/OnboardingWizard.tsx',
  'src/components/dashboard/paywall-card.tsx',
  'src/components/landing/club-section.tsx',
  'src/app/(site)/billing/page.tsx',
];

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      walkTsFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

describe('G0 launch-hold copy', () => {
  it('uses non-collecting Launching soon language', () => {
    expect(LAUNCH_HOLD_HEADING).toBe('Launching soon');
    expect(LAUNCH_HOLD_BODY.toLowerCase()).toContain('paused');
    expect(LAUNCH_HOLD_BODY.toLowerCase()).toContain('not collecting');
  });

  it('does not advertise an annual price in product UI', () => {
    const files = walkTsFiles(path.join(ROOT, 'src'));
    const hits: string[] = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file).replaceAll('\\', '/');
      if (rel.startsWith('src/types/')) continue;
      const src = readFileSync(file, 'utf8');
      for (const pattern of ANNUAL_PRICE_PATTERNS) {
        if (pattern.re.test(src)) {
          hits.push(`${rel}: ${pattern.name}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('removes checkout initiation from onboarding, pricing, paywall, and club CTAs', () => {
    for (const rel of CHECKOUT_UI_FILES) {
      const src = readFileSync(path.join(ROOT, rel), 'utf8');
      expect(src, rel).not.toMatch(/createCheckoutSession/);
      expect(src, rel).toMatch(/LaunchHoldNotice|Launching soon/);
      expect(src, rel).not.toMatch(/<form[\s\S]*waitlist/i);
      expect(src, rel).not.toMatch(/type=["']email["']/);
    }
  });

  it('documents CHECKOUT_ENABLED as fail-closed in .env.example', () => {
    const example = readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    expect(example).toMatch(/# CHECKOUT_ENABLED=/);
    expect(example).toMatch(/exact string "true"/);
    expect(example).not.toMatch(/^CHECKOUT_ENABLED=true$/m);
  });
});
