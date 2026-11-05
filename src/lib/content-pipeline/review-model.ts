import { EXCEPTION_REASONS, type ExceptionReason } from '@/lib/content-pipeline/exceptions';

export const NOTHING_PUBLISHED = 'Nothing was published.';

export type ReviewSubjectLabel = 'Recipe' | 'Activity';
export type ReviewEditKind = 'description' | 'hours_note' | 'summary' | 'note' | 'none';
export type ReviewQueueKind = 'exception' | 'summary_draft';

export type ExceptionView = {
  id: string;
  restaurantName: string;
  sourceUrl: string;
  sourceHref: string | null;
  reason: string;
  field: string | null;
  beforeText: string;
  afterText: string;
  evidenceText: string;
  attemptedLabel: string;
  verifiedLabel: string;
  recipeLabel: string;
  subjectLabel: ReviewSubjectLabel;
  activityName: string | null;
  checkedLabel: string;
  editKind: ReviewEditKind;
  queueKind: ReviewQueueKind;
  approveKind: 'review_only' | 'blocked';
  approveBlock: string | null;
  canEdit: boolean;
};

export type SourceView = {
  id: string;
  url: string;
  sourceHref: string | null;
  status: string;
  restaurantName: string;
  attemptedLabel: string;
  verifiedLabel: string;
  canPause: boolean;
  canResume: boolean;
};

export type RecipeHistoryView = {
  recipeId: string;
  title: string;
  restaurantName: string;
  version: number;
  visibility: string;
  recipeType: string;
  menuWording: string | null;
  description: string;
  factVersion: number | null;
  previousVersion: number | null;
  canRollback: boolean;
};

export type ContentReviewModel = {
  exceptions: ExceptionView[];
  sources: SourceView[];
  history: RecipeHistoryView[];
  reasons: readonly ExceptionReason[];
};

export { EXCEPTION_REASONS };
