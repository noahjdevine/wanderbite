import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AdminMfaGate } from '../admin-mfa-gate';
import { DrawingsAdmin } from './drawings-admin';
import { adminPageDecision, assertAdmin } from '@/lib/auth/assert-admin';
import { loadDrawingsAdminView, type DrawingsAdminView } from '@/lib/drawings/admin-read-model';
import { quarterOptions } from '@/lib/drawings/campaign-editor';
import {
  drawingsAdminActionsEnabled,
  drawingsAdminEnabled,
  drawingsCampaignEditorEnabled,
  drawingsFulfillmentActionsEnabled,
} from '@/lib/drawings/flag';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function AdminDrawingsPage() {
  if (!drawingsAdminEnabled()) notFound();

  const auth = await assertAdmin();
  const decision = adminPageDecision(auth);
  if (decision.kind === 'mfa') {
    return (
      <main className="min-h-screen bg-background px-4 py-10">
        <div className="mx-auto max-w-lg">
          <AdminMfaGate mode={decision.mode} />
        </div>
      </main>
    );
  }
  if (decision.kind === 'redirect') redirect(decision.href);

  const actionsOn = drawingsAdminActionsEnabled();
  const fulfillmentOn = drawingsFulfillmentActionsEnabled();
  const editorOn = drawingsCampaignEditorEnabled();

  let view: DrawingsAdminView;
  try {
    view = await loadDrawingsAdminView();
  } catch {
    view = { ok: false, reason: 'unavailable' };
  }

  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary">Drawings</h1>
            <p className="text-sm text-muted-foreground">
              {editorOn
                ? fulfillmentOn
                  ? 'Create or edit a draft sample campaign, activate a sample draft, close a campaign, run one simulated selection, or record sample fulfillment. This page does not delete a campaign, activate a live campaign, contact a member, or ship a prize.'
                  : 'Create or edit a draft sample campaign, activate a sample draft, close a campaign, or run one simulated selection. This page does not delete a campaign, activate a live campaign, move a fulfillment, or contact a member.'
                : fulfillmentOn
                  ? 'Activate a sample draft, close a campaign, run one simulated selection, or record sample fulfillment. This page does not create or delete a campaign, change prizes or budget, contact a member, or ship a prize.'
                  : actionsOn
                    ? 'Activate a sample draft, close a campaign, or run one simulated selection. This page does not create or delete a campaign, change prizes or budget, move a fulfillment, or contact a member.'
                    : 'Stored campaigns, simulated selections, and fulfillment records. This page only reads. It does not change a campaign, run a selection, contact a member, or ship a prize.'}
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin">Back to admin</Link>
          </Button>
        </div>
        <DrawingsAdmin
          view={view}
          actionsEnabled={actionsOn}
          fulfillmentActionsEnabled={fulfillmentOn}
          editorEnabled={editorOn}
          quarterChoices={editorOn ? quarterOptions(new Date()) : []}
        />
      </div>
    </main>
  );
}
