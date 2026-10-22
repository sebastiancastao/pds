// Shared "what does this vendor's calendar currently show" computation.
// Merges every vendor_invitations submission (latest response wins per
// date) and then overlays any approved vendor_availability_corrections
// (which always win, regardless of submission recency — they represent an
// explicitly reviewed correction). Used by both
// app/api/employees/[id]/invitations/route.ts (renders the Personal
// Calendar) and app/api/vendor-availability-change-requests/route.ts (needs
// to know the "current" value for a date before someone requests changing
// it), so the two can never disagree about what's currently on record.
//
// Each day also carries its time frame (allDay / startTime / endTime) — the
// vendor's form can submit "available 16:00-02:00" and an approved change
// request can now set one too (see lib/availabilityTimeFrame.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { toAvailabilityAnswer, type AvailabilityAnswer } from "@/lib/availabilityTimeFrame";

export type MergedAvailabilityDay = {
  date: string;
  available: boolean;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  submitted_at: string | null;
};

type RawAvailabilityDay = AvailabilityAnswer & { date: string; notes: string | null };

function normalizeAvailabilityPayload(payload: unknown): RawAvailabilityDay[] {
  if (Array.isArray(payload)) {
    return payload
      .filter(
        (day): day is { date: string; available?: unknown; notes?: unknown; allDay?: unknown; startTime?: unknown; endTime?: unknown } =>
          !!day && typeof day === "object" && typeof (day as { date?: unknown }).date === "string"
      )
      .map((day) => ({
        date: day.date.slice(0, 10),
        ...toAvailabilityAnswer({
          available: day.available === true,
          allDay: day.allDay,
          startTime: day.startTime,
          endTime: day.endTime,
        }),
        notes: typeof day.notes === "string" ? day.notes : null,
      }));
  }

  if (payload && typeof payload === "object") {
    return Object.entries(payload as Record<string, unknown>).map(([date, available]) => ({
      date: date.slice(0, 10),
      ...toAvailabilityAnswer({ available: available === true }),
      notes: null,
    }));
  }

  return [];
}

type MergedValue = AvailabilityAnswer & { notes: string | null; submitted_at: string | null };

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

  const byDate = new Map<string, MergedValue>();
  let lastSubmittedAt: string | null = null;

  for (const row of availabilityRows || []) {
    const submittedAt = (row as any).responded_at || (row as any).updated_at || (row as any).created_at || null;
    if (!lastSubmittedAt && submittedAt) lastSubmittedAt = submittedAt;

    const days = normalizeAvailabilityPayload((row as any).availability);
    for (const day of days) {
      if (!day.date || byDate.has(day.date)) continue;
      const { date, ...value } = day;
      byDate.set(date, { ...value, submitted_at: submittedAt });
    }
  }

  const { data: corrections, error: correctionsErr } = await supabaseAdmin
    .from("vendor_availability_corrections")
    .select("date, available, all_day, start_time, end_time, notes, updated_at")
    .eq("vendor_id", vendorId);

  if (correctionsErr) {
    console.error("Error loading vendor_availability_corrections:", correctionsErr);
  }

  for (const correction of corrections || []) {
    const date = String((correction as any).date).slice(0, 10);
    const available = (correction as any).available === true;
    const allDayFlag = (correction as any).all_day as boolean | null | undefined;
    const previous = byDate.get(date);

    // all_day NULL = legacy correction from before time frames existed. It
    // only ever said "available"/"unavailable", so an "available" legacy
    // correction keeps a time frame the vendor themselves submitted —
    // the same rule /api/events/[id]/available-vendors has always applied.
    const answer =
      allDayFlag === null || allDayFlag === undefined
        ? available && previous?.available && !previous.allDay
          ? toAvailabilityAnswer({ available: true, allDay: false, startTime: previous.startTime, endTime: previous.endTime })
          : toAvailabilityAnswer({ available })
        : toAvailabilityAnswer({
            available,
            allDay: allDayFlag,
            startTime: (correction as any).start_time,
            endTime: (correction as any).end_time,
          });

    byDate.set(date, {
      ...answer,
      notes: (correction as any).notes ?? null,
      submitted_at: (correction as any).updated_at ?? null,
    });
  }

  const days = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({
      date,
      available: value.available,
      allDay: value.allDay,
      startTime: value.startTime,
      endTime: value.endTime,
      notes: value.notes,
      submitted_at: value.submitted_at,
    }));

  return { days, lastSubmittedAt };
}

