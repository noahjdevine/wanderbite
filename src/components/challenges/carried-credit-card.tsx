'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import {
  assignCarriedCredit,
  listCarriedAssignCandidates,
  type CarriedAssignCandidate,
} from '@/app/actions/assign-carried-credit';
import type { BiteNoteSummary } from '@/app/actions/bite-notes';
import { RestaurantCard } from '@/components/dashboard/restaurant-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  challengeCardExpired,
  formatChicagoDeadline,
  formatIssuePeriodLabel,
} from '@/lib/challenges/challenge-deadline';
import type { CarriedCreditView } from '@/lib/challenges/carried-credits';

type CarriedCreditCardProps = {
  credit: CarriedCreditView;
  canSwap: boolean;
  isSwapping: boolean;
  isRedeeming: boolean;
  onSwap: (challengeItemId: string) => void;
  onRedeem: (challengeItemId: string) => void;
  biteNote?: BiteNoteSummary;
};

function offerLine(candidate: CarriedAssignCandidate): string {
  const discount = candidate.discountAmountCents / 100;
  const minimum = candidate.minSpendCents / 100;
  return `$${discount} off when you spend $${minimum}+`;
}

export function CarriedCreditCard({
  credit,
  canSwap,
  isSwapping,
  isRedeeming,
  onSwap,
  onRedeem,
  biteNote,
}: CarriedCreditCardProps) {
  const router = useRouter();
  const [nowMs] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CarriedAssignCandidate[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const deadlineLabel = formatChicagoDeadline(credit.effectiveDeadline);
  const expired = challengeCardExpired({
    now: new Date(nowMs),
    cycleCreatedAt: credit.issuedAt,
    useStoredDeadline: true,
    storedDeadline: credit.effectiveDeadline,
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void listCarriedAssignCandidates(credit.creditId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.ok) {
        setCandidates(result.candidates);
      } else {
        setCandidates([]);
        setLoadError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, credit.creditId]);

  async function handleAssign(restaurantId: string) {
    setAssigningId(restaurantId);
    try {
      const result = await assignCarriedCredit(credit.creditId, restaurantId);
      if (result.ok) {
        toast.success('Restaurant assigned');
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not assign this restaurant.');
    } finally {
      setAssigningId(null);
    }
  }

  if (credit.state === 'linked' && credit.item) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Slot {credit.slotNumber} · {formatIssuePeriodLabel(credit.issuePeriod)}
        </p>
        <RestaurantCard
          item={credit.item}
          cycleCreatedAt={credit.issuedAt}
          canSwap={canSwap && credit.item.challengeItem.status === 'assigned'}
          isSwapping={isSwapping}
          isRedeeming={isRedeeming}
          onSwap={onSwap}
          onRedeem={onRedeem}
          biteNote={biteNote}
          useStoredDeadline
          storedDeadline={credit.effectiveDeadline}
        />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Slot {credit.slotNumber}</CardTitle>
          {expired ? <Badge variant="secondary">Expired</Badge> : null}
        </div>
        <CardDescription>
          Carried from {formatIssuePeriodLabel(credit.issuePeriod)}
          {deadlineLabel ? ` · Use by ${deadlineLabel}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Pick a restaurant for this carried credit.
        </p>
      </CardContent>
      <CardFooter>
        <Button type="button" className="w-full" onClick={() => setOpen(true)}>
          Assign
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Assign a restaurant</DialogTitle>
              <DialogDescription>
                Slot {credit.slotNumber}
                {deadlineLabel ? ` · Use by ${deadlineLabel}` : ''}
              </DialogDescription>
            </DialogHeader>
            {loading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Loading restaurants…
              </p>
            ) : loadError ? (
              <p className="text-sm text-destructive">{loadError}</p>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No eligible restaurants match your preferences and distance.
              </p>
            ) : (
              <ul className="max-h-80 space-y-2 overflow-y-auto">
                {candidates.map((candidate) => (
                  <li key={candidate.id}>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-auto w-full flex-col items-start gap-1 py-3 text-left"
                      disabled={assigningId != null}
                      onClick={() => void handleAssign(candidate.id)}
                    >
                      <span className="font-medium">{candidate.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {candidate.cuisineTags.join(', ') || 'No tags'} · {offerLine(candidate)}
                      </span>
                      {assigningId === candidate.id ? (
                        <span className="text-xs">Assigning…</span>
                      ) : null}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </DialogContent>
        </Dialog>
      </CardFooter>
    </Card>
  );
}
