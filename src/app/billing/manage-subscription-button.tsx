'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { createBillingPortalSession } from '@/app/actions/stripe';

type ManageSubscriptionButtonProps = {
  userId: string;
};

export function ManageSubscriptionButton({ userId }: ManageSubscriptionButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleManage() {
    setLoading(true);
    try {
      const result = await createBillingPortalSession(userId);
      if (result.ok) {
        window.location.href = result.url;
        return;
      }
      toast.error(result.error);
    } catch {
      toast.error('Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant="outline"
      className="w-full"
      onClick={handleManage}
      disabled={loading}
    >
      {loading ? 'Opening…' : 'Manage Subscription'}
    </Button>
  );
}
