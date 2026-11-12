'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  CAMPAIGN_EDITOR_MAX_PRIZES,
  campaignWindowLabel,
  committedPreview,
  parseCampaignEditorForm,
  samplePrizePreview,
  type CampaignEditorFieldError,
  type CampaignEditorInput,
  type CampaignEditorSeed,
} from '@/lib/drawings/campaign-editor';
import { createDrawingCampaignAction, updateDrawingCampaignAction } from './actions';

const fieldClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20';

type PrizeRow = {
  key: string;
  label: string;
  quantity: string;
  unitValueDollars: string;
};

function rowsFromSeed(seed: CampaignEditorSeed | undefined): PrizeRow[] {
  const prizes = seed?.prizes?.length
    ? seed.prizes
    : [{ label: '', quantity: '1', unitValueDollars: '' }];
  return prizes.map((prize, index) => ({
    key: `prize-${index + 1}`,
    label: prize.label,
    quantity: prize.quantity,
    unitValueDollars: prize.unitValueDollars,
  }));
}

function quarterChoices(quarters: readonly string[], current: string): string[] {
  if (current && !quarters.includes(current)) return [current, ...quarters];
  return [...quarters];
}

function fieldMessage(errors: readonly CampaignEditorFieldError[], field: string): string | null {
  return errors.find((error) => error.field === field)?.message ?? null;
}

/**
 * Sample draft form. Mode is fixed and is not a choice. The prize preview
 * is the label that is saved. Save stays disabled while the request is
 * in flight and while committed cents are over the total.
 */
