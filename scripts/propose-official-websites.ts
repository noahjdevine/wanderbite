import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { isGooglePlacesOutboundDisabled } from '../src/lib/restaurant-image';
import {
  proposeRestaurantWebsite,
  type OfficialWebsiteProposal,
} from '../src/lib/briefings/official-website';
import {
  BRIEFING_OUTPUT_DIR,
  briefingResearchAllowed,
  formatEstimatedUsd,
  parseBriefingArgs,
  placesReportLine,
  type BriefingRestaurant,
} from '../src/lib/briefings/research';
import type { Database } from '../src/types/database.types';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const MIGRATION = 'supabase/migrations/20261105202512_e06_a2_restaurant_official_website.sql';

const HELP = `Operator-only official website proposals for active restaurants.

Default is a dry-run. It prints one https URL per restaurant and does not
write the database. Read that list, then re-run with --write.

  npm run research:official-websites
  npm run research:official-websites -- --limit 5
  npm run research:official-websites -- --write

When GOOGLE_PLACES_API_KEY is set, the proposal is the Place Details websiteUri
(Text Search Essentials IDs Only, then Place Details Enterprise). The raw
Places response is not stored. --write stores the https URL on
restaurants.official_website when that column is null, and stores place_id on
restaurants.google_place_id when that column is null.

When the Places key is unset, the script uses the same Anthropic web search as
npm run research:briefings and proposes the first official host, or the first
https host that is not a listing and not a blocked host. A city or location
word in the name, including McKinney, does not count as the restaurant's host.
Yelp, OpenTable, visitmckinney.com, Toast (toasttab.com), Nextdoor,
Roadtrippers, Mindtrip, and joe.coffee are not stored. If the results are only
those hosts, the search continues for the restaurant's own domain. A content
path such as /gallery or /visit is stored as the site root. A chain location
path such as /locations/mckinney is kept.

An existing official_website is left in place. --write does not insert
briefing facts and does not set a fact to active.

The per-run cap is 25 restaurants and 2.00 USD unless --limit or
--cost-cap-cents sets a lower ceiling. Places list prices count toward that cap.
The free monthly Places cap is not subtracted.

Hosted reads and writes need Noah's separate OK, then
WANDERBITE_BRIEFINGS_HOSTED_OK=1 for that run only.

E06_BRIEFINGS_ENABLED stays unset. This does not apply
${MIGRATION}.
`;

