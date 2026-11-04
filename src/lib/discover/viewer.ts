import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { EMPTY_DISCOVER_VIEWER, type DiscoverViewer } from '@/lib/discover/screen';
import { NEUTRAL_MEMBER_HEADER, memberHeaderLabel } from '@/lib/progress/rules';
import { isRouletteDietaryFlag } from '@/lib/roulette-dietary';

type ProfileNameRow = {
  full_name: string | null;
  dietary_flags: string[] | null;
};

/**
 * Saved dietary flags and a first name for the status button and greeting.
 * A guest, or a failed read, gets the empty viewer. The stream flag is not
 * part of this object.
 */
export async function loadDiscoverViewer(): Promise<DiscoverViewer> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return EMPTY_DISCOVER_VIEWER;

    const { data, error } = await supabase
      .from('user_profiles')
      .select('full_name, dietary_flags')
      .eq('id', user.id)
      .maybeSingle();
    if (error || !data) return EMPTY_DISCOVER_VIEWER;

    const row = data as ProfileNameRow;
    const label = memberHeaderLabel(row.full_name);
    const firstName = label === NEUTRAL_MEMBER_HEADER ? null : label;
    const savedDietary = (row.dietary_flags ?? []).filter(isRouletteDietaryFlag);
    return { firstName, savedDietary };
  } catch {
    return EMPTY_DISCOVER_VIEWER;
  }
}