function DrawingCampaignForm({
  mode,
  campaignId,
  seed,
  quarters,
  onCancel,
  onSaved,
}: {
  mode: 'create' | 'edit';
  campaignId?: string;
  seed?: CampaignEditorSeed;
  quarters: readonly string[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const busy = useRef(false);
  const keyCount = useRef(rowsFromSeed(seed).length);
  const [quarterKey, setQuarterKey] = useState(seed?.quarterKey ?? quarters[0] ?? '');
  const [totalBudgetDollars, setTotalBudgetDollars] = useState(seed?.totalBudgetDollars ?? '');
  const [fulfillmentAllowanceDollars, setFulfillmentAllowanceDollars] = useState(
    seed?.fulfillmentAllowanceDollars ?? '',
  );
  const [prizes, setPrizes] = useState<PrizeRow[]>(() => rowsFromSeed(seed));
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<CampaignEditorFieldError[]>([]);
  const [error, setError] = useState<string | null>(null);

  const input: CampaignEditorInput = {
    quarterKey,
    totalBudgetDollars,
    fulfillmentAllowanceDollars,
    prizes: prizes.map((prize) => ({
      label: prize.label,
      quantity: prize.quantity,
      unitValueDollars: prize.unitValueDollars,
    })),
  };
  const preview = committedPreview(input);
  const windowLabel = campaignWindowLabel(quarterKey);
  const choices = quarterChoices(quarters, quarterKey);
  const heading = mode === 'create' ? 'New sample campaign' : 'Edit sample campaign';
  const formId = mode === 'create' ? 'create' : `edit-${campaignId ?? 'campaign'}`;

  function addPrize() {
    if (prizes.length >= CAMPAIGN_EDITOR_MAX_PRIZES) return;
    keyCount.current += 1;
    setPrizes((current) => [
      ...current,
      { key: `prize-${keyCount.current}`, label: '', quantity: '1', unitValueDollars: '' },
    ]);
  }

  function removePrize(key: string) {
    setPrizes((current) => current.filter((prize) => prize.key !== key));
  }

  async function save() {
    if (busy.current || preview.over) return;
    const parsed = parseCampaignEditorForm(input);
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      setError(null);
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    setFieldErrors([]);
    try {
      const result =
        mode === 'create'
          ? await createDrawingCampaignAction(input)
          : await updateDrawingCampaignAction(campaignId ?? '', input);
      if (result.ok) {
        onSaved();
        router.refresh();
      } else {
        setFieldErrors(result.fieldErrors ?? []);
        setError(result.fieldErrors && result.fieldErrors.length > 0 ? null : result.message);
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const quarterError = fieldMessage(fieldErrors, 'quarterKey');
  const totalError = fieldMessage(fieldErrors, 'totalBudgetDollars');
  const allowanceError = fieldMessage(fieldErrors, 'fulfillmentAllowanceDollars');
  const prizesError = fieldMessage(fieldErrors, 'prizes');

  return (
    <form
      className="space-y-4 rounded-xl border p-4"
      aria-label={heading}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{heading}</h3>
        <p className="text-sm text-muted-foreground">This saves a draft sample campaign.</p>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor={`${formId}-quarter`}>
            Quarter
          </label>
          <select
            id={`${formId}-quarter`}
            className={fieldClass}
            value={quarterKey}
            aria-invalid={quarterError ? true : undefined}
            onChange={(event) => setQuarterKey(event.target.value)}
          >
            {choices.map((quarter) => (
              <option key={quarter} value={quarter}>
                {quarter}
              </option>
            ))}
          </select>
          {windowLabel ? <p className="text-sm text-muted-foreground">{windowLabel}</p> : null}
          {quarterError ? (
            <p className="text-sm text-destructive" role="alert">
              {quarterError}
            </p>
          ) : null}
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor={`${formId}-total`}>
            Total budget (dollars)
          </label>
          <input
            id={`${formId}-total`}
            className={fieldClass}
            inputMode="decimal"
            value={totalBudgetDollars}
            aria-invalid={totalError ? true : undefined}
            onChange={(event) => setTotalBudgetDollars(event.target.value)}
          />
          {totalError ? (
            <p className="text-sm text-destructive" role="alert">
              {totalError}
            </p>
          ) : null}
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label className="text-sm font-medium" htmlFor={`${formId}-allowance`}>
            Fulfillment allowance (dollars)
          </label>
          <input
            id={`${formId}-allowance`}
            className={fieldClass}
            inputMode="decimal"
            value={fulfillmentAllowanceDollars}
            aria-invalid={allowanceError ? true : undefined}
            onChange={(event) => setFulfillmentAllowanceDollars(event.target.value)}
          />
          {allowanceError ? (
            <p className="text-sm text-destructive" role="alert">
              {allowanceError}
            </p>
          ) : null}
        </div>
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Sample prizes</legend>
        {prizesError ? (
          <p className="text-sm text-destructive" role="alert">
            {prizesError}
          </p>
        ) : null}
        {prizes.map((prize, index) => {
          const labelError = fieldMessage(fieldErrors, `prizes.${index}.label`);
          const quantityError = fieldMessage(fieldErrors, `prizes.${index}.quantity`);
          const unitError = fieldMessage(fieldErrors, `prizes.${index}.unitValueDollars`);
          const previewLabel = prize.label.trim() ? samplePrizePreview(prize.label) : null;
          return (
            <div key={prize.key} className="space-y-2 rounded-lg border p-3">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_8rem_auto]">
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor={`${formId}-${prize.key}-label`}>
                    Prize label
                  </label>
                  <input
                    id={`${formId}-${prize.key}-label`}
                    className={fieldClass}
                    value={prize.label}
                    aria-invalid={labelError ? true : undefined}
                    onChange={(event) =>
                      setPrizes((current) =>
                        current.map((row) => (row.key === prize.key ? { ...row, label: event.target.value } : row)),
                      )
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor={`${formId}-${prize.key}-quantity`}>
                    Quantity
                  </label>
                  <input
                    id={`${formId}-${prize.key}-quantity`}
                    className={fieldClass}
                    inputMode="numeric"
                    value={prize.quantity}
                    aria-invalid={quantityError ? true : undefined}
                    onChange={(event) =>
                      setPrizes((current) =>
                        current.map((row) =>
                          row.key === prize.key ? { ...row, quantity: event.target.value } : row,
                        ),
                      )
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor={`${formId}-${prize.key}-unit`}>
                    Unit value (dollars)
                  </label>
                  <input
                    id={`${formId}-${prize.key}-unit`}
                    className={fieldClass}
                    inputMode="decimal"
                    value={prize.unitValueDollars}
                    aria-invalid={unitError ? true : undefined}
                    onChange={(event) =>
                      setPrizes((current) =>
                        current.map((row) =>
                          row.key === prize.key ? { ...row, unitValueDollars: event.target.value } : row,
                        ),
                      )
                    }
                  />
                </div>
                <div className="flex items-end">
                  <Button type="button" size="sm" variant="outline" onClick={() => removePrize(prize.key)}>
                    {`Remove prize ${index + 1}`}
                  </Button>
                </div>
              </div>
              {previewLabel ? <p className="text-sm text-muted-foreground">Saved as {previewLabel}</p> : null}
              {labelError ? (
                <p className="text-sm text-destructive" role="alert">
                  {labelError}
                </p>
              ) : null}
              {quantityError ? (
                <p className="text-sm text-destructive" role="alert">
                  {quantityError}
                </p>
              ) : null}
              {unitError ? (
                <p className="text-sm text-destructive" role="alert">
                  {unitError}
                </p>
              ) : null}
            </div>
          );
        })}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={prizes.length >= CAMPAIGN_EDITOR_MAX_PRIZES}
          onClick={addPrize}
        >
          Add prize
        </Button>
      </fieldset>
      <p className={preview.over ? 'text-sm font-medium text-destructive' : 'text-sm'} role="status">
        {preview.label}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending || preview.over}>
          Save draft
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function DrawingCampaignCreate({ quarters }: { quarters: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  if (open) {
    return (
      <DrawingCampaignForm
        mode="create"
        quarters={quarters}
        onCancel={() => setOpen(false)}
        onSaved={() => {
          setSaved(true);
          setOpen(false);
        }}
      />
    );
  }
  return (
    <div className="space-y-2">
      {saved ? (
        <p className="text-sm" role="status">
          Draft saved.
        </p>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          setSaved(false);
          setOpen(true);
        }}
      >
        New sample campaign
      </Button>
    </div>
  );
}

export function DrawingCampaignEdit({
  campaignId,
  seed,
  quarters,
}: {
  campaignId: string;
  seed: CampaignEditorSeed;
  quarters: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  if (open) {
    return (
      <DrawingCampaignForm
        mode="edit"
        campaignId={campaignId}
        seed={seed}
        quarters={quarters}
        onCancel={() => setOpen(false)}
        onSaved={() => {
          setSaved(true);
          setOpen(false);
        }}
      />
    );
  }
  return (
    <div className="space-y-2">
      {saved ? (
        <p className="text-sm" role="status">
          Draft saved.
        </p>
      ) : null}
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Edit
      </Button>
    </div>
  );
}
