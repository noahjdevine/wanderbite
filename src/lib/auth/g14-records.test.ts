import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      walk(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

const API_ROUTES = [
  'src/app/api/csp-report/route.ts',
  'src/app/api/restaurant-image/[id]/route.ts',
  'src/app/api/roulette/route.ts',
  'src/app/api/webhooks/stripe/route.ts',
  'src/app/api/cron/stripe-reconcile/route.ts',
  'src/app/api/cron/webhook-outbox/route.ts',
  'src/app/api/cron/reset-swap-counters/route.ts',
  'src/app/api/cron/expire-issued-redemptions/route.ts',
  'src/app/api/cron/issue-monthly-challenges/route.ts',
  'src/app/api/cron/end-of-month-reminder/route.ts',
  'src/app/api/cron/refresh-restaurant-photos/route.ts',
];

const EXPORTED_ACTIONS = [
  'addRestaurant',
  'generateMissingSlugs',
  'deleteRestaurant',
  'setRestaurantPin',
  'attachGoogleMetadataToLatestRestaurantByName',
  'searchRestaurantsFromGoogle',
  'getRestaurantDetailsFromGoogle',
  'enrichSingleRestaurant',
  'enrichAllRestaurants',
] as const;

describe('G14 records', () => {
  it('records SEC-14 settings as needing live confirmation', () => {
    const doc = source('Docs/g14-sec-14.md');
    expect(doc).toMatch(/not confirmed from code/i);
    expect(doc).toMatch(/does not prove they are enabled/i);
    for (const setting of [
      'Email verification',
      'Password protections',
      'Session lifetime',
      'MFA support',
    ]) {
      expect(doc).toContain(setting);
      expect(doc).toContain('Needs live confirmation');
    }
    expect(doc.toLowerCase()).not.toContain('settings are enabled');
    expect(doc.toLowerCase()).not.toContain('dashboard confirms');
  });

  it('records lost-factor recovery without a production bypass', () => {
    const doc = source('Docs/g14-admin-mfa-runbook.md');
    expect(doc).toMatch(/verify the admin's identity/i);
    expect(doc).toMatch(/admin_audit_log/);
    expect(doc).toMatch(/before any factor deletion/i);
    expect(doc).toMatch(/logs the user out of all active sessions/i);
    expect(doc).toMatch(/no environment flag, query parameter, or shared secret/i);
    expect(doc).toMatch(/auth\.admin\.mfa\.deleteFactor/);
    expect(doc).toMatch(/https:\/\/supabase.com\/docs\/reference\/javascript\/auth-admin-deletefactor/);

    const appFiles = walk(path.join(ROOT, 'src')).filter(
      (file) =>
        (file.endsWith('.ts') || file.endsWith('.tsx')) &&
        !file.endsWith('.test.ts') &&
        !file.endsWith('.test.tsx'),
    );
    const offenders = appFiles.filter((file) => {
      const body = readFileSync(file, 'utf8');
      return /mfa\.deleteFactor|MFA_BYPASS|skipMfa|skip_mfa/.test(body);
    });
    expect(offenders).toEqual([]);
  });

  it('records the protected admin actions and that no export endpoint exists', () => {
    const doc = source('Docs/g14-admin-entry-points.md');
    for (const name of EXPORTED_ACTIONS) {
      expect(doc).toContain(name);
    }
    expect(doc).toMatch(/No sensitive export endpoint exists/i);

    const srcFiles = walk(path.join(ROOT, 'src'));
    const exportHits = srcFiles.filter((file) => {
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) return false;
      if (!file.endsWith('.ts') && !file.endsWith('.tsx')) return false;
      const body = readFileSync(file, 'utf8').toLowerCase();
      return body.includes('content-disposition') || body.includes('text/csv');
    });
    expect(exportHits).toEqual([]);

    const routes = walk(path.join(ROOT, 'src/app/api'))
      .filter((file) => file.endsWith(`${path.sep}route.ts`))
      .map((file) => path.relative(ROOT, file).split(path.sep).join('/'))
      .sort();
    expect(routes).toEqual([...API_ROUTES].sort());

    const migrations = readdirSync(path.join(ROOT, 'supabase/migrations'));
    expect(migrations.filter((name) => /g14|mfa/i.test(name))).toEqual([]);
  });
});
