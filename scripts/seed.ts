// scripts/seed.ts
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { DEMO_RECIPE_SEEDS, DEMO_RECIPE_SOURCE_NAME } from './fixtures/e05-demo-recipes';
import { SAMPLE_ACTIVITY_SEEDS } from './fixtures/e06-sample-activities';
import { SAMPLE_BRIEFING_SEEDS } from './fixtures/e06-sample-briefings';
import { chicagoCalendarDate, shiftCalendarDate } from '../src/lib/activities/match';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Service role is required: G8 revoked client writes on markets/orgs/restaurants.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL in .env.local');
  process.exit(1);
}
if (!supabaseServiceKey) {
  console.error(
    'Missing SUPABASE_SERVICE_ROLE_KEY in .env.local. Seed cannot use the anon key after G8 table grants.'
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function seed() {
  console.log('🌱 Starting Seed...');

  const { data: market, error: marketError } = await supabase
    .from('markets')
    .insert({
      name: 'McKinney, TX',
      slug: 'mckinney-tx',
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

  const venueIds = new Map<string, string>();

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
    venueIds.set(r.name, venue.id);
  }

  for (const recipe of DEMO_RECIPE_SEEDS) {
    const restaurantId = venueIds.get(recipe.restaurantName);
    if (!restaurantId) {
      throw new Error(`demo recipe restaurant missing: ${recipe.restaurantName}`);
    }
    const { error: recipeError } = await supabase.from('recipes').insert({
      slug: recipe.slug,
      title: recipe.title,
      recipe_type: 'inspired_by',
      restaurant_id: restaurantId,
      servings: recipe.servings,
      est_minutes: recipe.estMinutes,
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      substitutions: recipe.substitutions,
      dietary_tags: recipe.dietaryTags,
      source_url: null,
      source_name: DEMO_RECIPE_SOURCE_NAME,
      rights_basis: 'original',
      visibility: 'published',
      checked_at: recipe.checkedAt,
      version: 1,
      is_demo: true,
    });
    if (recipeError) throw new Error(`recipes: ${recipe.slug}: ${recipeError.message}`);
  }

  const today = chicagoCalendarDate(new Date());
  const verifiedAt = new Date().toISOString();
  for (const activity of SAMPLE_ACTIVITY_SEEDS) {
    const { error: activityError } = await supabase.from('activities').insert({
      name: activity.name,
      category: activity.category,
      source_url: activity.sourceUrl,
      lat: activity.lat,
      lon: activity.lon,
      zip: activity.zip,
      typical_duration_minutes: activity.typicalDurationMinutes,
      cost_category: activity.costCategory,
      hours_note: null,
      valid_from: activity.dated ? today : null,
      valid_until: activity.dated ? shiftCalendarDate(today, 14) : null,
      weather_dependent: activity.weatherDependent,
      booking_required: activity.bookingRequired,
      last_verified_at: verifiedAt,
      status: 'active',
      is_sample: true,
      version: 1,
    });
    if (activityError) throw new Error(`activities: ${activity.name}: ${activityError.message}`);
  }

  const briefingVerifiedAt = new Date().toISOString();
  for (const briefing of SAMPLE_BRIEFING_SEEDS) {
    const restaurantId = venueIds.get(briefing.restaurantName);
    if (!restaurantId) {
      throw new Error(`sample briefing restaurant missing: ${briefing.restaurantName}`);
    }
    const { error: briefingError } = await supabase.from('restaurant_briefing_facts').insert({
      restaurant_id: restaurantId,
      field: briefing.field,
      body: briefing.body,
      source_url: briefing.sourceUrl,
      last_verified_at: briefingVerifiedAt,
      status: briefing.status,
      is_sample: true,
      version: 1,
    });
    if (briefingError) {
      throw new Error(`restaurant_briefing_facts: ${briefing.field}: ${briefingError.message}`);
    }
  }

  console.log('✅ Seed Complete! Database is populated.');
}

seed().catch((e) => {
  console.error('❌ Seed Failed:', e);
  process.exit(1);
});
