import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { isGooglePlacesOutboundDisabled } from '../src/lib/restaurant-image';
import { lookupBriefingPlace } from '../src/lib/briefings/places';
import {
  BRIEFING_OUTPUT_DIR,
  briefingInsertRow,
  briefingResearchAllowed,
  briefingResultReasons,
  callBriefingModel,
  formatBriefingReport,
  formatEstimatedUsd,
  isStorableOfficialWebsite,
  normalizeHttpsUrl,
  parseBriefingArgs,
  placesReportLine,
  researchCatalog,
  type BriefingRestaurant,
} from '../src/lib/briefings/research';
import type { Database } from '../src/types/database.types';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const HELP = `Operator-only first-visit briefing research.

Default is a dry-run. It reads active restaurants. When official_website is
set, that https URL is fetched first. A redirect from that URL may land on
another domain, and that page is the official page. Other page fetches do not
follow a redirect onto another domain. It asks Claude Haiku
(claude-haiku-4-5-20251001) to search with Anthropic's server-side web_search
tool (web_search_20260318, at most 3 searches, McKinney TX). It then fetches
those public https pages itself. The official site is first. Up to four
same-host subpages (menu, about, faq, visit, location, contact, hours,
reservations, parking, private-dining) are fetched from that site. A reputable
listing is next. robots.txt is respected. A disallowed listing host does not
use a page slot or another web search. HTML is kept up to 1.5 MB and the text
is capped. HTTP 403 skips that URL only. It asks Haiku for facts the page text
supports.

When GOOGLE_PLACES_API_KEY is set, it also calls Places API (New): Text Search
Essentials (IDs Only) with the name and address, then one Place Details
Enterprise + Atmosphere call. Boolean fields become fixed sentences. The model
does not write those sentences. Raw Places fields are not stored. place_id is
stored only on --write, and only when google_place_id is null. List prices
count toward the USD cap. The free monthly Places cap is not subtracted.

It writes a JSON and markdown report under .briefings/. It does not write the
database unless --write is set.

  npm run research:briefings
  npm run research:briefings -- --limit 5
  npm run research:briefings -- --write

--write inserts rows with status paused and is_sample false. An operator flips
a row to active after review. Existing rows for the same restaurant and field
are left in place.

The per-run cap is 25 restaurants and 2.00 USD unless --limit or
--cost-cap-cents sets a lower ceiling. --cost-cap-cents cannot raise the ceiling
above 5.00 USD.

Hosted reads and writes need Noah's separate OK, then
WANDERBITE_BRIEFINGS_HOSTED_OK=1 for that run only. Do not point this at hosted
as part of ordinary local review.

The challenge page does not call this script or the model. E06_BRIEFINGS_ENABLED
stays unset. This does not write credits, offers, visits, badges, or the member
AI ledger. The printed cost is an estimate from the published Haiku token rates,
Anthropic's web search price of $10 per 1,000 searches, and Places list prices
(Text Search Essentials IDs Only $0; Place Details Enterprise + Atmosphere $25
per 1,000). Those requests count toward the USD cap. A failed search is logged
for that restaurant.

Apply supabase/migrations/20261105202512_e06_a2_restaurant_official_website.sql
locally before this script. This script does not apply it. Propose URLs with
npm run research:official-websites and review them before --write.
`;