/**
 * Convenience lookup for a handful of specific dates (e.g. building a
 * change-request snapshot). null = no answer on record for that date.
 */
export async function getEffectiveAvailabilityByDate(
  supabaseAdmin: SupabaseClient,
  vendorId: string,
  dates: string[]
): Promise<Map<string, AvailabilityAnswer | null>> {
  const { days } = await getMergedVendorAvailability(supabaseAdmin, vendorId);
  const byDate = new Map(days.map((d) => [d.date, d] as const));
  const result = new Map<string, AvailabilityAnswer | null>();
  for (const date of dates) {
    const day = byDate.get(date);
    result.set(
      date,
      day ? { available: day.available, allDay: day.allDay, startTime: day.startTime, endTime: day.endTime } : null
    );
  }
  return result;
}

/**
 * Effective answer (including any time frame) for each vendor on ONE date:
 * the newest vendor_invitations submission that mentions the date, then
 * approved corrections on top (legacy all_day NULL corrections keep a
 * submitted window, same as getMergedVendorAvailability). Vendors with no
 * answer for the date are absent from the map. Batched for large teams.
 */
export async function getAvailabilityForDateByVendor(
  supabaseAdmin: SupabaseClient,
  vendorIds: string[],
  dateKey: string
): Promise<Map<string, AvailabilityAnswer>> {
  const result = new Map<string, AvailabilityAnswer>();
  const ids = Array.from(new Set(vendorIds.map((id) => String(id || "").trim()).filter(Boolean)));
  const date = String(dateKey || "").slice(0, 10);
  if (ids.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return result;

  const BATCH_SIZE = 200;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);

    const { data: rows, error } = await supabaseAdmin
      .from("vendor_invitations")
      .select("vendor_id, availability")
      .in("vendor_id", batch)
      .not("availability", "is", null)
      .order("responded_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("Error loading vendor_invitations for date availability:", error);
    } else {
      for (const row of rows || []) {
        const vendorId = String((row as any)?.vendor_id || "").trim();
        if (!vendorId || result.has(vendorId)) continue;
        const day = normalizeAvailabilityPayload((row as any).availability).find((d) => d.date === date);
        if (!day) continue;
        result.set(vendorId, {
          available: day.available,
          allDay: day.allDay,
          startTime: day.startTime,
          endTime: day.endTime,
        });
      }
    }

    const { data: corrections, error: correctionsError } = await supabaseAdmin
      .from("vendor_availability_corrections")
      .select("vendor_id, available, all_day, start_time, end_time")
      .eq("date", date)
      .in("vendor_id", batch);

    if (correctionsError) {
      console.error("Error loading vendor_availability_corrections for date availability:", correctionsError);
      continue;
    }

    for (const correction of corrections || []) {
      const vendorId = String((correction as any)?.vendor_id || "").trim();
      if (!vendorId) continue;
      const available = (correction as any).available === true;
      const allDayFlag = (correction as any).all_day as boolean | null | undefined;
      const previous = result.get(vendorId);
      result.set(
        vendorId,
        allDayFlag === null || allDayFlag === undefined
          ? available && previous?.available && !previous.allDay
            ? previous
            : toAvailabilityAnswer({ available })
          : toAvailabilityAnswer({
              available,
              allDay: allDayFlag,
              startTime: (correction as any).start_time,
              endTime: (correction as any).end_time,
            })
      );
    }
  }

  return result;
}
