import 'server-only';

import { logAdminAction } from '@/lib/audit/log-admin-action';
import { readActivitySummary, type ActivityGuard } from '@/lib/content-pipeline/activity-review';
import { readBriefingDraft, type BriefingMemberRow } from '@/lib/content-pipeline/briefing-review';
import { isBriefingField } from '@/lib/briefings/types';
import { readDescriptionFact, type DescriptionFact } from '@/lib/content-pipeline/facts';
import {
  assembleContentReview,
  type ContentReviewModel,
  type ContentReviewStore,
  type RecipeGuard,
  type ReviewExceptionRow,
  type ReviewSourceRow,
} from '@/lib/content-pipeline/review';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { Json } from '@/types/database.types';

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

function asActivity(row: {
  id: string;
  name: string;
  hours_note: string | null;
  version: number;
  status: string;
  category: string;
  cost_category: string;
  booking_required: boolean;
  source_url: string | null;
  content_source_id: string | null;
  is_sample: boolean;
  weather_dependent: boolean;
  lat: number | null;
  lon: number | null;
  zip: string | null;
  typical_duration_minutes: number | null;
  valid_from: string | null;
  valid_until: string | null;
  last_verified_at: string | null;
}): ActivityGuard {
  return {
    id: row.id,
    name: row.name,
    hoursNote: row.hours_note,
    version: row.version,
    status: row.status,
    category: row.category,
    costCategory: row.cost_category,
    bookingRequired: row.booking_required,
    sourceUrl: row.source_url,
    contentSourceId: row.content_source_id,
    isSample: row.is_sample,
    weatherDependent: row.weather_dependent,
    lat: row.lat,
    lon: row.lon,
    zip: row.zip,
    typicalDurationMinutes: row.typical_duration_minutes,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    lastVerifiedAt: row.last_verified_at,
  };
}

function asRecipe(row: {
  id: string;
  title: string;
  description: string | null;
  version: number;
  visibility: string;
  recipe_type: string;
  source_kind: string | null;
  menu_wording: string | null;
  source_url: string | null;
  restaurant_id: string | null;
}): RecipeGuard {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    version: row.version,
    visibility: row.visibility,
    recipeType: row.recipe_type,
    sourceKind: row.source_kind,
    menuWording: row.menu_wording,
    sourceUrl: row.source_url,
    restaurantId: row.restaurant_id,
  };
}

