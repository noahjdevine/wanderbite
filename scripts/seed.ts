// scripts/seed.ts
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Use service_role so seed bypasses RLS (recommended for seeding)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (or ANON key) in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function seed() {
  console.log('🌱 Starting Seed...');

  const { data: market, error: marketError } = await supabase
    .from('markets')
    .insert({
      name: 'McKinney, TX',
      timezone: 'America/Chicago',
      status: 'active',
    })
    .select()
    .single();

  if (marketError) throw marketError;
  if (!market) throw new Error('Market insert returned no data');

  const restaurants = [
    {
      name: 'Hutchins BBQ',
      tags: ['bbq', 'meat', 'casual'],
      address: '1301 N Tennessee St, McKinney, TX 75069',
      lat: 33.2113,
      lon: -96.6124,
      offers: { discount: 1000, min_spend: 4000 },
    },
    {
      name: 'Ricks Chophouse',
      tags: ['steakhouse', 'fine-dining', 'date-night'],
      address: '107 N Kentucky St, McKinney, TX 75069',
      lat: 33.1972,
      lon: -96.6156,
      offers: { discount: 1500, min_spend: 7500 },
    },
    {
      name: 'The Yard',
      tags: ['american', 'burgers', 'patio', 'social'],
      address: '107 S Church St, McKinney, TX 75069',
      lat: 33.1966,
      lon: -96.6163,
      offers: { discount: 1000, min_spend: 3500 },
    },
    {
      name: 'Local Yocal BBQ & Grill',
      tags: ['bbq', 'american', 'worth-trip'],
      address: '350 E Louisiana St, McKinney, TX 75069',
      lat: 33.1981,
      lon: -96.6111,
      offers: { discount: 1000, min_spend: 5000 },
    },
  ];

  for (const r of restaurants) {
    console.log(`...Adding Restaurant: ${r.name}`);

    const { data: org, error: orgError } = await supabase
      .from('restaurant_orgs')
      .insert({ name: r.name, market_id: market.id })
      .select()
      .single();

    if (orgError) throw new Error(`restaurant_orgs: ${r.name}: ${orgError.message}`);
    if (!org) throw new Error(`restaurant_orgs: ${r.name}: no data returned`);

    const { data: venue, error: venueError } = await supabase
      .from('restaurants')
      .insert({
        org_id: org.id,
        market_id: market.id,
        name: r.name,
        cuisine_tags: r.tags,
        address: r.address,
        lat: r.lat,
        lon: r.lon,
        status: 'active',
      })
      .select()
      .single();

    if (venueError) throw new Error(`restaurants: ${r.name}: ${venueError.message}`);
    if (!venue) throw new Error(`restaurants: ${r.name}: no data returned`);

    const { error: offerError } = await supabase.from('restaurant_offers').insert({
      restaurant_id: venue.id,
      discount_amount_cents: r.offers.discount,
      min_spend_cents: r.offers.min_spend,
      max_redemptions_per_month: 50,
      active: true,
    });

    if (offerError) throw new Error(`restaurant_offers: ${r.name}: ${offerError.message}`);
  }

  console.log('✅ Seed Complete! Database is populated.');
}

seed().catch((e) => {
  console.error('❌ Seed Failed:', e);
  process.exit(1);
});
