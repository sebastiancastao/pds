// Applies the times from an approved timesheet edit request to the worker's
// time entries.
//
// This follows the same rules as the event dashboard timesheet editor, so a
// correction made through an approved request looks like any other manual edit:
//  - Existing entries are updated in place. The worker's attestation is tied to
//    the clock out entry id, so it stays valid and is not asked for again.
//  - Only an exec may delete an entry, for example to remove a meal break.
//  - Times must run in order. A time that falls before the previous one is only
//    accepted as the next day when the event runs overnight.
//
// Server only. The database client is passed in so the logic can be tested.

import { randomUUID } from "crypto";
import { getLocalDateRange, getTimezoneForState, toZonedIso } from "@/lib/timezones";
import type { TimesheetEditProposal } from "@/lib/timesheet-edit-requests";

const CLIENT_ACTION_ID_MARKER = "clientActionId:";
const NOTE_REASON_MAX_LENGTH = 200;

type EntryRow = {
  id: string;
  action: string;
  timestamp: string;
  notes: string | null;
  event_id: string | null;
};

type TimelineEntry = { action: string; timestamp: string };

export type ApplyTimesheetResult =
  | { ok: true; updated: number; inserted: number; deleted: number }
  | { ok: false; status: number; error: string };

function normalizeEventDate(value?: string | null): string | null {
  return value ? String(value).split("T")[0] : null;
}

function formatIsoToLocalDate(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : "";
}

function timeToSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function eventAllowsOvernight(event: {
  start_time?: string | null;
  end_time?: string | null;
  ends_next_day?: boolean | null;
}): boolean {
  if (event.ends_next_day) return true;
  const start = timeToSeconds(event.start_time);
  const end = timeToSeconds(event.end_time);
  return start !== null && end !== null && end <= start;
}

// Kiosk check-ins keep a transaction id in their notes. Keep it through edits so
// every line still has a stable id.
function extractClientActionId(notes: string | null | undefined): string {
  const match = (notes || "").match(/clientActionId:\s*([^\s|]+)/i);
  return match ? match[1] : "";
}

function shortReason(reason: string): string {
  return reason.replace(/\s+/g, " ").replace(/\|/g, "/").trim().slice(0, NOTE_REASON_MAX_LENGTH);
}

function mustSucceed(result: { error?: { message?: string } | null }) {
  if (result?.error) throw new Error(result.error.message || "Database error.");
}

