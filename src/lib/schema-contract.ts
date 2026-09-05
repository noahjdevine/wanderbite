import type { Database } from '@/types/database.types';

/**
 * App-owned public tables (excludes PostGIS catalog tables).
 * Keep this list in sync with generated Database['public']['Tables'] plus
 * the forward migrations that introduce each column.
 */
export const SCHEMA_CONTRACT = {
  admin_audit_log: [
    'id',
    'actor_user_id',
    'action',
    'target_type',
    'target_id',
    'metadata',
    'created_at',
  ],
  badges: ['id', 'name', 'description', 'icon'],
  bite_notes: [
    'id',
    'user_id',
    'redemption_id',
    'restaurant_id',
    'note',
    'rating',
    'created_at',
    'updated_at',
    'is_public',
  ],
  challenge_cycles: [
    'id',
    'user_id',
    'cycle_month',
    'status',
    'swap_count_used',
    'created_at',
  ],
  challenge_items: [
    'id',
    'cycle_id',
    'restaurant_id',
    'slot_number',
    'status',
    'swapped_from_item_id',
  ],
  cron_runs: [
    'id',
    'job_name',
    'started_at',
    'finished_at',
    'status',
    'result',
    'error',
  ],
  markets: ['id', 'name', 'timezone', 'status', 'slug', 'state', 'country', 'currency'],
  redemptions: [
    'id',
    'user_id',
    'restaurant_id',
    'challenge_item_id',
    'token_hash',
    'status',
    'verified_at',
    'created_at',
    'encrypted_code',
    'code_iv',
  ],
  restaurant_offers: [
    'id',
    'restaurant_id',
    'discount_amount_cents',
    'min_spend_cents',
    'max_redemptions_per_month',
    'active',
    'created_at',
  ],
  restaurant_orgs: ['id', 'name', 'market_id'],
  restaurants: [
    'id',
    'org_id',
    'market_id',
    'name',
    'cuisine_tags',
    'address',
    'lat',
    'lon',
    'location',
    'status',
    'created_at',
    'description',
    'price_range',
    'neighborhood',
    'image_url',
    'verification_code',
    'google_place_id',
    'google_photo_url',
    'slug',
    'is_dairy_free',
    'is_vegan',
    'is_halal',
    'pin_hash',
    'updated_at',
  ],
  user_badges: ['user_id', 'badge_id', 'awarded_at'],
  user_preferences: ['user_id', 'excluded_cuisines'],
  user_profiles: [
    'id',
    'email',
    'role',
    'dietary_flags',
    'allergy_flags',
    'distance_band',
    'stripe_customer_id',
    'subscription_status',
    'current_period_end',
    'full_name',
    'username',
    'phone_number',
    'address',
    'distance_preference',
    'wants_cocktail_experience',
    'is_admin',
    'address_street',
    'address_city',
    'address_state',
    'address_zip',
  ],
} as const;

export const POSTGIS_TYPE_TABLES = [
  'spatial_ref_sys',
  'geography_columns',
  'geometry_columns',
] as const;

export type AppTableName = keyof typeof SCHEMA_CONTRACT;

export type DatabaseTableName = keyof Database['public']['Tables'];

/** Compile-time: every contracted table exists on generated Database types. */
export type SchemaContractTablesExist = {
  [K in AppTableName]: Database['public']['Tables'][K]['Row'];
};