export function contentReviewStore(supabase: AdminClient = getSupabaseAdmin()): ContentReviewStore {
  return {
    async loadException(id) {
      const { data, error } = await supabase
        .from('content_exceptions')
        .select('id, source_id, subject_type, subject_id, field, reason, before, after, evidence_excerpt, status')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error('Exception lookup failed.');
      if (!data) return null;
      return {
        id: data.id,
        sourceId: data.source_id,
        subjectType: data.subject_type,
        subjectId: data.subject_id,
        field: data.field,
        reason: data.reason,
        before: data.before,
        after: data.after,
        evidenceExcerpt: data.evidence_excerpt,
        status: data.status,
      };
    },
    async loadRecipe(id) {
      const { data, error } = await supabase
        .from('recipes')
        .select('id, title, description, version, visibility, recipe_type, source_kind, menu_wording, source_url, restaurant_id')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error('Recipe lookup failed.');
      return data ? asRecipe(data) : null;
    },
    async loadCurrentFact(sourceId, recipeId) {
      const { data, error } = await supabase
        .from('source_facts')
        .select('id, source_id, subject_id, version, status, value, evidence_excerpt')
        .eq('source_id', sourceId)
        .eq('subject_id', recipeId)
        .eq('field', 'description')
        .eq('status', 'current')
        .maybeSingle();
      if (error) throw new Error('Description fact lookup failed.');
      if (!data) return null;
      return readDescriptionFact(data);
    },
    async claimException(id, status, adminId) {
      const { data, error } = await supabase
        .from('content_exceptions')
        .update({
          status,
          resolved_at: new Date().toISOString(),
          resolved_by: adminId,
        })
        .eq('id', id)
        .eq('status', 'open')
        .select('id');
      if (error) throw new Error('Exception update failed.');
      return (data ?? []).length === 1;
    },
    async reopenException(id) {
      const { error } = await supabase
        .from('content_exceptions')
        .update({ status: 'open', resolved_at: null, resolved_by: null })
        .eq('id', id);
      if (error) throw new Error('Exception reopen failed.');
    },
    async applyDescriptionFact(row) {
      const { data, error } = await supabase.rpc('apply_recipe_description_fact', {
        p_source_id: row.sourceId,
        p_recipe_id: row.recipeId,
        p_value: row.value as unknown as Json,
        p_evidence_excerpt: row.evidenceExcerpt,
        p_supersede_fact_id: row.supersedeFactId,
      });
      if (error || !data) throw new Error(error?.message ?? 'Description fact was not published.');
      return data;
    },
    async loadActivity(id) {
      const { data, error } = await supabase
        .from('activities')
        .select('id, name, hours_note, version, status, category, cost_category, booking_required, source_url, content_source_id, is_sample, weather_dependent, lat, lon, zip, typical_duration_minutes, valid_from, valid_until, last_verified_at')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error('Activity lookup failed.');
      return data ? asActivity(data) : null;
    },
    async loadActivitySummary(id) {
      const { data, error } = await supabase
        .from('source_facts')
        .select('id, source_id, subject_id, version, status, value, evidence_excerpt')
        .eq('id', id)
        .eq('subject_type', 'activity')
        .eq('field', 'summary')
        .maybeSingle();
      if (error) throw new Error('Activity summary lookup failed.');
      return data ? readActivitySummary(data) : null;
    },
    async decideActivitySummary(id, decision) {
      const { error } = await supabase.rpc('decide_activity_summary_fact', {
        p_fact_id: id,
        p_decision: decision,
      });
      if (!error) return true;
      if (/not pending review/i.test(error.message)) return false;
      throw new Error(error.message);
    },
    async reopenActivitySummary(id) {
      const { error } = await supabase
        .from('source_facts')
        .update({ status: 'pending_review', verified_at: null })
        .eq('id', id)
        .eq('subject_type', 'activity')
        .eq('field', 'summary');
      if (error) throw new Error('Summary reopen failed.');
    },
    async publishActivitySummary(row) {
      const { data, error } = await supabase.rpc('publish_activity_summary', {
        p_source_id: row.sourceId,
        p_activity_id: row.activityId,
        p_text: row.text,
        p_evidence_excerpt: row.evidenceExcerpt,
      });
      if (error || !data) throw new Error(error?.message ?? 'Summary was not stored.');
      return data;
    },
    async publishActivityHoursNote(row) {
      const { data, error } = await supabase.rpc('publish_activity_hours_note', {
        p_source_id: row.sourceId,
        p_activity_id: row.activityId,
        p_text: row.text,
        p_evidence_excerpt: row.evidenceExcerpt,
      });
      if (error || !data) throw new Error(error?.message ?? 'Hours note was not saved.');
      return data;
    },
    async loadBriefingDraft(id) {
      const { data, error } = await supabase
        .from('source_facts')
        .select('id, source_id, subject_id, field, version, status, value, evidence_excerpt')
        .eq('id', id)
        .eq('subject_type', 'briefing')
        .maybeSingle();
      if (error) throw new Error('Briefing draft lookup failed.');
      return data ? readBriefingDraft(data) : null;
    },
    async loadBriefingMember(restaurantId, field) {
      const { data, error } = await supabase
        .from('restaurant_briefing_facts')
        .select('restaurant_id, field, body, status, version')
        .eq('restaurant_id', restaurantId)
        .eq('field', field)
        .maybeSingle();
      if (error) throw new Error('Briefing fact lookup failed.');
      if (!data || !isBriefingField(data.field)) return null;
      return {
        restaurantId: data.restaurant_id,
        field: data.field,
        body: data.body,
        status: data.status,
        version: data.version,
      };
    },
    async decideBriefingDraft(id, decision) {
      const { error } = await supabase.rpc('decide_briefing_fact', {
        p_fact_id: id,
        p_decision: decision,
      });
      if (!error) return true;
      if (/not pending review/i.test(error.message)) return false;
      throw new Error(error.message);
    },
    async reopenBriefingDraft(id) {
      const { error } = await supabase
        .from('source_facts')
        .update({ status: 'pending_review', verified_at: null })
        .eq('id', id)
        .eq('subject_type', 'briefing');
      if (error) throw new Error('Briefing draft reopen failed.');
    },
    async publishBriefingFact(row) {
      const { data, error } = await supabase.rpc('publish_briefing_fact', {
        p_source_id: row.sourceId,
        p_restaurant_id: row.restaurantId,
        p_field: row.field,
        p_text: row.text,
        p_evidence_excerpt: row.evidenceExcerpt,
        p_keep_active: row.keepActive,
      });
      if (error || !data) throw new Error(error?.message ?? 'Briefing fact was not saved.');
      return data;
    },
    async rollbackRecipe(recipeId) {
      const { data, error } = await supabase.rpc('rollback_recipe_to_previous', {
        p_recipe_id: recipeId,
      });
      if (error || data == null) throw new Error(error?.message ?? 'Recipe rollback failed.');
      return data;
    },
    async loadSource(id) {
      const { data, error } = await supabase
        .from('content_sources')
        .select('id, status')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error('Source lookup failed.');
      return data ? { id: data.id, status: data.status } : null;
    },
    async setSourceStatus(id, from, to) {
      const { data, error } = await supabase
        .from('content_sources')
        .update({ status: to })
        .eq('id', id)
        .eq('status', from)
        .select('id');
      if (error) throw new Error('Source update failed.');
      return (data ?? []).length === 1;
    },
    async audit(entry) {
      const wrote = await logAdminAction({
        actorUserId: entry.adminId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        metadata: entry.metadata,
      });
      if (!wrote) throw new Error('Audit row was not written.');
    },
  };
}

