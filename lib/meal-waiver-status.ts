import type { SupabaseClient } from '@supabase/supabase-js';

// Which meal waiver documents each worker has on file.
//
// A worker's Documents list (/api/pdf-form-progress/user-list/[userId]) shows a
// "Meal Waiver (6 Hour)" and a "Meal Waiver (10/12 Hour)" entry when either:
//  - the meal_waivers table has a row for that waiver type (the normal onboarding
//    and custom-form path; a declined waiver is still a signed document), or
//  - pdf_form_progress has a saved "meal-waiver-6hour" / "meal-waiver-10-12" form,
//    optionally state-prefixed (e.g. "ca-meal-waiver-6hour").
// This mirrors that rule so the event dashboard can flag workers missing one.

export type MealWaiverCoverage = {
  sixHour: boolean;
  tenTwelveHour: boolean;
};

const CHUNK_SIZE = 150;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function ensure(map: Map<string, MealWaiverCoverage>, userId: string): MealWaiverCoverage {
  let entry = map.get(userId);
  if (!entry) {
    entry = { sixHour: false, tenTwelveHour: false };
    map.set(userId, entry);
  }
  return entry;
}

/**
 * Returns coverage for every requested user id (users with nothing on file get
 * { sixHour: false, tenTwelveHour: false }). Returns null when the lookup fails,
 * so callers can show "unknown" instead of wrongly flagging everyone.
 */
export async function getMealWaiverCoverageByUser(
  supabaseAdmin: SupabaseClient,
  userIds: string[]
): Promise<Map<string, MealWaiverCoverage> | null> {
  const ids = Array.from(new Set(userIds.map((id) => String(id || '').trim()).filter(Boolean)));
  const coverage = new Map<string, MealWaiverCoverage>();
  for (const id of ids) ensure(coverage, id);
  if (ids.length === 0) return coverage;

  try {
    for (const batch of chunk(ids, CHUNK_SIZE)) {
      const [waiverResult, formResult] = await Promise.all([
        supabaseAdmin
          .from('meal_waivers')
          .select('user_id, waiver_type')
          .in('user_id', batch),
        supabaseAdmin
          .from('pdf_form_progress')
          .select('user_id, form_name')
          .in('user_id', batch)
          .or('form_name.ilike.%meal-waiver-6hour,form_name.ilike.%meal-waiver-10-12'),
      ]);

      if (waiverResult.error) throw waiverResult.error;
      if (formResult.error) throw formResult.error;

      for (const row of waiverResult.data || []) {
        const userId = String((row as any)?.user_id || '');
        if (!userId) continue;
        const type = String((row as any)?.waiver_type || '').toLowerCase();
        const entry = ensure(coverage, userId);
        if (type === '6_hour') entry.sixHour = true;
        if (type === '10_hour' || type === '12_hour') entry.tenTwelveHour = true;
      }

      for (const row of formResult.data || []) {
        const userId = String((row as any)?.user_id || '');
        if (!userId) continue;
        const formName = String((row as any)?.form_name || '').toLowerCase().trim();
        const entry = ensure(coverage, userId);
        if (formName.endsWith('meal-waiver-6hour')) entry.sixHour = true;
        if (formName.endsWith('meal-waiver-10-12')) entry.tenTwelveHour = true;
      }
    }
    return coverage;
  } catch (err: any) {
    console.error('[MEAL_WAIVER_STATUS] Failed to load meal waiver coverage:', err?.message || err);
    return null;
  }
}
