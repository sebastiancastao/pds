"use client";

// Browser helpers for the timesheet edit permission workflow: a data hook plus
// the two calls that change state. Rules and types live in
// lib/timesheet-edit-requests.ts.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  TIMESHEET_TIME_FIELDS,
  emptyTimesheetTimes,
  type TimesheetEditProposal,
  type TimesheetEditRequest,
  type TimesheetEditStatus,
  type TimesheetEditViewer,
  type TimesheetTimes,
} from "@/lib/timesheet-edit-requests";

const ENDPOINT = "/api/timesheet-edit-requests";

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Your session has expired. Please sign in again.");
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
  };
}

async function readJson(res: Response): Promise<any> {
  return res.json().catch(() => ({}));
}

export async function submitTimesheetEditRequest(input: {
  eventId: string;
  targetUserId: string;
  requestReason: string;
  // The times the requester wants. Omit for a request that only has a reason.
  requestedChanges?: TimesheetEditProposal | null;
}): Promise<{ deduped: boolean }> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const body = await readJson(res);
  if (!res.ok) {
    throw new Error(body?.error || "Failed to submit the edit request.");
  }
  return { deduped: Boolean(body?.deduped) };
}

export async function reviewTimesheetEditRequest(input: {
  requestId: string;
  status: Exclude<TimesheetEditStatus, "submitted">;
  reviewNotes?: string;
}): Promise<void> {
  const res = await fetch(ENDPOINT, {
    method: "PATCH",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const body = await readJson(res);
  if (!res.ok) {
    throw new Error(body?.error || "Failed to update the edit request.");
  }
}

type HookOptions = {
  // Limit to one worker. Required for viewers who are not reviewers.
  userId?: string | null;
  // "open", "active", "all", or a comma separated list of statuses.
  status: string;
  limit?: number;
  // Change this value to force a reload.
  refreshKey?: number;
  // Silent background refresh interval. Omit to disable.
  pollMs?: number;
  enabled?: boolean;
};

export function useTimesheetEditRequests(options: HookOptions) {
  const { userId, status, limit = 200, refreshKey = 0, pollMs, enabled = true } = options;

  const [requests, setRequests] = useState<TimesheetEditRequest[]>([]);
  const [viewer, setViewer] = useState<TimesheetEditViewer | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  // True when the API says this viewer may not read the requests at all.
  const [forbidden, setForbidden] = useState(false);

  const latestCallRef = useRef(0);

  const load = useCallback(async () => {
    const callId = ++latestCallRef.current;
    try {
      const headers = await authHeaders();
      const qs = new URLSearchParams({ status, limit: String(limit) });
      if (userId) qs.set("userId", userId);
      const res = await fetch(`${ENDPOINT}?${qs.toString()}`, {
        headers,
        cache: "no-store",
      });
      const body = await readJson(res);
      // A newer call has started; ignore this stale response.
      if (callId !== latestCallRef.current) return;

      if (res.status === 403) {
        setForbidden(true);
        setRequests([]);
        setError("");
        return;
      }
      if (!res.ok) {
        throw new Error(body?.error || "Failed to load timesheet edit requests.");
      }
      setForbidden(false);
      setRequests(Array.isArray(body?.requests) ? body.requests : []);
      setViewer(body?.viewer ?? null);
      setError("");
    } catch (err: any) {
      if (callId !== latestCallRef.current) return;
      setError(err?.message || "Failed to load timesheet edit requests.");
    } finally {
      if (callId === latestCallRef.current) setLoading(false);
    }
  }, [userId, status, limit]);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load, refreshKey]);

  useEffect(() => {
    if (!enabled || !pollMs) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, pollMs);
    return () => window.clearInterval(id);
  }, [enabled, pollMs, load]);

  return { requests, viewer, loading, error, forbidden, reload: load };
}

export type TimesheetTimesSnapshot = {
  eventDate: string;
  eventEndDate: string;
  workDate: string;
  times: TimesheetTimes;
};

// The times currently recorded for one work day, read from the same endpoint
// the timesheet page uses so the values match what it shows.
export async function loadTimesheetTimes(input: {
  eventId: string;
  workerId: string;
  workDate?: string;
}): Promise<TimesheetTimesSnapshot> {
  const qs = new URLSearchParams({ userId: input.workerId });
  if (input.workDate) qs.set("workDate", input.workDate);

  const res = await fetch(`/api/events/${encodeURIComponent(input.eventId)}/self-timesheet?${qs}`, {
    headers: await authHeaders(),
    cache: "no-store",
  });
  const body = await readJson(res);
  if (!res.ok) {
    throw new Error(body?.error || "Failed to load the current timesheet.");
  }

  const times = emptyTimesheetTimes();
  for (const field of TIMESHEET_TIME_FIELDS) {
    const shown = body?.timesheet?.[`${field.key}Display`];
    times[field.key] = typeof shown === "string" ? shown : "";
  }

  const eventDate = String(body?.event?.date || "");
  return {
    eventDate,
    eventEndDate: String(body?.event?.endDate || eventDate),
    workDate: String(body?.workDate || eventDate),
    times,
  };
}

// Every calendar day from start to end, inclusive, as YYYY-MM-DD.
export function listWorkDates(start: string, end: string): string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  if (!match || !end || end < start) return start ? [start] : [];
  const cursor = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const dates: string[] = [];
  // A hard cap keeps a bad end date from producing an endless list.
  for (let i = 0; i < 60; i += 1) {
    const day = cursor.toISOString().slice(0, 10);
    dates.push(day);
    if (day >= end) break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
