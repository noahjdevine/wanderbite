import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { hashPartnerPin } from '../src/lib/partner-pin';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(url, key);

  const { data: rows, error } = await supabase
    .from('restaurants')
    .select('id, name, pin, pin_hash');

  if (error) {
    console.error('Failed to list restaurants:', error.message);
    process.exit(1);
  }

  const candidates = (rows ?? []).filter(
    (r) => r.pin && r.pin.trim() && !r.pin_hash
  );

  console.log(`Found ${candidates.length} restaurants needing backfill`);

  let updated = 0;
  let skipped = 0;

  for (const row of candidates) {
    const plain = (row.pin ?? '').trim();
    if (!plain) { skipped++; continue; }

    const hash = await hashPartnerPin(plain);

    const { error: upErr } = await supabase
      .from('restaurants')
      .update({ pin_hash: hash })
      .eq('id', row.id);

    if (upErr) {
      console.error(`Failed for ${row.name} (${row.id}): ${upErr.message}`);
      skipped++;
    } else {
      console.log(`Hashed: ${row.name}`);
      updated++;
    }
  }

  console.log(`\nDone. Updated: ${updated}. Skipped: ${skipped}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
