import type { SupabaseClient } from '@supabase/supabase-js';

const CUSTOM_FORM_ASSIGNMENTS_PAGE_SIZE = 1000;

type AssignmentQuery = {
  order: (column: string, options?: { ascending?: boolean }) => AssignmentQuery;
  range: (from: number, to: number) => Promise<{ data: any[] | null; error: any }>;
};

export async function fetchAllCustomFormAssignments(
  supabase: SupabaseClient,
  columns: string,
  applyFilters?: (query: any) => any,
) {
  const rows: any[] = [];
  let from = 0;

  while (true) {
    let query = supabase
      .from('custom_form_assignments')
      .select(columns)
      .order('id', { ascending: true }) as unknown as AssignmentQuery;

    if (applyFilters) {
      query = applyFilters(query) as AssignmentQuery;
    }

    const { data, error } = await query.range(
      from,
      from + CUSTOM_FORM_ASSIGNMENTS_PAGE_SIZE - 1,
    );

    if (error) {
      return { data: null, error };
    }

    const page = data ?? [];
    rows.push(...page);

    if (page.length < CUSTOM_FORM_ASSIGNMENTS_PAGE_SIZE) {
      break;
    }

    from += CUSTOM_FORM_ASSIGNMENTS_PAGE_SIZE;
  }

  return { data: rows, error: null };
}
