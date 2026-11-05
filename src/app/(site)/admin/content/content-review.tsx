'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  NOTHING_PUBLISHED,
  type ContentReviewModel,
  type ExceptionView,
} from '@/lib/content-pipeline/review-model';
import {
  approveActivitySummary,
  approveBriefingDraft,
  approveContentException,
  editActivitySummary,
  editBriefingDraft,
  editContentException,
  rejectActivitySummary,
  rejectBriefingDraft,
  rejectContentException,
  rollbackContentRecipe,
  setContentSourceStatus,
} from '../content-actions';

function PlainText({ text, testId }: { text: string; testId: string }) {
  return (
    <pre data-testid={testId} className="whitespace-pre-wrap break-words font-sans text-sm">
      {text || '—'}
    </pre>
  );
}

function SourceLink({ href, url }: { href: string | null; url: string }) {
  if (!href) return <span>{url || '—'}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline">
      {url}
    </a>
  );
}

export function ContentReview({ model }: { model: ContentReviewModel }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState('all');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [rollbackId, setRollbackId] = useState<string | null>(null);

  const visible = model.exceptions.filter((row) => reason === 'all' || row.reason === reason);

  function run(task: () => Promise<{ ok: true; notice: string } | { ok: false; error: string }>) {
    setNotice(null);
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (result.ok) {
        setNotice(result.notice);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-8">
      {notice ? <p className="text-sm">{notice}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Open exceptions</h2>
            <p className="text-sm text-muted-foreground">
              Newest source attempt first. Activity rows are labeled Activity. Briefing rows are labeled Briefing. Evidence and proposed text stay plain text.
            </p>
          </div>
          <label className="text-sm">
            Reason
            <select
              id="exception-reason-filter"
              className="ml-2 rounded-md border border-input bg-background px-2 py-1"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            >
              <option value="all">All</option>
              {model.reasons.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open exceptions for that reason.</p>
        ) : (
          visible.map((row) => (
            <ExceptionCard
              key={row.id}
              row={row}
              pending={pending}
              draft={drafts[row.id] ?? ''}
              onDraft={(value) => setDrafts((current) => ({ ...current, [row.id]: value }))}
              onApprove={() => run(() => (
                row.queueKind === 'summary_draft'
                  ? approveActivitySummary(row.id)
                  : row.queueKind === 'briefing_draft'
                    ? approveBriefingDraft(row.id)
                    : approveContentException(row.id)
              ))}
              onReject={() => run(() => (
                row.queueKind === 'summary_draft'
                  ? rejectActivitySummary(row.id)
                  : row.queueKind === 'briefing_draft'
                    ? rejectBriefingDraft(row.id)
                    : rejectContentException(row.id)
              ))}
              onEdit={(keepActive) => run(() => {
                const text = drafts[row.id] ?? '';
                if (row.queueKind === 'summary_draft') return editActivitySummary(row.id, text);
                if (row.queueKind === 'briefing_draft') return editBriefingDraft(row.id, text, keepActive);
                if (row.editKind === 'briefing') return editContentException(row.id, text, keepActive);
                return editContentException(row.id, text);
              })}
            />
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Recipe history</h2>
        <p className="text-sm text-muted-foreground">
          Rollback writes the previous description as a new version and keeps the old fact.
        </p>
        {model.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No inspired-by menu recipes are linked to these sources.</p>
        ) : (
          model.history.map((row) => (
            <Card key={row.recipeId}>
              <CardHeader>
                <CardTitle className="text-base">
                  {row.title}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">{row.restaurantName}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  Version {row.version}
                  {row.factVersion != null ? ` · fact version ${row.factVersion}` : ''}
                  {' · '}
                  {row.visibility}
                  {' · '}
                  {row.recipeType}
                  {row.menuWording ? ` · ${row.menuWording}` : ''}
                </p>
                <PlainText text={row.description} testId={`history-${row.recipeId}`} />
                {row.previousVersion != null ? <p>Previous fact version {row.previousVersion}.</p> : null}
                {row.canRollback ? (
                  <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setRollbackId(row.recipeId)}>
                    Roll back to previous
                  </Button>
                ) : (
                  <p className="text-muted-foreground">No previous description to restore.</p>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Sources</h2>
        <p className="text-sm text-muted-foreground">Pause or resume a registered source. New URLs stay in the registry script.</p>
        {model.sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">No content sources are registered.</p>
        ) : (
          model.sources.map((source) => (
            <Card key={source.id}>
              <CardContent className="space-y-2 py-4 text-sm">
                <p>{source.restaurantName}</p>
                <SourceLink href={source.sourceHref} url={source.url} />
                <p>
                  {source.status} · attempted {source.attemptedLabel} · verified {source.verifiedLabel}
                </p>
                {source.canPause ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => setContentSourceStatus(source.id, 'paused'))}
                  >
                    Pause
                  </Button>
                ) : null}
                {source.canResume ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => setContentSourceStatus(source.id, 'active'))}
                  >
                    Resume
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </section>

      <AlertDialog open={rollbackId != null} onOpenChange={(open) => { if (!open) setRollbackId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Roll back this description?</AlertDialogTitle>
            <AlertDialogDescription>
              The previous description returns as a new version. Older facts stay, and a saved recipe keeps the version it stored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = rollbackId;
                setRollbackId(null);
                if (id) run(() => rollbackContentRecipe(id));
              }}
            >
              Roll back
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ExceptionCard({
  row,
  pending,
  draft,
  onDraft,
  onApprove,
  onReject,
  onEdit,
}: {
  row: ExceptionView;
  pending: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onEdit: (keepActive: boolean) => void;
}) {
  const [keepActive, setKeepActive] = useState(row.keepActiveDefault === true);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {row.subjectLabel === 'Activity' ? 'Activity' : row.subjectLabel === 'Briefing' ? 'Briefing' : row.restaurantName}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {row.subjectLabel === 'Activity' ? row.activityName : row.subjectLabel === 'Briefing' ? row.restaurantName : row.reason}
            {row.subjectLabel === 'Activity' || row.subjectLabel === 'Briefing' ? ` · ${row.reason}` : ''}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <SourceLink href={row.sourceHref} url={row.sourceUrl} />
        <p>
          Attempted {row.attemptedLabel} · verified {row.verifiedLabel}
        </p>
        {row.subjectLabel === 'Recipe' ? <p>{row.recipeLabel}</p> : <p>Checked {row.checkedLabel}</p>}
        {row.field ? <p>Field {row.field}</p> : null}
        <div>
          <p className="font-medium">Before</p>
          <PlainText text={row.beforeText} testId={`before-${row.id}`} />
        </div>
        <div>
          <p className="font-medium">After</p>
          <PlainText text={row.afterText} testId={`after-${row.id}`} />
        </div>
        <div>
          <p className="font-medium">Evidence</p>
          <PlainText text={row.evidenceText} testId={`evidence-${row.id}`} />
        </div>
        {row.approveKind === 'review_only' ? (
          <p>
            {`Approve marks this reviewed. ${NOTHING_PUBLISHED}`}
            {row.editKind === 'description' ? ' Edit publishes a paraphrase.' : ''}
            {row.editKind === 'hours_note' ? ' Edit writes the hours note you type and keeps the previous note.' : ''}
            {row.editKind === 'summary' ? ' Edit stores your text as a new summary version and keeps the previous one.' : ''}
            {row.editKind === 'briefing' ? ' Edit saves the fact you type. A new or paused fact stays paused. An already-active fact stays visible only if you keep it that way.' : ''}
            {row.editKind === 'note' ? ' Edit closes the row with your note. Price and allergen text are not published.' : ''}
          </p>
        ) : null}
        {row.approveBlock ? <p>{row.approveBlock}</p> : null}
        <div className="flex flex-wrap gap-2">
          {row.approveKind === 'blocked' ? null : (
            <Button type="button" size="sm" disabled={pending} onClick={onApprove}>
              Mark reviewed
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onReject}>
            Reject
          </Button>
        </div>
        {row.canEdit ? (
          <div className="space-y-2">
            <label className="block font-medium" htmlFor={`edit-${row.id}`}>
              {row.editKind === 'hours_note' ? 'Hours note' : row.editKind === 'summary' ? 'Summary' : row.editKind === 'briefing' ? 'Fact text' : row.editKind === 'note' ? 'Resolution note' : 'Edited paraphrase'}
            </label>
            <textarea
              id={`edit-${row.id}`}
              className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2"
              value={draft}
              onChange={(event) => onDraft(event.target.value)}
            />
            {row.editKind === 'briefing' && row.keepActiveDefault ? (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={keepActive}
                  onChange={(event) => setKeepActive(event.target.checked)}
                />
                Keep this fact visible to members
              </label>
            ) : null}
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => onEdit(keepActive)}>
              {row.editKind === 'note' ? 'Save note' : 'Publish edit'}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
