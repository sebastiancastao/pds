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
      localStorage.setItem('time_tracking_open_entry', JSON.stringify(openEntry));
      localStorage.setItem('time_tracking_notes', notes);
    } else {
      localStorage.removeItem('time_tracking_open_entry');
      localStorage.removeItem('time_tracking_notes');
    }
  }, [openEntry, notes]);

  // Restore state from localStorage on mount
  useEffect(() => {
    const savedEntry = localStorage.getItem('time_tracking_open_entry');
    const savedNotes = localStorage.getItem('time_tracking_notes');
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

  // Auto clock-in when worker lands on the page; auto clock-out when they leave
  const autoClockedRef = useRef(false);
  useEffect(() => {
    if (!isAuthed || loading) return;
    if (!isWorker) return;
    if (autoClockedRef.current) return;
    // After initial refreshOpen finished (loading === false), clock in if not already clocked in
    if (!openEntry) {
      handleClockIn().finally(() => {
        autoClockedRef.current = true;
      });
    } else {
      autoClockedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, isWorker, loading]);

  // Check for cross-day entries and handle them
  useEffect(() => {
    if (!openEntry) return;

    const checkCrossDay = () => {
      const startDate = new Date(openEntry.started_at).toISOString().slice(0, 10);
      const currentDate = new Date().toISOString().slice(0, 10);

      if (startDate !== currentDate) {
        // Entry started on a different day - notify user
        setMessage(`Note: Time tracking started on ${startDate} and is now ${currentDate}`);
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

  // Logout helper - explicitly clock out before logging out
  async function handleLogout() {
    setPendingClockOut(true);
    try {
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
      localStorage.removeItem('time_tracking_open_entry');
      localStorage.removeItem('time_tracking_notes');

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
          {pendingClockOut ? 'Clocking out...' : 'Logout'}
        </button>
        <div className="relative w-80 h-80 z-10">
          {/* Outermost expanding ring */}
          <div
            className="absolute inset-0 rounded-full bg-green-500/20 animate-ping"
            style={{ animationDuration: '2s' }}
          ></div>

          {/* Middle pulsing ring */}
          <div
            className="absolute inset-8 rounded-full bg-green-500/30 animate-pulse"
            style={{ animationDuration: '2s' }}
          ></div>

          {/* Inner solid circle with pulse */}
          <div
            className="absolute inset-16 rounded-full bg-green-500/70 shadow-2xl animate-pulse"
            style={{
              animationDuration: '2s',
              boxShadow: '0 0 40px rgba(34, 197, 94, 0.6), 0 0 80px rgba(34, 197, 94, 0.3)'
            }}
          ></div>

          {/* Center badge */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="px-6 py-3 rounded-full bg-white/95 backdrop-blur-sm shadow-xl text-green-700 text-lg font-semibold border-2 border-green-200">
              Tracking active
            </div>
          </div>
        </div>

        {/* Cross-day notification for worker view */}
        {openEntry && new Date(openEntry.started_at).toISOString().slice(0, 10) !== new Date().toISOString().slice(0, 10) && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 max-w-md">
            <div className="bg-amber-100 border-2 border-amber-300 rounded-lg p-4 shadow-lg">
              <div className="flex items-start gap-3">
                <svg className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-amber-900">Multi-day shift</p>
                  <p className="text-xs text-amber-800 mt-1">
                    Started: {new Date(openEntry.started_at).toISOString().slice(0, 10)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Manager/admin view: keep full controls with gradient background
  return (
    <div className="relative min-h-screen bg-gradient-to-br from-primary-50 to-primary-100">
      <div className="container mx-auto max-w-3xl p-6 space-y-6 relative z-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-primary-900">Time Tracking</h1>
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
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
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-transform transition-shadow focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-rose-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          {pendingClockOut ? 'Clocking out...' : 'Logout'}
        </button>
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
