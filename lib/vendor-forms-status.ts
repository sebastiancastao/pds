import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllCustomFormAssignments } from "@/lib/custom-form-assignments";

const PROFILE_CHUNK_SIZE = 200;
const FORM_NAME_CHUNK_SIZE = 40;
const PAGE_SIZE = 1000;

/** How many pending form titles an API response carries per vendor. */
export const MAX_PENDING_FORM_TITLES = 50;

type CustomForm = {
  id: string;
  title: string;
  target_state: string | null;
  target_region: string | null;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function loadProfiles(supabase: SupabaseClient, userIds: string[]) {
  const byUser = new Map<string, { state: string | null; regionId: string | null }>();
  await Promise.all(
    chunk(userIds, PROFILE_CHUNK_SIZE).map(async (idChunk) => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, state, region_id")
        .in("user_id", idChunk);
      if (error) throw error;
      for (const row of (data || []) as any[]) {
        byUser.set(String(row.user_id), {
          state: typeof row.state === "string" && row.state ? row.state : null,
          regionId: typeof row.region_id === "string" && row.region_id ? row.region_id : null,
        });
      }
    })
  );
  return byUser;
}

async function loadSubmissions(supabase: SupabaseClient, formNames: string[]) {
  // user id -> progress names they have submitted
  const byUser = new Map<string, Set<string>>();
  await Promise.all(
    chunk(formNames, FORM_NAME_CHUNK_SIZE).map(async (nameChunk) => {
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("pdf_form_progress")
          .select("user_id, form_name")
          .in("form_name", nameChunk)
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        const rows = (data || []) as any[];
        for (const row of rows) {
          const userId = String(row.user_id);
          const names = byUser.get(userId) ?? new Set<string>();
          names.add(String(row.form_name));
          byUser.set(userId, names);
        }
        if (rows.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
    })
  );
  return byUser;
}

/**
 * Titles of the supplemental (custom) forms each user still has to submit.
 * Only users with at least one pending form are in the result.
 *
 * Mirrors the Supplement Onboarding page and the vendor My Forms page:
 * - a form applies to a user when it is personally assigned to them, or when it
 *   has no assignments at all and its target state and region match the profile
 * - a form is submitted when pdf_form_progress has a row named custom-form-{id}
 *   or the legacy "{title} {year}" name. The legacy name is shared by forms that
 *   have the same title, so one submission credits all of them, which avoids
 *   flagging someone for a form they did fill out.
 *
 * Fails safe: if any lookup errors, nobody is flagged.
 */
export async function getPendingCustomFormsByUser(
  supabase: SupabaseClient,
  userIds: Array<string | null | undefined>
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const ids = Array.from(
    new Set(userIds.map((id) => String(id || "").trim()).filter(Boolean))
  );
  if (ids.length === 0) return result;

  try {
    const { data: formRows, error: formsError } = await supabase
      .from("custom_pdf_forms")
      .select("id, title, target_state, target_region")
      .eq("is_active", true);
    if (formsError) {
      if ((formsError as any).code === "42P01") return result;
      throw formsError;
    }
    const forms = (formRows || []) as CustomForm[];
    if (forms.length === 0) return result;

    const year = new Date().getFullYear();
    const progressNames = new Set<string>();
    for (const form of forms) {
      progressNames.add(`custom-form-${form.id}`);
      progressNames.add(`${form.title} ${year}`);
    }

    const [assignmentsResult, profiles, submissions] = await Promise.all([
      fetchAllCustomFormAssignments(supabase, "form_id, user_id"),
      loadProfiles(supabase, ids),
      loadSubmissions(supabase, Array.from(progressNames)),
    ]);

    if (assignmentsResult.error && (assignmentsResult.error as any).code !== "42P01") {
      throw assignmentsResult.error;
    }

    const restrictedFormIds = new Set<string>();
    const assignedByUser = new Map<string, Set<string>>();
    for (const row of (assignmentsResult.data || []) as any[]) {
      const formId = String(row.form_id);
      const userId = String(row.user_id);
      restrictedFormIds.add(formId);
      const assigned = assignedByUser.get(userId) ?? new Set<string>();
      assigned.add(formId);
      assignedByUser.set(userId, assigned);
    }

    for (const userId of ids) {
      const profile = profiles.get(userId);
      const assigned = assignedByUser.get(userId);
      const submitted = submissions.get(userId);
      const missing: string[] = [];

      for (const form of forms) {
        const applies =
          Boolean(assigned?.has(form.id)) ||
          (!restrictedFormIds.has(form.id) &&
            (!form.target_state || (!!profile?.state && form.target_state === profile.state)) &&
            (!form.target_region || (!!profile?.regionId && form.target_region === profile.regionId)));
        if (!applies) continue;

        const done =
          Boolean(submitted?.has(`custom-form-${form.id}`)) ||
          Boolean(submitted?.has(`${form.title} ${year}`));
        if (!done) missing.push(form.title);
      }

      if (missing.length > 0) result.set(userId, missing);
    }

    return result;
  } catch (err: any) {
    console.warn("[vendor-forms-status] pending forms lookup failed:", err?.message || err);
    return new Map<string, string[]>();
  }
}

/** Count and capped title list for one user's pending forms. */
export function describePendingForms(titles: string[] | undefined) {
  const all = titles ?? [];
  return { count: all.length, titles: all.slice(0, MAX_PENDING_FORM_TITLES) };
}
