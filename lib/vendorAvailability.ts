// Shared "what does this vendor's calendar currently show" computation.
// Merges every vendor_invitations submission (latest response wins per
// date) and then overlays any approved vendor_availability_corrections
// (which always win, regardless of submission recency — they represent an
// explicitly reviewed correction). Used by both
// app/api/employees/[id]/invitations/route.ts (renders the Personal
// Calendar) and app/api/vendor-availability-change-requests/route.ts (needs
// to know the "current" value for a date before someone requests changing
// it), so the two can never disagree about what's currently on record.
import type { SupabaseClient } from "@supabase/supabase-js";

export type MergedAvailabilityDay = {
  date: string;
  available: boolean;
  notes: string | null;
  submitted_at: string | null;
};

type RawAvailabilityDay = { date: string; available: boolean; notes: string | null };

function normalizeAvailabilityPayload(payload: unknown): RawAvailabilityDay[] {
  if (Array.isArray(payload)) {
    return payload
      .filter(
        (day): day is { date: string; available?: unknown; notes?: unknown } =>
          !!day && typeof day === "object" && typeof (day as { date?: unknown }).date === "string"
      )
      .map((day) => ({
        date: day.date.slice(0, 10),
        available: day.available === true,
        notes: typeof day.notes === "string" ? day.notes : null,
      }));
  }

  if (payload && typeof payload === "object") {
    return Object.entries(payload as Record<string, unknown>).map(([date, available]) => ({
      date: date.slice(0, 10),
      available: available === true,
      notes: null,
    }));
  }

  return [];
}

/**
 * Every date the vendor has an effective availability answer for, newest
 * submission per date, with approved corrections overlaid on top.
 */
export async function getMergedVendorAvailability(
  supabaseAdmin: SupabaseClient,
  vendorId: string
): Promise<{ days: MergedAvailabilityDay[]; lastSubmittedAt: string | null }> {
  const { data: availabilityRows, error: availabilityErr } = await supabaseAdmin
    .from("vendor_invitations")
    .select("availability, responded_at, updated_at, created_at")
    .eq("vendor_id", vendorId)
    .not("availability", "is", null)
    .order("responded_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false });

  if (availabilityErr) {
    console.error("Error loading vendor_invitations for availability merge:", availabilityErr);
  }

  const byDate = new Map<string, { available: boolean; notes: string | null; submitted_at: string | null }>();
  let lastSubmittedAt: string | null = null;

  for (const row of availabilityRows || []) {
    const submittedAt = (row as any).responded_at || (row as any).updated_at || (row as any).created_at || null;
    if (!lastSubmittedAt && submittedAt) lastSubmittedAt = submittedAt;

    const days = normalizeAvailabilityPayload((row as any).availability);
    for (const day of days) {
      if (!day.date || byDate.has(day.date)) continue;
      byDate.set(day.date, { available: day.available, notes: day.notes, submitted_at: submittedAt });
    }
  }

  const { data: corrections, error: correctionsErr } = await supabaseAdmin
    .from("vendor_availability_corrections")
    .select("date, available, notes, updated_at")
    .eq("vendor_id", vendorId);

  if (correctionsErr) {
    console.error("Error loading vendor_availability_corrections:", correctionsErr);
  }

  for (const correction of corrections || []) {
    const date = String((correction as any).date).slice(0, 10);
    byDate.set(date, {
      available: (correction as any).available,
      notes: (correction as any).notes ?? null,
      submitted_at: (correction as any).updated_at ?? null,
    });
  }

  const days = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({
      date,
      available: value.available,
      notes: value.notes,
      submitted_at: value.submitted_at,
    }));

  return { days, lastSubmittedAt };
}

/** Convenience lookup for a handful of specific dates (e.g. building a change-request snapshot). */
export async function getEffectiveAvailabilityByDate(
  supabaseAdmin: SupabaseClient,
  vendorId: string,
  dates: string[]
): Promise<Map<string, boolean | null>> {
  const { days } = await getMergedVendorAvailability(supabaseAdmin, vendorId);
  const byDate = new Map(days.map((d) => [d.date, d.available] as const));
  const result = new Map<string, boolean | null>();
  for (const date of dates) {
    result.set(date, byDate.has(date) ? byDate.get(date)! : null);
  }
  return result;
}
