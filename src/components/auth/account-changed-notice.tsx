'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { ACCOUNT_CHANGED_MESSAGE } from '@/lib/auth/account-changed';

export function useAccountChanged(renderedForUserId: string): boolean {
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const id = session?.user?.id ?? null;
      if (event === 'INITIAL_SESSION') {
        if (id && id !== renderedForUserId) setChanged(true);
        return;
      }
      if (event === 'SIGNED_OUT' || (id && id !== renderedForUserId)) {
        setChanged(true);
      }
    });
    return () => subscription.unsubscribe();
  }, [renderedForUserId]);

  return changed;
}

export function AccountChangedNotice() {
  return (
    <div className="space-y-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <p className="text-sm font-medium">{ACCOUNT_CHANGED_MESSAGE}</p>
      <Button type="button" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  );
}
