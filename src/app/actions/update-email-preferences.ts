'use server';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/require-user';
import { ACCOUNT_CHANGED_MESSAGE } from '@/lib/auth/account-changed';
import { ADVENTURE_REMINDERS_TOPIC } from '@/lib/email-unsubscribe';

const SAVE_UNAVAILABLE = 'Unable to save email preferences right now. Please try again.';

export async function updateAdventureReminderOptOut(
  optedOut: boolean,
  renderedForUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (typeof optedOut !== 'boolean') {
      return { ok: false, error: SAVE_UNAVAILABLE };
    }
    const auth = await requireUser();
    if (!auth.ok) return { ok: false, error: auth.error };
    if (renderedForUserId !== auth.userId) {
      return { ok: false, error: ACCOUNT_CHANGED_MESSAGE };
    }

    const supabase = await createClient();
    const { error } = await supabase.from('email_topic_preferences').upsert(
      {
        user_id: auth.userId,
        topic: ADVENTURE_REMINDERS_TOPIC,
        opted_out: optedOut,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,topic' },
    );
    if (error) return { ok: false, error: SAVE_UNAVAILABLE };
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : SAVE_UNAVAILABLE;
    return { ok: false, error: message };
  }
}
