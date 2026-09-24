export const GOOGLE_IMPORT_PARTIAL_MESSAGE =
  'Restaurant added, but Google metadata was not saved.';

export type GoogleImportOutcome =
  | { status: 'error'; error: string }
  | { status: 'success'; partnerUrl: string }
  | { status: 'partial'; partnerUrl: string; error: string };

/**
 * Create failure stops before attach. A missing Place ID is a successful
 * manual-shaped create. Attach failure keeps the restaurant.
 */
export function googleImportOutcome(input: {
  createdOk: boolean;
  createdError: string | null;
  partnerUrl: string | null;
  placeId: string;
  attachedOk: boolean | null;
  attachedError: string | null;
}): GoogleImportOutcome {
  if (!input.createdOk) {
    return {
      status: 'error',
      error: input.createdError ?? 'Unable to add the restaurant.',
    };
  }
  const partnerUrl = input.partnerUrl ?? '';
  if (!input.placeId.trim()) {
    return { status: 'success', partnerUrl };
  }
  if (input.attachedOk) {
    return { status: 'success', partnerUrl };
  }
  return {
    status: 'partial',
    partnerUrl,
    error: input.attachedError ?? GOOGLE_IMPORT_PARTIAL_MESSAGE,
  };
}
