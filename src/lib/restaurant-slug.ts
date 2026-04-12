import type { SupabaseClient } from '@supabase/supabase-js';
import { slugify } from '@/lib/slugify';

/**
 * Reserves a unique `restaurants.slug` for `name` (base slug, then `-2`, `-3`, …).
 */
export async function allocateUniqueRestaurantSlug(
  supabase: SupabaseClient,
  name: string
): Promise<string> {
  const base = slugify(name) || 'restaurant';
  for (let i = 0; i < 500; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const { data } = await supabase
      .from('restaurants')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  throw new Error('Unable to allocate a unique slug for this restaurant name.');
}
