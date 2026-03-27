"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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

export default function TimekeepingPage() {
  const router = useRouter();
  const [isAuthed, setIsAuthed] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  const [openEntry, setOpenEntry] = useState<TimeEntry | null>(null);
  const [openMeal, setOpenMeal] = useState<TimeEntry | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [notes, setNotes] = useState<string>("");
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const [message, setMessage] = useState<string>("");
  const [userRole, setUserRole] = useState<string>("");
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [pendingClockOut, setPendingClockOut] = useState<boolean>(false);

  const tickRef = useRef<number | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const retryQueueRef = useRef<Array<() => Promise<void>>>([]);

  // Network status monitoring
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setMessage("Connection restored");
      setTimeout(() => setMessage(""), 3000);
      // Process retry queue
      if (retryQueueRef.current.length > 0) {
        const queue = [...retryQueueRef.current];
        retryQueueRef.current = [];
        queue.forEach(fn => fn().catch(console.error));
      }
    };
    const handleOffline = () => {
      setIsOnline(false);
      setMessage("You're offline - changes will sync when connection is restored");
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOnline(navigator.onLine);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Persist state to localStorage
  useEffect(() => {
    if (openEntry) {
      localStorage.setItem('time_keeping_open_entry', JSON.stringify(openEntry));
      localStorage.setItem('time_keeping_notes', notes);
    } else {
      localStorage.removeItem('time_keeping_open_entry');
      localStorage.removeItem('time_keeping_notes');
    }
  }, [openEntry, notes]);

  // Restore state from localStorage on mount
  useEffect(() => {
    const savedEntry = localStorage.getItem('time_keeping_open_entry');
    const savedNotes = localStorage.getItem('time_keeping_notes');
    if (savedEntry) {
      try {
        setOpenEntry(JSON.parse(savedEntry));
      } catch {}
    }
    if (savedNotes) {
      setNotes(savedNotes);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        window.location.href = "/login";
      } else {
        if (user.id === "95fdb5d7-84eb-4c07-88eb-92063d8e3fb0") {
          window.location.replace("/register");
          return;
        }

        const { data } = await supabase.auth.getSession();
        setAccessToken(data.session?.access_token || null);
        let role = '';
        try {
          const { data: roleRow } = await supabase
            .from('users')
            .select('role')
            .eq('id', user.id)
            .single<{ role: string }>();
          role = (roleRow?.role || '').toString().trim().toLowerCase();
          setUserRole(role);
        } catch {}

        // Check onboarding status for workers
        if (role === 'worker' || role === 'vendor') {
          try {
            const onboardingResponse = await fetch('/api/auth/check-onboarding', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${data.session?.access_token}`
              },
            });
            if (onboardingResponse.ok) {
              const onboardingResult = await onboardingResponse.json();
              // Only redirect to pending if there's a record in vendor_onboarding_status with onboarding_completed = false
              if (onboardingResult.hasOnboardingRecord && !onboardingResult.approved) {
                window.location.href = '/onboarding-pending';
                return;
              }
            }
          } catch (e) {
            console.error('Error checking onboarding status:', e);
          }
        }

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

  // Determine if this user should use the "worker" experience
  const isWorker = useMemo(() => {
    const r = (userRole || '').toLowerCase();
    // Treat non-admin/hr/exec as worker; also include explicit 'worker'
    if (r === 'admin' || r === 'hr' || r === 'exec') return false;
    return true;
  }, [userRole]);

  // Auto clock-in for manager/admin users when the page opens.
  const autoClockedRef = useRef(false);
  useEffect(() => {
    if (!isAuthed || loading) return;
    if (isWorker) return;
    if (autoClockedRef.current) return;
    if (!openEntry) {
      handleClockIn().finally(() => {
        autoClockedRef.current = true;
      });
    } else {
      autoClockedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, isWorker, loading, openEntry]);

  // Check for cross-day entries and handle them
  useEffect(() => {
    if (!openEntry) return;

    const checkCrossDay = () => {
      const startDate = new Date(openEntry.started_at).toISOString().slice(0, 10);
      const currentDate = new Date().toISOString().slice(0, 10);

      if (startDate !== currentDate) {
        // Entry started on a different day - notify user
        setMessage(`Note: Time Keeping started on ${startDate} and is now ${currentDate}`);
      }
    };

    // Check immediately and then every minute
    checkCrossDay();
    const interval = setInterval(checkCrossDay, 60000);

    return () => clearInterval(interval);
  }, [openEntry]);

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

    if (isWorker) {
      setMessage("Workers and vendors must use the event check-in flow. This page no longer starts shifts.");
      return;
    }

    if (!isOnline) {
      setMessage("Cannot clock in while offline. Please check your connection.");
      return;
    }

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
      if (!navigator.onLine) {
        setMessage("Lost connection. Clock-in will be retried when online.");
        retryQueueRef.current.push(handleClockIn);
      } else {
        setMessage(e.message || "Clock-in failed");
      }
    }
  }

  async function handleClockOut() {
    setMessage("");

    if (isWorker) {
      setMessage("Workers and vendors must clock out from the event check-in flow.");
      return;
    }

    if (!isOnline) {
      setMessage("Cannot clock out while offline. Your time is still being tracked locally.");
      return;
    }

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
      if (!navigator.onLine) {
        setMessage("Lost connection. Please try again when online to clock out.");
        retryQueueRef.current.push(handleClockOut);
      } else {
        setMessage(e.message || "Clock-out failed");
      }
    }
  }

  async function handleMealStart() {
    setMessage("");
    if (isWorker) {
      setMessage("Workers and vendors must start meals from the event check-in flow.");
      return;
    }
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
    if (isWorker) {
      setMessage("Workers and vendors must end meals from the event check-in flow.");
      return;
    }
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

  // Logout helper - explicitly clock out before logging out
  async function handleLogout() {
    setPendingClockOut(true);
    try {
      if (isWorker) {
        await supabase.auth.signOut();
        return;
      }

      // If user has an open time entry, clock them out first
      if (openEntry) {
        await fetch("/api/time-entries", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ notes }),
        });
      }

      // If user has an open meal break, end it
      if (openMeal) {
        await fetch("/api/time-entries/meal", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ notes }),
        });
      }

      // Clear local storage
      localStorage.removeItem('time_keeping_open_entry');
      localStorage.removeItem('time_keeping_notes');

      await supabase.auth.signOut();
    } catch (error) {
      console.error("Error during logout:", error);
      setMessage("Error clocking out. Please try again.");
      setPendingClockOut(false);
      return;
    } finally {
      setPendingClockOut(false);
      window.location.href = "/login";
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

  // Worker view: gradient background with concentric circles
  if (isWorker) {
    return (
      <div className="relative flex w-full flex-col items-center justify-center overflow-hidden min-h-screen bg-gradient-to-br from-primary-50 to-primary-100">
        {/* Background waves synced with foreground pulse */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative w-[28rem] h-[28rem] sm:w-[32rem] sm:h-[32rem]">
            <div className="time-wave-pulse" />
            <div className="time-wave-pulse time-wave-pulse--delayed" />
          </div>
        </div>

        {/* Online status indicator */}
        <div className="absolute top-4 left-4 z-20">
          <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium ${
            isOnline
              ? 'bg-green-100 text-green-800 border border-green-300'
              : 'bg-red-100 text-red-800 border border-red-300'
          }`}>
            <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`} />
            {isOnline ? 'Online' : 'Offline'}
          </div>
        </div>

        <button
          onClick={handleLogout}
          disabled={pendingClockOut}
          className="absolute top-4 right-4 inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-lg hover:shadow-xl hover:translate-y-0.5 transition-transform transition-shadow focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-rose-500 z-20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          {pendingClockOut ? 'Signing out...' : 'Logout'}
        </button>
        <div className="relative z-10 w-full max-w-xl px-6">
          <div className="rounded-3xl border border-white/70 bg-white/90 p-8 shadow-2xl backdrop-blur-sm">
            <div className="mb-6 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 3c-.77-1.33-2.69-1.33-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-slate-900">Use Event Check-In</h1>
              <p className="mt-2 text-sm text-slate-600">
                Workers and vendors must manage time from the event check-in flow so every entry keeps its event assignment.
              </p>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">This page is now read-only for workers and vendors.</p>
              <p className="mt-1">
                Open your assigned event from the dashboard or use the kiosk link tied to that event before checking in.
              </p>
            </div>

            {message && (
              <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {message}
              </div>
            )}

            {openEntry && (
              <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                <p className="font-semibold">Open shift detected</p>
                <p className="mt-1">
                  Finish this shift from the event check-in flow that started it. This page will not create additional entries for you.
                </p>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => router.push('/dashboard')}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg transition-transform hover:-translate-y-0.5 hover:shadow-xl"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7l9-4 9 4M4 10h16M5 10v10h14V10M9 14h6" />
                </svg>
                Open Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Manager/admin view: keep full controls with gradient background
  return (
    <div className="relative min-h-screen bg-gradient-to-br from-primary-50 to-primary-100">
      <div className="container mx-auto max-w-3xl p-6 space-y-6 relative z-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-primary-900">Time Keeping </h1>
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
            isOnline
              ? 'bg-green-100 text-green-800 border border-green-300'
              : 'bg-red-100 text-red-800 border border-red-300'
          }`}>
            <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`} />
            {isOnline ? 'Online' : 'Offline'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/employee')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-transform transition-shadow focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            My Forms
          </button>
          <button
            onClick={handleLogout}
            disabled={pendingClockOut}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-transform transition-shadow focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-rose-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            {pendingClockOut ? 'Clocking out...' : 'Logout'}
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          {message}
        </div>
      )}

      <div className="rounded-lg border bg-white p-6 space-y-4">
        <div className="text-sm text-gray-500">Status</div>
        <div className="flex items-end justify-between">
          <div></div>

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

        {entries.length === 0 ? (
          <div className="text-sm text-gray-500">No entries yet today.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm"></table>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