export async function loadContentReviewModel(
  supabase: AdminClient = getSupabaseAdmin(),
): Promise<ContentReviewModel> {
  const [sourceResult, exceptionResult, summaryResult, briefingDraftResult] = await Promise.all([
    supabase
      .from('content_sources')
      .select('id, url, status, restaurant_id, last_attempted_at, last_verified_at'),
    supabase
      .from('content_exceptions')
      .select('id, source_id, subject_type, subject_id, field, reason, before, after, evidence_excerpt, status')
      .eq('status', 'open'),
    supabase
      .from('source_facts')
      .select('id, source_id, subject_id, version, status, value, evidence_excerpt')
      .eq('subject_type', 'activity')
      .eq('field', 'summary')
      .in('status', ['pending_review', 'current']),
    supabase
      .from('source_facts')
      .select('id, source_id, subject_id, field, version, status, value, evidence_excerpt')
      .eq('subject_type', 'briefing')
      .eq('status', 'pending_review'),
  ]);
  if (sourceResult.error) throw new Error('Content sources failed to load.');
  const sourceRows = sourceResult.data;
  const sources: ReviewSourceRow[] = (sourceRows ?? []).map((row) => ({
    id: row.id,
    url: row.url,
    status: row.status,
    restaurantId: row.restaurant_id,
    lastAttemptedAt: row.last_attempted_at,
    lastVerifiedAt: row.last_verified_at,
  }));

  if (exceptionResult.error) throw new Error('Content exceptions failed to load.');
  const exceptionRows = exceptionResult.data;
  const exceptions: ReviewExceptionRow[] = (exceptionRows ?? []).map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    field: row.field,
    reason: row.reason,
    before: row.before,
    after: row.after,
    evidenceExcerpt: row.evidence_excerpt,
    status: row.status,
  }));
  if (summaryResult.error) throw new Error('Activity summaries failed to load.');
  if (briefingDraftResult.error) throw new Error('Briefing drafts failed to load.');
  const briefingDrafts = (briefingDraftResult.data ?? []).flatMap((row) => {
    const parsed = readBriefingDraft(row);
    return parsed ? [parsed] : [];
  });
  const activitySummaries = (summaryResult.data ?? []).flatMap((row) => {
    const parsed = readActivitySummary(row);
    return parsed ? [parsed] : [];
  });

  const urls = [...new Set(sources.map((source) => source.url))];
  let recipes: RecipeGuard[] = [];
  if (urls.length > 0) {
    const { data: recipeRows, error: recipeError } = await supabase
      .from('recipes')
      .select('id, title, description, version, visibility, recipe_type, source_kind, menu_wording, source_url, restaurant_id')
      .eq('recipe_type', 'inspired_by')
      .eq('source_kind', 'public_menu')
      .in('source_url', urls);
    if (recipeError) throw new Error('Recipes failed to load.');
    recipes = (recipeRows ?? []).map((row) => asRecipe(row));
  }

  const recipeIds = recipes.map((recipe) => recipe.id);
  let facts: DescriptionFact[] = [];
  if (recipeIds.length > 0) {
    const { data: factRows, error: factError } = await supabase
      .from('source_facts')
      .select('id, source_id, subject_id, version, status, value, evidence_excerpt')
      .eq('field', 'description')
      .in('subject_id', recipeIds);
    if (factError) throw new Error('Description facts failed to load.');
    facts = (factRows ?? []).flatMap((row) => {
      const parsed = readDescriptionFact(row);
      return parsed ? [parsed] : [];
    });
  }

  const activityIds = [
    ...new Set(
      [
        ...exceptions.filter((row) => row.subjectType === 'activity').map((row) => row.subjectId),
        ...activitySummaries.map((row) => row.subjectId),
      ].filter((id): id is string => Boolean(id)),
    ),
  ];
  let activities: ActivityGuard[] = [];
  if (activityIds.length > 0) {
    const { data: activityRows, error: activityError } = await supabase
      .from('activities')
      .select('id, name, hours_note, version, status, category, cost_category, booking_required, source_url, content_source_id, is_sample, weather_dependent, lat, lon, zip, typical_duration_minutes, valid_from, valid_until, last_verified_at')
      .in('id', activityIds);
    if (activityError) throw new Error('Activities failed to load.');
    activities = (activityRows ?? []).map((row) => asActivity(row));
  }

  const briefingRestaurantIds = [
    ...exceptions.filter((row) => row.subjectType === 'briefing').map((row) => row.subjectId),
    ...briefingDrafts.map((row) => row.restaurantId),
  ];
  const restaurantIds = [
    ...new Set(
      [
        ...sources.map((source) => source.restaurantId),
        ...recipes.map((recipe) => recipe.restaurantId),
        ...briefingRestaurantIds,
      ].filter((id): id is string => Boolean(id)),
    ),
  ];
  const names = new Map<string, string>();
  if (restaurantIds.length > 0) {
    const { data: restaurantRows, error: restaurantError } = await supabase
      .from('restaurants')
      .select('id, name')
      .in('id', restaurantIds);
    if (restaurantError) throw new Error('Restaurants failed to load.');
    for (const row of restaurantRows ?? []) names.set(row.id, row.name);
  }

  let briefings: BriefingMemberRow[] = [];
  if (restaurantIds.length > 0) {
    const { data: briefingRows, error: briefingError } = await supabase
      .from('restaurant_briefing_facts')
      .select('restaurant_id, field, body, status, version')
      .in('restaurant_id', restaurantIds);
    if (briefingError) throw new Error('Briefing facts failed to load.');
    briefings = (briefingRows ?? []).flatMap((row) => {
      if (!isBriefingField(row.field)) return [];
      return [{
        restaurantId: row.restaurant_id,
        field: row.field,
        body: row.body,
        status: row.status,
        version: row.version,
      }];
    });
  }

  return assembleContentReview({
    exceptions,
    sources,
    recipes,
    facts,
    restaurantNames: names,
    activities,
    activitySummaries,
    briefings,
    briefingDrafts,
  });
}
