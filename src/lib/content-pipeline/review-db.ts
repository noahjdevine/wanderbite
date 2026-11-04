import 'server-only';

import { logAdminAction } from '@/lib/audit/log-admin-action';
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
        .select('id, source_id, subject_id, field, reason, before, after, evidence_excerpt, status')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error('Exception lookup failed.');
      if (!data) return null;
      return {
        id: data.id,
        sourceId: data.source_id,
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
      await logAdminAction({
        actorUserId: entry.adminId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        metadata: entry.metadata,
      });
    },
  };
}

export async function loadContentReviewModel(
  supabase: AdminClient = getSupabaseAdmin(),
): Promise<ContentReviewModel> {
  const [sourceResult, exceptionResult] = await Promise.all([
    supabase
      .from('content_sources')
      .select('id, url, status, restaurant_id, last_attempted_at, last_verified_at'),
    supabase
      .from('content_exceptions')
      .select('id, source_id, subject_id, field, reason, before, after, evidence_excerpt, status')
      .eq('status', 'open'),
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
    subjectId: row.subject_id,
    field: row.field,
    reason: row.reason,
    before: row.before,
    after: row.after,
    evidenceExcerpt: row.evidence_excerpt,
    status: row.status,
  }));

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

  const restaurantIds = [
    ...new Set(
      [...sources.map((source) => source.restaurantId), ...recipes.map((recipe) => recipe.restaurantId)].filter(
        (id): id is string => Boolean(id),
      ),
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

  return assembleContentReview({
    exceptions,
    sources,
    recipes,
    facts,
    restaurantNames: names,
  });
}