function redact(line: string): string {
  let out = line;
  for (const name of ['GOOGLE_PLACES_API_KEY', 'ANTHROPIC_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    const secret = process.env[name]?.trim() ?? '';
    if (secret.length >= 8) out = out.split(secret).join('[redacted]');
  }
  return out;
}

function fail(message: string): never {
  process.stderr.write(`${redact(message)}\n`);
  process.exit(1);
}

function client(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  if (!url || !key) {
    fail('briefing research needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  const allowed = briefingResearchAllowed(url);
  if (!allowed.ok) fail(allowed.reason);
  return createClient<Database>(url, key);
}

async function loadActiveRestaurants(
  supabase: SupabaseClient<Database>,
): Promise<BriefingRestaurant[]> {
  const { data, error } = await supabase
    .from('restaurants')
    .select('id, name, address, status, official_website, google_place_id, lat, lon')
    .eq('status', 'active')
    .order('name', { ascending: true });
  if (error) {
    if (error.message.includes('official_website')) {
      fail(
        'restaurants.official_website is missing. Apply supabase/migrations/20261105202512_e06_a2_restaurant_official_website.sql on the local database. This script does not apply it.',
      );
    }
    fail(`restaurant read failed: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    address: row.address,
    officialWebsite: row.official_website,
    googlePlaceId: row.google_place_id,
    lat: row.lat,
    lon: row.lon,
  }));
}

async function main(): Promise<void> {
  const parsed = parseBriefingArgs(process.argv.slice(2));
  if (parsed.error) fail(parsed.error);
  if (parsed.help) {
    process.stdout.write(HELP);
    return;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? '';
  if (!apiKey) {
    fail('ANTHROPIC_API_KEY is not set. Dry-run still calls the model and does not use the member AI budget.');
  }
  const supabase = client();
  if (parsed.write) {
    const allowed = briefingResearchAllowed(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
    if (!allowed.ok) fail(allowed.reason);
  }
  const restaurants = await loadActiveRestaurants(supabase);
  const placesKey = process.env.GOOGLE_PLACES_API_KEY?.trim() ?? '';
  const now = new Date();
  const run = await researchCatalog({
    restaurants,
    fetchImpl: fetch,
    callModel: (input) => callBriefingModel({ ...input, apiKey }),
    apiKey,
    now,
    restaurantCap: parsed.restaurantCap,
    costCapMicrodollars: parsed.costCapMicrodollars,
    placesLookup: (restaurant) =>
      lookupBriefingPlace({
        restaurant,
        apiKey: placesKey,
        fetchImpl: fetch,
        outboundDisabled: isGooglePlacesOutboundDisabled(),
        purpose: 'facts',
        normalizeUrl: normalizeHttpsUrl,
        acceptWebsite: (url) => isStorableOfficialWebsite(url, restaurant.name, restaurant.address),
      }),
  });
  let inserted = 0;
  let skipped = 0;
  if (parsed.write) {
    for (const restaurant of run.restaurants) {
      for (const fact of restaurant.facts) {
        const existing = await supabase
          .from('restaurant_briefing_facts')
          .select('id')
          .eq('restaurant_id', restaurant.restaurantId)
          .eq('field', fact.field)
          .maybeSingle();
        if (existing.error) fail(`fact lookup failed: ${existing.error.message}`);
        if (existing.data) {
          skipped += 1;
          process.stdout.write(`skip existing ${restaurant.restaurantName} ${fact.field}\n`);
          continue;
        }
        const row = briefingInsertRow(fact, restaurant.restaurantId, run.verifiedAt);
        const insert = await supabase.from('restaurant_briefing_facts').insert(row);
        if (insert.error) fail(`fact insert failed: ${insert.error.message}`);
        inserted += 1;
        process.stdout.write(`inserted paused ${restaurant.restaurantName} ${fact.field}\n`);
      }
      if (restaurant.placeIdToStore) {
        const update = await supabase
          .from('restaurants')
          .update({ google_place_id: restaurant.placeIdToStore })
          .eq('id', restaurant.restaurantId)
          .is('google_place_id', null);
        if (update.error) fail(`place_id update failed: ${update.error.message}`);
        process.stdout.write(`stored place_id ${restaurant.restaurantName}\n`);
      }
    }
  }
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const dir = path.join(process.cwd(), BRIEFING_OUTPUT_DIR);
  mkdirSync(dir, { recursive: true });
  const report = formatBriefingReport(run);
  const jsonPath = path.join(dir, `run-${stamp}.json`);
  const mdPath = path.join(dir, `run-${stamp}.md`);
  writeFileSync(jsonPath, report.json, { encoding: 'utf8', mode: 0o600 });
  writeFileSync(mdPath, report.markdown, { encoding: 'utf8', mode: 0o600 });
  const webSearches = run.restaurants.reduce(
    (sum, restaurant) => sum + (restaurant.units.web_search_requests ?? 0),
    0,
  );
  for (const restaurant of run.restaurants) {
    const reasons = briefingResultReasons(restaurant).join(' | ');
    process.stdout.write(
      redact(
        `${restaurant.restaurantName} facts=${restaurant.facts.length} input=${restaurant.units.input ?? 0} output=${restaurant.units.output ?? 0} web_searches=${restaurant.units.web_search_requests ?? 0} ${placesReportLine(restaurant.units)} estimated_usd=${formatEstimatedUsd(restaurant.estimatedMicrodollars)} reasons=${reasons}\n`,
      ),
    );
  }
  process.stdout.write(
    redact(
      `mode=${parsed.write ? 'write' : 'dry-run'} restaurants=${run.restaurants.length} inserted=${inserted} skipped=${skipped} input=${run.totals.input} output=${run.totals.output} web_searches=${webSearches} estimated_usd=${formatEstimatedUsd(run.totals.estimatedMicrodollars)} report=${path.relative(process.cwd(), mdPath)}\n`,
    ),
  );
  if (run.stoppedBecause) process.stdout.write(`stopped: ${run.stoppedBecause}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'briefing research failed';
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
