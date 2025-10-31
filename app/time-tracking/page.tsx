"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type TimeEntry = {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  notes: string | null;
  created_at: string;
};

function msToHMS(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export default function TimeTrackingPage() {
  const [isAuthed, setIsAuthed] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  const [openEntry, setOpenEntry] = useState<TimeEntry | null>(null);
  const [openMeal, setOpenMeal] = useState<TimeEntry | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [notes, setNotes] = useState<string>("");
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const [message, setMessage] = useState<string>("");

  const tickRef = useRef<number | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        window.location.href = "/login";
      } else {
        const { data } = await supabase.auth.getSession();
        setAccessToken(data.session?.access_token || null);
        setIsAuthed(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    (async () => {
      await refreshOpen();
      await refreshMealOpen();
      await refreshToday();
      setLoading(false);
    })();
  }, [isAuthed]);

  useEffect(() => {
    if (openEntry || openMeal) {
      tickRef.current = window.setInterval(() => setNow(Date.now()), 1000);
      return () => {
        if (tickRef.current) window.clearInterval(tickRef.current);
      };
    } else {
      if (tickRef.current) window.clearInterval(tickRef.current);
    }
  }, [openEntry, openMeal]);

  const openElapsedMs = useMemo(() => {
    if (!openEntry) return 0;
    const start = new Date(openEntry.started_at).getTime();
    return now - start;
  }, [openEntry, now]);

  const today = useMemo(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }, []);

  async function refreshOpen() {
    try {
      const res = await fetch("/api/time-entries?open=1", {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.statusText);
      setOpenEntry(body.open);
    } catch (e: any) {
      setMessage(`Failed loading open entry: ${e.message}`);
    }
  }

  async function refreshMealOpen() {
    try {
      const res = await fetch("/api/time-entries/meal?open=1", {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.statusText);
      setOpenMeal(body.open);
    } catch (e: any) {
      setMessage(`Failed loading meal entry: ${e.message}`);
    }
  }

  async function refreshToday() {
    try {
      const res = await fetch(`/api/time-entries?since=${encodeURIComponent(today)}`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.statusText);
      setEntries(body.entries ?? []);
    } catch (e: any) {
      setMessage(`Failed loading entries: ${e.message}`);
    }
  }

  async function handleClockIn() {
    setMessage("");
    try {
      const res = await fetch("/api/time-entries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ notes }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.statusText);
      setOpenEntry(body.entry);
      setNotes(body.entry?.notes ?? "");
      await Promise.all([refreshToday(), refreshMealOpen()]);
    } catch (e: any) {
      setMessage(e.message || "Clock-in failed");
    }
  }

  async function handleClockOut() {
    setMessage("");
    try {
      const res = await fetch("/api/time-entries", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ notes }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.statusText);
      setOpenEntry(null);
      await Promise.all([refreshToday(), refreshMealOpen()]);
    } catch (e: any) {
      setMessage(e.message || "Clock-out failed");
    }
  }

  async function handleMealStart() {
    setMessage("");
    try {
      const res = await fetch("/api/time-entries/meal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ notes }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.statusText);
      setOpenMeal(body.entry);
    } catch (e: any) {
      setMessage(e.message || "Start meal failed");
    }
  }

  async function handleMealEnd() {
    setMessage("");
    try {
      const res = await fetch("/api/time-entries/meal", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ notes }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.statusText);
      setOpenMeal(null);
    } catch (e: any) {
      setMessage(e.message || "End meal failed");
    }
  }

  const todaysTotalMs = useMemo(() => {
    return entries.reduce((acc, e) => {
      const start = new Date(e.started_at).getTime();
      const end = e.ended_at ? new Date(e.ended_at).getTime() : Date.now();
      return acc + Math.max(0, end - start);
    }, 0);
  }, [entries]);

  const mealElapsedMs = useMemo(() => {
    if (!openMeal) return 0;
    const start = new Date(openMeal.started_at).getTime();
    return now - start;
  }, [openMeal, now]);

  if (!isAuthed || loading) {
    return (
      <div className="container mx-auto max-w-3xl p-6">
        <div className="text-gray-600">Loading…</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Time Tracking</h1>
        <a href="/dashboard" className="text-sm text-blue-600 hover:underline">← Back to Dashboard</a>
      </div>

      {message && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          {message}
        </div>
      )}

      <div className="rounded-lg border bg-white p-6 space-y-4">
        <div className="text-sm text-gray-500">Status</div>
        <div className="flex items-end justify-between">
          <div>
            <div className="text-4xl font-extrabold tracking-tight">
              {openEntry ? msToHMS(openElapsedMs) : "00:00:00"}
            </div>
            <div className="text-sm text-gray-500">
              {openEntry
                ? `Started at ${new Date(openEntry.started_at).toLocaleTimeString()}`
                : "No active timer"}
            </div>
            <div className="mt-3">
              <div className="text-xs text-gray-500">Meal</div>
              <div className="text-xl font-bold">{openMeal ? msToHMS(mealElapsedMs) : "00:00:00"}</div>
              <div className="text-xs text-gray-500">
                {openMeal ? `Started at ${new Date(openMeal.started_at).toLocaleTimeString()}` : "No active meal"}
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleClockIn}
              disabled={!!openEntry}
              className={`px-4 py-2 rounded-md text-white font-semibold transition 
                ${openEntry ? "bg-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"}`}
            >
              Clock In
            </button>
            <button
              onClick={handleClockOut}
              disabled={!openEntry}
              className={`px-4 py-2 rounded-md text-white font-semibold transition 
                ${!openEntry ? "bg-gray-400 cursor-not-allowed" : "bg-red-600 hover:bg-red-700"}`}
            >
              Clock Out
            </button>
            <button
              onClick={handleMealStart}
              disabled={!openEntry || !!openMeal}
              className={`px-4 py-2 rounded-md text-white font-semibold transition 
                ${!openEntry || openMeal ? "bg-gray-400 cursor-not-allowed" : "bg-amber-600 hover:bg-amber-700"}`}
            >
              Start Meal
            </button>
            <button
              onClick={handleMealEnd}
              disabled={!openMeal}
              className={`px-4 py-2 rounded-md text-white font-semibold transition 
                ${!openMeal ? "bg-gray-400 cursor-not-allowed" : "bg-amber-700 hover:bg-amber-800"}`}
            >
              End Meal
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What are you working on?"
            className="w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={3}
          />
          <div className="mt-1 text-xs text-gray-500">Notes are saved on clock in/out.</div>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Today</h2>
          <div className="text-sm text-gray-600">
            Total: <span className="font-bold">{msToHMS(todaysTotalMs)}</span>
          </div>
        </div>

        {entries.length === 0 ? (
          <div className="text-sm text-gray-500">No entries yet today.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Start</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">End</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Duration</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {entries.map((e) => {
                  const start = new Date(e.started_at);
                  const end = e.ended_at ? new Date(e.ended_at) : null;
                  const durMs = (end?.getTime() ?? Date.now()) - start.getTime();
                  return (
                    <tr key={e.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2">{start.toLocaleTimeString()}</td>
                      <td className="px-4 py-2">{end ? end.toLocaleTimeString() : "—"}</td>
                      <td className="px-4 py-2 font-medium">{msToHMS(durMs)}</td>
                      <td className="px-4 py-2">{e.notes || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
