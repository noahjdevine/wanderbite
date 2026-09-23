'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  ACCOUNT_CHANGED_MESSAGE,
  renderedAccountState,
  type RenderedAccountState,
} from '@/lib/auth/account-changed';

export function useAccountChanged(renderedForUserId: string): RenderedAccountState {
  const [state, setState] = useState<RenderedAccountState>('pending');

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(renderedAccountState(renderedForUserId, session?.user?.id ?? null));
    });
    return () => subscription.unsubscribe();
  }, [renderedForUserId]);

  return state;
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