export async function applyTimesheetProposal(input: {
  // A Supabase client with permission to write time entries.
  db: any;
  eventId: string;
  userId: string;
  proposal: TimesheetEditProposal;
  actor: { role: string };
  requestId: string;
  reason: string;
}): Promise<ApplyTimesheetResult> {
  const { db, eventId, userId, proposal, actor, requestId, reason } = input;
  const fail = (status: number, error: string): ApplyTimesheetResult => ({ ok: false, status, error });

  const { data: event, error: eventError } = await db
    .from("events")
    .select("event_date, end_date, start_time, end_time, ends_next_day, state")
    .eq("id", eventId)
    .maybeSingle();
  if (eventError) return fail(500, eventError.message);

  const eventDate = normalizeEventDate(event?.event_date);
  if (!eventDate) return fail(400, "The event has no date, so the times cannot be applied.");
  const eventEndDate = normalizeEventDate(event?.end_date);
  const isMultiDay = Boolean(eventEndDate && eventEndDate > eventDate);

  // A multi day event keeps one timesheet per day, so the request has to say
  // which day it changes.
  let targetDate = eventDate;
  if (isMultiDay) {
    if (!proposal.workDate) {
      return fail(400, "This event spans several days and the request does not say which day to change.");
    }
    if (proposal.workDate < eventDate || proposal.workDate > eventEndDate!) {
      return fail(400, `The requested day must be between ${eventDate} and ${eventEndDate}.`);
    }
    targetDate = proposal.workDate;
  }

  const timeZone = getTimezoneForState(event?.state);
  const allowOvernight = isMultiDay
    ? targetDate < eventEndDate! || eventAllowsOvernight(event || {})
    : eventAllowsOvernight(event || {});

  // Build the day's timeline: clock in, up to two meals, clock out.
  const requested = proposal.requested;
  const steps: Array<{ action: string; time: string }> = [{ action: "clock_in", time: requested.firstIn }];
  if (requested.firstMealStart && requested.lastMealEnd) {
    steps.push({ action: "meal_start", time: requested.firstMealStart });
    steps.push({ action: "meal_end", time: requested.lastMealEnd });
  }
  if (requested.secondMealStart && requested.secondMealEnd) {
    steps.push({ action: "meal_start", time: requested.secondMealStart });
    steps.push({ action: "meal_end", time: requested.secondMealEnd });
  }
  steps.push({ action: "clock_out", time: requested.lastOut });

  const timeline: TimelineEntry[] = [];
  for (const step of steps) {
    const timestamp = toZonedIso(targetDate, step.time, timeZone);
    if (!timestamp) return fail(400, "One of the requested times is not valid.");
    timeline.push({ action: step.action, timestamp });
  }

  // A time earlier than the one before it crossed midnight.
  for (let i = 1; i < timeline.length; i += 1) {
    const previousMs = new Date(timeline[i - 1].timestamp).getTime();
    const currentMs = new Date(timeline[i].timestamp).getTime();
    if (currentMs <= previousMs) {
      if (!allowOvernight) {
        return fail(400, "The requested times must stay on the event date unless the event runs overnight.");
      }
      timeline[i].timestamp = new Date(currentMs + 24 * 60 * 60 * 1000).toISOString();
    }
  }
  for (let i = 1; i < timeline.length; i += 1) {
    if (!(new Date(timeline[i].timestamp).getTime() > new Date(timeline[i - 1].timestamp).getTime())) {
      return fail(400, "The requested times must be in order: clock in, meals, then clock out.");
    }
  }

  const dayRange = getLocalDateRange(targetDate, timeZone, allowOvernight ? 2 : 1);
  if (!dayRange) return fail(400, "The event date or time zone is not valid.");

  const { data: workerRow, error: workerError } = await db
    .from("users")
    .select("division")
    .eq("id", userId)
    .maybeSingle();
  if (workerError) return fail(500, workerError.message);
  const division = workerRow?.division || "vendor";

  // Entries already on the event for this worker, plus untagged kiosk entries
  // inside the day that this edit takes over.
  let eventBoundQuery = db
    .from("time_entries")
    .select("id, action, timestamp, notes, event_id")
    .eq("user_id", userId)
    .eq("event_id", eventId)
    .order("timestamp", { ascending: true });
  if (isMultiDay) {
    eventBoundQuery = eventBoundQuery.gte("timestamp", dayRange.startIso).lt("timestamp", dayRange.endExclusiveIso);
  }
  const [boundResult, untaggedResult] = await Promise.all([
    eventBoundQuery,
    db
      .from("time_entries")
      .select("id, action, timestamp, notes, event_id")
      .eq("user_id", userId)
      .is("event_id", null)
      .gte("timestamp", dayRange.startIso)
      .lt("timestamp", dayRange.endExclusiveIso)
      .order("timestamp", { ascending: true }),
  ]);
  if (boundResult.error) return fail(500, boundResult.error.message);
  if (untaggedResult.error) return fail(500, untaggedResult.error.message);

  const candidates = ([...(boundResult.data || []), ...(untaggedResult.data || [])] as EntryRow[])
    .filter((row, index, all) => all.findIndex((other) => other.id === row.id) === index)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Group into shifts that each start at a clock in, and keep only the shift
  // that starts on the target day. The window can also hold the next day's shift.
  const shifts: EntryRow[][] = [];
  let currentShift: EntryRow[] = [];
  for (const entry of candidates) {
    if (entry.action === "clock_in") {
      if (currentShift.length > 0) shifts.push(currentShift);
      currentShift = [entry];
      continue;
    }
    if (currentShift.length === 0) continue;
    currentShift.push(entry);
    if (entry.action === "clock_out") {
      shifts.push(currentShift);
      currentShift = [];
    }
  }
  if (currentShift.length > 0) shifts.push(currentShift);
  const existing = shifts.find((shift) => formatIsoToLocalDate(shift[0].timestamp, timeZone) === targetDate) || [];

  const existingByAction: Record<string, EntryRow[]> = {};
  for (const entry of existing) (existingByAction[entry.action] ||= []).push(entry);
  const newByAction: Record<string, TimelineEntry[]> = {};
  for (const entry of timeline) (newByAction[entry.action] ||= []).push(entry);

  const buildNote = (clientActionId: string) => {
    const base = `Manual edit by ${actor.role} | Reason: ${shortReason(reason)} | Approved edit request: ${requestId}`;
    return clientActionId ? `${base} | ${CLIENT_ACTION_ID_MARKER}${clientActionId}` : base;
  };

  const toUpdate: Array<{ original: EntryRow; timestamp: string; notes: string | null }> = [];
  const toInsert: Array<Record<string, unknown>> = [];
  const toDelete: EntryRow[] = [];

  // The form works to the minute, but kiosk entries keep seconds, so compare by
  // the minute so an untouched line is not flagged as edited.
  const toMinute = (iso: string) => Math.floor(new Date(iso).getTime() / 60000);

  for (const action of new Set([...Object.keys(existingByAction), ...Object.keys(newByAction)])) {
    const oldList = existingByAction[action] || [];
    const newList = newByAction[action] || [];
    for (let i = 0; i < Math.max(oldList.length, newList.length); i += 1) {
      if (i < oldList.length && i < newList.length) {
        const old = oldList[i];
        if (toMinute(old.timestamp) !== toMinute(newList[i].timestamp)) {
          toUpdate.push({
            original: old,
            timestamp: newList[i].timestamp,
            notes: buildNote(extractClientActionId(old.notes) || randomUUID()),
          });
        } else if (old.event_id !== eventId) {
          // Same time, but an untagged kiosk entry that now belongs to this event.
          toUpdate.push({ original: old, timestamp: old.timestamp, notes: old.notes });
        }
      } else if (i < newList.length) {
        toInsert.push({
          user_id: userId,
          action,
          timestamp: newList[i].timestamp,
          division,
          event_id: eventId,
          notes: buildNote(randomUUID()),
        });
      } else {
        toDelete.push(oldList[i]);
      }
    }
  }

  // Same rule as the event dashboard editor: only an exec removes entries.
  if (toDelete.length > 0 && actor.role !== "exec") {
    return fail(
      403,
      "This request removes a time entry, for example a meal break. Only an exec can approve that."
    );
  }

  // Apply the change. If any step fails, put back what was already changed so a
  // failure never leaves a half edited timesheet.
  const deleted: EntryRow[] = [];
  const updated: EntryRow[] = [];
  let insertedIds: string[] = [];
  try {
    if (toDelete.length > 0) {
      mustSucceed(await db.from("time_entries").delete().in("id", toDelete.map((entry) => entry.id)));
      deleted.push(...toDelete);
    }
    for (const change of toUpdate) {
      mustSucceed(
        await db
          .from("time_entries")
          .update({ timestamp: change.timestamp, event_id: eventId, notes: change.notes })
          .eq("id", change.original.id)
      );
      updated.push(change.original);
    }
    if (toInsert.length > 0) {
      const result = await db.from("time_entries").insert(toInsert).select("id");
      mustSucceed(result);
      insertedIds = ((result.data || []) as Array<{ id: string }>).map((row) => row.id);
    }
  } catch (err: any) {
    let undone = true;
    try {
      if (insertedIds.length > 0) {
        mustSucceed(await db.from("time_entries").delete().in("id", insertedIds));
      }
      for (const original of updated) {
        mustSucceed(
          await db
            .from("time_entries")
            .update({ timestamp: original.timestamp, event_id: original.event_id, notes: original.notes })
            .eq("id", original.id)
        );
      }
      if (deleted.length > 0) {
        mustSucceed(
          await db.from("time_entries").insert(
            deleted.map((entry) => ({
              id: entry.id,
              user_id: userId,
              action: entry.action,
              timestamp: entry.timestamp,
              division,
              event_id: entry.event_id,
              notes: entry.notes,
            }))
          )
        );
      }
    } catch (undoError) {
      undone = false;
      console.error("[timesheet-apply] rollback failed:", undoError);
    }
    return fail(
      500,
      `${err?.message || "Could not update the time entries."}${
        undone ? "" : " Some entries may have changed. Check the timesheet."
      }`
    );
  }

  return { ok: true, updated: toUpdate.length, inserted: toInsert.length, deleted: toDelete.length };
}
