'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getProfileOnboardingCheck, updateProfileOnboarding } from '@/app/actions/profile';

export function OnboardingModal() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [username, setUsername] = useState('');
  const [address, setAddress] = useState('');

  useEffect(() => {
    let cancelled = false;
    getProfileOnboardingCheck().then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.needsCompletion) {
        setUsername(result.username ?? '');
        setAddress(result.address ?? '');
        setOpen(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const u = username.trim();
    const a = address.trim();
    if (!u || !a) {
      toast.error('Please fill in both Username and Address.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await updateProfileOnboarding(u, a);
      if (result.ok) {
        setOpen(false);
        router.refresh();
        toast.success('Profile updated.');
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error('Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return null;

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Complete your profile</DialogTitle>
          <DialogDescription>
            Add a username and your address so we can personalize your experience.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="onboarding-username" className="text-sm font-medium">
              Username
            </label>
            <input
              id="onboarding-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. foodie_jane"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              disabled={submitting}
              autoComplete="username"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="onboarding-address" className="text-sm font-medium">
              Address
            </label>
            <textarea
              id="onboarding-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, City, State ZIP"
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              disabled={submitting}
              autoComplete="street-address"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save & continue'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