function redact(line: string): string {
  let out = line;
  for (const name of ['GOOGLE_PLACES_API_KEY', 'ANTHROPIC_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    const secret = process.env[name]?.trim() ?? '';
    if (secret.length >= 8) out = out.split(secret).join('[redacted]');
  }
  return out;
}

function say(line: string): void {
  process.stdout.write(`${redact(line)}\n`);
}

function fail(message: string): never {
  process.stderr.write(`${redact(message)}\n`);
  process.exit(1);
}

function client(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  if (!url || !key) {
    fail('official website proposals need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
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
        `restaurants.official_website is missing. Apply ${MIGRATION} on the local database. This script does not apply it.`,
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

function proposalLine(proposal: OfficialWebsiteProposal): string {
  const current = proposal.current ?? '(none)';
  const proposed = proposal.proposed ?? '(none)';
  const place = proposal.placeId ? ` place_id=${proposal.placeId}` : '';
  const store = proposal.placeIdToStore ? ' place_id_to_store=yes' : '';
  const review = proposal.kind === 'unclassified' ? ' REVIEW' : '';
  return `${proposal.restaurantName} current=${current} proposed=${proposed} source=${proposal.kind}${review}${place}${store} ${placesReportLine(proposal.units)} estimated_usd=${formatEstimatedUsd(proposal.estimatedMicrodollars)}`;
}

async function main(): Promise<void> {
  const parsed = parseBriefingArgs(process.argv.slice(2));
  if (parsed.error) fail(parsed.error);
  if (parsed.help) {
    process.stdout.write(HELP);
    return;
  }
  const placesKey = process.env.GOOGLE_PLACES_API_KEY?.trim() ?? '';
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim() ?? '';
  if (!placesKey && !anthropicKey && !isGooglePlacesOutboundDisabled()) {
    fail('Set GOOGLE_PLACES_API_KEY or ANTHROPIC_API_KEY. Dry-run still calls that source and does not write.');
  }
  const supabase = client();
  const restaurants = await loadActiveRestaurants(supabase);
  const proposals: OfficialWebsiteProposal[] = [];
  let spent = 0;
  let stoppedBecause: string | null = null;
  for (const restaurant of restaurants) {
    if (proposals.length >= parsed.restaurantCap) {
      stoppedBecause = `restaurant cap ${parsed.restaurantCap}`;
      break;
    }
    if (spent >= parsed.costCapMicrodollars) {
      stoppedBecause = `cost cap ${formatEstimatedUsd(parsed.costCapMicrodollars)} USD`;
      break;
    }
    const proposal = await proposeRestaurantWebsite({
      restaurant,
      placesKey,
      anthropicKey,
      fetchImpl: fetch,
    });
    proposals.push(proposal);
    spent += proposal.estimatedMicrodollars;
    if (spent >= parsed.costCapMicrodollars) {
      stoppedBecause = `cost cap ${formatEstimatedUsd(parsed.costCapMicrodollars)} USD`;
      break;
    }
  }

  say('Official website proposals. Read this list before any write.');
  for (const proposal of proposals) {
    say(proposalLine(proposal));
    for (const note of proposal.notes) say(`  note: ${note}`);
  }
  if (stoppedBecause) say(`stopped: ${stoppedBecause}`);
  say(
    `estimated_usd=${formatEstimatedUsd(spent)} restaurants=${proposals.length} mode=${parsed.write ? 'write' : 'dry-run'}`,
  );

  let wroteSites = 0;
  let wrotePlaces = 0;
  let kept = 0;
  if (!parsed.write) {
    say('dry-run: no rows written. Re-run with --write after reviewing the list above.');
  } else {
    const allowed = briefingResearchAllowed(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
    if (!allowed.ok) fail(allowed.reason);
    for (const proposal of proposals) {
      if (proposal.current) {
        kept += 1;
        say(`kept existing official_website ${proposal.restaurantName}`);
      } else if (proposal.proposed) {
        const update = await supabase
          .from('restaurants')
          .update({ official_website: proposal.proposed })
          .eq('id', proposal.restaurantId)
          .is('official_website', null);
        if (update.error) fail(`official_website update failed: ${update.error.message}`);
        wroteSites += 1;
        say(`stored official_website ${proposal.restaurantName} ${proposal.proposed}`);
      }
      if (proposal.placeIdToStore) {
        const update = await supabase
          .from('restaurants')
          .update({ google_place_id: proposal.placeIdToStore })
          .eq('id', proposal.restaurantId)
          .is('google_place_id', null);
        if (update.error) fail(`place_id update failed: ${update.error.message}`);
        wrotePlaces += 1;
        say(`stored place_id ${proposal.restaurantName}`);
      }
    }
    say(`wrote_official_website=${wroteSites} wrote_place_id=${wrotePlaces} kept_existing=${kept}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(process.cwd(), BRIEFING_OUTPUT_DIR);
  mkdirSync(dir, { recursive: true });
  const reportPath = path.join(dir, `official-websites-${stamp}.md`);
  const body = [
    '# Official website proposals',
    '',
    `Mode: ${parsed.write ? 'write' : 'dry-run'}`,
    `Estimated cost: ${formatEstimatedUsd(spent)} USD`,
    stoppedBecause ? `Stopped: ${stoppedBecause}` : 'Stopped: completed the selected restaurants',
    '',
    ...proposals.flatMap((proposal) => [proposalLine(proposal), ...proposal.notes.map((note) => `- ${note}`), '']),
    '',
  ].join('\n');
  writeFileSync(reportPath, redact(body), { encoding: 'utf8', mode: 0o600 });
  say(`report=${path.relative(process.cwd(), reportPath)}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'official website proposals failed';
  process.stderr.write(`${redact(message)}\n`);
  process.exit(1);
});
