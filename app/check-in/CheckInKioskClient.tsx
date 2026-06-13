"use client";

import { useEffect, useRef, useState, useCallback, MouseEvent, TouchEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { isValidCheckinCode, normalizeCheckinCode } from "@/lib/checkin-code";

// ─── Types ───────────────────────────────────────────────────────────
const STATE_TIMEZONE_MAP: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix",
  AR: "America/Chicago", CA: "America/Los_Angeles", CO: "America/Denver",
  CT: "America/New_York", DE: "America/New_York", FL: "America/New_York",
  GA: "America/New_York", HI: "Pacific/Honolulu", ID: "America/Denver",
  IL: "America/Chicago", IN: "America/Indiana/Indianapolis", IA: "America/Chicago",
  KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago",
  ME: "America/New_York", MD: "America/New_York", MA: "America/New_York",
  MI: "America/Detroit", MN: "America/Chicago", MS: "America/Chicago",
  MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago",
  NV: "America/Los_Angeles", NH: "America/New_York", NJ: "America/New_York",
  NM: "America/Denver", NY: "America/New_York", NC: "America/New_York",
  ND: "America/Chicago", OH: "America/New_York", OK: "America/Chicago",
  OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago",
  TX: "America/Chicago", UT: "America/Denver", VT: "America/New_York",
  VA: "America/New_York", WA: "America/Los_Angeles", WV: "America/New_York",
  WI: "America/Chicago", WY: "America/Denver", DC: "America/New_York",
};

function getTimezoneForState(state: string | null | undefined): string {
  if (!state) return "America/Los_Angeles";
  return STATE_TIMEZONE_MAP[state.toUpperCase().trim()] ?? "America/Los_Angeles";
}

type WorkerStatus = "not_clocked_in" | "clocked_in" | "on_meal";
type ActionType = "clock_in" | "clock_out" | "meal_start" | "meal_end";
const ADMIN_RESPONSE_ENTRY_PROCESSING_MS = 30 * 60 * 1000;
const KIOSK_EVENT_REFRESH_MS = 10_000;
const KIOSK_SHIFT_SUMMARY_REFRESH_MS = 10_000;
const BACKGROUND_REQUEST_TIMEOUT_MS = 8_000;
const VALIDATION_REQUEST_TIMEOUT_MS = 10_000;
const ACTION_REQUEST_TIMEOUT_MS = 12_000;
const SYNC_REQUEST_TIMEOUT_MS = 15_000;
const HEARTBEAT_REQUEST_TIMEOUT_MS = 5_000;

type QueuedAction = {
  id: string;
  code: string;
  action: ActionType;
  timestamp: string;
  userName: string;
  signature?: string;
  attestationAccepted?: boolean;
  eventId?: string;
  clientActionId?: string;
  rejectionReason?: string;
};





type ValidatedWorker = {
  name: string;
  workerId: string;
  codeId: string;
  status: WorkerStatus;
  clockedInAt: string | null;
  mealStartedAt: string | null;
  code: string;
};

// ─── IndexedDB helpers ──────────────────────────────────────────────
const DB_NAME = "pds_checkin_kiosk";
const DB_VERSION = 1;
const STORE_NAME = "offline_queue";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function addToQueue(item: QueuedAction): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllQueued(): Promise<QueuedAction[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function removeFromQueue(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clearQueue(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function generateId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: string }).name === "AbortError")
  );
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

// ─── Component ──────────────────────────────────────────────────────
export default function CheckInKioskPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const eventIdFromUrl = searchParams.get("eventId");

  // Auth
  const [isAuthed, setIsAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const accessTokenRef = useRef<string | null>(null);

  // Code input
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Worker state
  const [worker, setWorker] = useState<ValidatedWorker | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isActioning, setIsActioning] = useState(false);

  // Feedback
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clock-out attestation / signature
  const [showAttestation, setShowAttestation] = useState(false);
  const [signature, setSignature] = useState("");
  const [isDrawing, setIsDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [attestationSummary, setAttestationSummary] = useState<{
    clockInAt: string;
    mealMs: number;
    adminResponseEntryProcessingMs: number;
    totalMsWithAdminResponse: number;
  } | null>(null);
  const [attestationSummaryLoading, setAttestationSummaryLoading] = useState(false);
  const [attestationNowMs, setAttestationNowMs] = useState<number>(() => Date.now());
  const [showRejectionForm, setShowRejectionForm] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectionNote, setRejectionNote] = useState("");
  const [rejectionSignature, setRejectionSignature] = useState("");
  const [isRejectionDrawing, setIsRejectionDrawing] = useState(false);
  const rejectionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mealNowMs, setMealNowMs] = useState<number>(() => Date.now());

  // Online / offline
  const [isOnline, setIsOnline] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const isSyncingRef = useRef(false);

  // Inactivity reset (back to code entry after 30s of no interaction)
  const inactivityRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const INACTIVITY_TIMEOUT = 10_000;

  const [activeEvent, setActiveEvent] = useState<{ id: string; name: string | null; startIso: string; endIso: string; state: string | null } | null>(
    null
  );
  // Persists the last seen event ID so time-window checks still fire after the event ends
  const lastKnownEventIdRef = useRef<string | null>(null);

  // Briefly show the current user's event check-in after they clock in.
  const [eventCheckInFlash, setEventCheckInFlash] = useState<{
    name: string;
    time: string;
    offline?: boolean;
    eventName: string | null;
    eventEndIso?: string;
  } | null>(null);
  const eventCheckInFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentEventId = eventIdFromUrl || activeEvent?.id || lastKnownEventIdRef.current || undefined;

  // ─── Auth & session keep-alive ──────────────────────────────────
  useEffect(() => {
    checkAuth();
  }, []);

  // Block the browser back button across all navigation mechanisms
  useEffect(() => {
    const url = window.location.href;

    // Fill history stack so there are many "back" entries to exhaust
    for (let i = 0; i < 20; i++) {
      window.history.pushState(null, "", url);
    }

    // 1) Capture-phase popstate — intercepts before Next.js bubble-phase listener
    const handlePopState = (e: PopStateEvent) => {
      e.stopImmediatePropagation();
      window.history.pushState(null, "", url);
      // Nuclear fallback: if URL already changed, force it back
      if (window.location.href !== url) {
        window.location.replace(url);
      }
    };
    window.addEventListener("popstate", handlePopState, true);

    // 2) Navigation API (Chrome 102+) — used by Next.js in production builds
    const nav = (window as any).navigation;
    const handleNavigate = (e: any) => {
      if (e.navigationType === "traverse" && e.destination?.url !== url) {
        e.preventDefault();
      }
    };
    if (nav) {
      nav.addEventListener("navigate", handleNavigate);
    }

    return () => {
      window.removeEventListener("popstate", handlePopState, true);
      if (nav) nav.removeEventListener("navigate", handleNavigate);
    };
  }, []);

  // Attestation clock (for the displayed "Clock out time")
  useEffect(() => {
    if (!showAttestation || !worker) return;
    setAttestationNowMs(Date.now());
    const t = setInterval(() => setAttestationNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [showAttestation, worker]);

  // Meal break countdown clock
  useEffect(() => {
    if (!worker || worker.status !== "on_meal") return;
    setMealNowMs(Date.now());
    const t = setInterval(() => setMealNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [worker]);

  // Load shift summary when attestation opens (meal time, etc.)
  useEffect(() => {
    if (!showAttestation || !worker) return;
    if (!isOnline) {
      setAttestationSummary(null);
      setAttestationSummaryLoading(false);
      return;
    }

    let isCancelled = false;

    const run = async (showLoading = false) => {
      try {
        if (showLoading) {
          setAttestationSummaryLoading(true);
        }

        const token = accessTokenRef.current;
        if (!token) return;

        const params = new URLSearchParams({
          workerId: worker.workerId,
          _ts: Date.now().toString(),
        });

        const res = await fetchWithTimeout(`/api/check-in/shift-summary?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        }, BACKGROUND_REQUEST_TIMEOUT_MS);
        const data = await res.json().catch(() => ({}));
        if (isCancelled || !res.ok) return;

        if (data?.active && typeof data?.clockInAt === "string" && typeof data?.mealMs === "number") {
          const adminMs =
            typeof data?.adminResponseEntryProcessingMs === "number"
              ? data.adminResponseEntryProcessingMs
              : ADMIN_RESPONSE_ENTRY_PROCESSING_MS;
          const totalMs =
            typeof data?.totalMsWithAdminResponse === "number"
              ? data.totalMsWithAdminResponse
              : 0;
          setAttestationSummary({
            clockInAt: data.clockInAt,
            mealMs: data.mealMs,
            adminResponseEntryProcessingMs: adminMs,
            totalMsWithAdminResponse: totalMs,
          });
        } else {
          setAttestationSummary(null);
        }
      } catch (e) {
        if (!isCancelled && !isAbortError(e)) {
          console.error("Failed to load shift summary:", e);
        }
      } finally {
        if (!isCancelled && showLoading) {
          setAttestationSummaryLoading(false);
        }
      }
    };

    void run(true);
    const interval = window.setInterval(() => {
      void run(false);
    }, KIOSK_SHIFT_SUMMARY_REFRESH_MS);

    return () => {
      isCancelled = true;
      window.clearInterval(interval);
    };
  }, [isOnline, showAttestation, worker]);

  // Refresh Supabase session every 20 minutes to keep it alive as long as possible
  useEffect(() => {
    if (!isAuthed) return;
    const interval = setInterval(async () => {
      const { data, error } = await supabase.auth.refreshSession();
      if (!error && data.session) {
        accessTokenRef.current = data.session.access_token;
      }
    }, 20 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isAuthed]);

  // Also refresh on visibility change (tab becomes active again)
  useEffect(() => {
    if (!isAuthed) return;
    const handleVisibility = async () => {
      if (document.visibilityState === "visible") {
        const { data, error } = await supabase.auth.refreshSession();
        if (!error && data.session) {
          accessTokenRef.current = data.session.access_token;
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [isAuthed]);

  const checkAuth = async () => {
    const mfaVerified = sessionStorage.getItem("mfa_verified") || localStorage.getItem("mfa_verified");
    if (!mfaVerified) {
      router.push("/verify-mfa");
      return;
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session?.user) {
        router.push("/login");
        return;
      }

      accessTokenRef.current = session.access_token || null;
      setIsAuthed(true);
      setLoading(false);

      if (!navigator.onLine) return;

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          accessTokenRef.current = null;
          setIsAuthed(false);
          router.push("/login");
          return;
        }

        const { data: latestSessionData } = await supabase.auth.getSession();
        accessTokenRef.current = latestSessionData.session?.access_token || accessTokenRef.current;
      } catch (error) {
        console.warn("Unable to verify kiosk session against the server:", error);
      }
    } catch (error) {
      console.error("Failed to restore kiosk session:", error);
      router.push("/login");
    }
  };

  const fetchRecentActivity = useCallback(async () => {
    try {
      if (!isAuthed) return;
      if (!isOnline) return;
      const token = accessTokenRef.current;
      if (!token) return;

      const params = new URLSearchParams({ _ts: Date.now().toString() });
      if (eventIdFromUrl) {
        params.set("eventId", eventIdFromUrl);
      }

      const res = await fetchWithTimeout(`/api/check-in/recent?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }, BACKGROUND_REQUEST_TIMEOUT_MS);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;

      const event = data?.event;
      if (event?.id && event?.startIso && event?.endIso) {
        lastKnownEventIdRef.current = String(event.id);
        setActiveEvent({
          id: String(event.id),
          name: typeof event.name === "string" ? event.name : null,
          startIso: String(event.startIso),
          endIso: String(event.endIso),
          state: typeof event.state === "string" ? event.state : null,
        });
      } else {
        setActiveEvent(null);
      }

    } catch (err) {
      if (!isAbortError(err)) {
        console.error("Failed to fetch kiosk event status:", err);
      }
    }
  }, [eventIdFromUrl, isAuthed, isOnline]);

  // ─── Online / offline handling ──────────────────────────────────
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
    };
    const handleOffline = () => {
      setIsOnline(false);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    setIsOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Load queue count on mount
  useEffect(() => {
    refreshQueueCount();
  }, []);

  // Load recent activity on mount and refresh periodically while online.
  useEffect(() => {
    if (!isAuthed) return;
    if (!isOnline) return;
    fetchRecentActivity();
    const interval = setInterval(fetchRecentActivity, KIOSK_EVENT_REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchRecentActivity, isAuthed, isOnline]);

  // Kiosk heartbeat — lets the admin monitor know this kiosk page is open.
  useEffect(() => {
    if (!isAuthed || !isOnline) return;
    const sendHeartbeat = async () => {
      try {
        const token = accessTokenRef.current;
        if (!token) return;
        await fetchWithTimeout("/api/admin/check-in-monitor", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ eventId: eventIdFromUrl || activeEvent?.id || null }),
        }, HEARTBEAT_REQUEST_TIMEOUT_MS);
      } catch {}
    };
    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 20_000);
    return () => clearInterval(interval);
  }, [isAuthed, isOnline, eventIdFromUrl, activeEvent?.id]);

  const refreshQueueCount = useCallback(async () => {
    try {
      const items = await getAllQueued();
      setQueueCount(items.length);
    } catch {}
  }, []);

  const syncOfflineQueue = async () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    setIsSyncing(true);
    try {
      const items = await getAllQueued();
      if (items.length === 0) {
        setIsSyncing(false);
        isSyncingRef.current = false;
        return;
      }

      const token = accessTokenRef.current;
      if (!token) {
        setIsSyncing(false);
        isSyncingRef.current = false;
        return;
      }

      const res = await fetchWithTimeout("/api/check-in/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ actions: items }),
      }, SYNC_REQUEST_TIMEOUT_MS);

      if (res.ok) {
        const data = await res.json();
        // Remove successfully synced items
        for (const result of data.results || []) {
          if (result.success) {
            await removeFromQueue(result.id);
          }
        }
        await refreshQueueCount();
        if (data.synced > 0) {
          showSuccessMessage(`Synced ${data.synced} offline action${data.synced > 1 ? "s" : ""}`);
          fetchRecentActivity();
        }
      }
    } catch (err) {
      if (!isAbortError(err)) {
        console.error("Sync failed:", err);
      }
    } finally {
      setIsSyncing(false);
      isSyncingRef.current = false;
    }
  };

  // Try to sync periodically when online
  useEffect(() => {
    if (!isOnline || !isAuthed) return;
    syncOfflineQueue();
    const interval = setInterval(syncOfflineQueue, 60_000);
    return () => clearInterval(interval);
  }, [isOnline, isAuthed]);

  // ─── Inactivity auto-reset ─────────────────────────────────────
  const resetInactivityTimer = useCallback(() => {
    if (inactivityRef.current) clearTimeout(inactivityRef.current);
    if (worker) {
      inactivityRef.current = setTimeout(() => {
        resetToCodeEntry();
      }, INACTIVITY_TIMEOUT);
    }
  }, [worker]);

  useEffect(() => {
    resetInactivityTimer();
    return () => {
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
    };
  }, [worker, resetInactivityTimer]);

  // Reset inactivity on any interaction
  useEffect(() => {
    const handleActivity = () => resetInactivityTimer();
    window.addEventListener("pointerdown", handleActivity);
    window.addEventListener("keydown", handleActivity);
    return () => {
      window.removeEventListener("pointerdown", handleActivity);
      window.removeEventListener("keydown", handleActivity);
    };
  }, [resetInactivityTimer]);

  // ─── Canvas (signature) ────────────────────────────────────────
  useEffect(() => {
    if (showAttestation && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  }, [showAttestation]);

  const getCanvasCoordinates = (e: MouseEvent<HTMLCanvasElement> | TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  };

  const startDrawing = (e: MouseEvent<HTMLCanvasElement> | TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setIsDrawing(true);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCanvasCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: MouseEvent<HTMLCanvasElement> | TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCanvasCoordinates(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (canvasRef.current) {
      setSignature(canvasRef.current.toDataURL());
    }
  };

  const clearSignature = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !canvasRef.current) return;
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setSignature("");
  };

  // ─── Rejection canvas (signature) ──────────────────────────────
  useEffect(() => {
    if (showRejectionForm && rejectionCanvasRef.current) {
      const canvas = rejectionCanvasRef.current;
      const ctx = canvas.getContext("2d");
      if (ctx) { ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    }
  }, [showRejectionForm]);

  const getRejectionCanvasCoordinates = (e: MouseEvent<HTMLCanvasElement> | TouchEvent<HTMLCanvasElement>) => {
    const canvas = rejectionCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    return { x: (clientX - rect.left) * (canvas.width / rect.width), y: (clientY - rect.top) * (canvas.height / rect.height) };
  };

  const startRejectionDrawing = (e: MouseEvent<HTMLCanvasElement> | TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setIsRejectionDrawing(true);
    const ctx = rejectionCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getRejectionCanvasCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const drawRejection = (e: MouseEvent<HTMLCanvasElement> | TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!isRejectionDrawing) return;
    const ctx = rejectionCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getRejectionCanvasCoordinates(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  };

  const stopRejectionDrawing = () => {
    if (!isRejectionDrawing) return;
    setIsRejectionDrawing(false);
    if (rejectionCanvasRef.current) setRejectionSignature(rejectionCanvasRef.current.toDataURL());
  };

  const clearRejectionSignature = () => {
    const canvas = rejectionCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setRejectionSignature("");
  };

  // ─── Helpers ───────────────────────────────────────────────────
  const toPacificHHMM = (input: string | number | Date | null | undefined): string => {
    if (!input) return "--";
    const d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return "--";
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: getTimezoneForState(activeEvent?.state),
    });
  };

  const showSuccessMessage = (msg: string) => {
    setSuccess(msg);
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    successTimeoutRef.current = setTimeout(() => setSuccess(""), 3000);
  };

  const formatDuration = (ms: number) => {
    if (!Number.isFinite(ms) || ms < 0) return "--";
    const totalMinutes = Math.floor(ms / 60_000);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}h ${String(m).padStart(2, "0")}m`;
  };

  const showEventCheckInFlashMessage = (name: string, offline?: boolean) => {
    if (!activeEvent && !eventIdFromUrl) return;

    const now = new Date();
    const time = toPacificHHMM(now);

    setEventCheckInFlash({
      name,
      time,
      offline,
      eventName: activeEvent?.name ?? null,
      eventEndIso: activeEvent?.endIso,
    });

    if (eventCheckInFlashTimeoutRef.current) clearTimeout(eventCheckInFlashTimeoutRef.current);
    eventCheckInFlashTimeoutRef.current = setTimeout(() => setEventCheckInFlash(null), 3500);
  };

  const queueActionLocally = async (
    queuedItem: QueuedAction,
    actionLabel: string,
    reason: "offline" | "slow"
  ) => {
    await addToQueue(queuedItem);
    await refreshQueueCount();

    if (queuedItem.action === "clock_in") {
      showEventCheckInFlashMessage(queuedItem.userName, true);
    }

    showSuccessMessage(
      reason === "slow"
        ? `${actionLabel} (saved locally due to slow connection)`
        : `${actionLabel} (queued offline)`
    );
    setTimeout(resetToCodeEntry, 1500);
  };

  const resetToCodeEntry = () => {
    setWorker(null);
    setDigits(["", "", "", "", "", ""]);
    setError("");
    setSuccess("");
    setShowAttestation(false);
    setSignature("");
    setIsSubmitting(false);
    setIsActioning(false);

    if (eventCheckInFlashTimeoutRef.current) clearTimeout(eventCheckInFlashTimeoutRef.current);
    setEventCheckInFlash(null);

    setTimeout(() => inputRefs.current[0]?.focus(), 100);
  };

  // ─── Code input handlers ───────────────────────────────────────
  const handleDigitChange = (index: number, value: string) => {
    const nextChar = value.slice(-1).toUpperCase();
    const digit = index < 2
      ? nextChar.replace(/[^A-Z]/g, "")
      : nextChar.replace(/\D/g, "");
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);
    setError("");
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === "Enter") {
      handleValidate();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = normalizeCheckinCode(e.clipboardData.getData("text")).replace(
      /[^A-Z0-9]/g,
      ""
    );
    if (!pasted) return;

    const letters = pasted.replace(/[^A-Z]/g, "");
    const numbers = pasted.replace(/\D/g, "");
    if (letters.length < 2 || numbers.length < 4) {
      setError("Code format is 2 initials + 4 digits");
      return;
    }

    const normalized = `${letters.slice(0, 2)}${numbers.slice(0, 4)}`;
    const newDigits = [...digits];
    for (let i = 0; i < 6; i++) newDigits[i] = normalized[i] || "";
    setDigits(newDigits);
    setError("");
    inputRefs.current[5]?.focus();
  };

  // ─── Validate code ─────────────────────────────────────────────
  const handleValidate = async () => {
    const code = normalizeCheckinCode(digits.join(""));
    if (!isValidCheckinCode(code)) {
      setError("Code format is 2 initials + 4 digits");
      return;
    }

    if (!currentEventId) {
      setError("This kiosk is not attached to an event. Open check-in from a specific event link.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    // If offline, we can't validate - show a message
    if (!isOnline) {
      setError("Cannot validate codes while offline. Actions for already-validated workers can still be queued.");
      setIsSubmitting(false);
      return;
    }

    try {
      const token = accessTokenRef.current;
      if (!token) {
        setError("Session expired. Please refresh the page.");
        setIsSubmitting(false);
        return;
      }

      const res = await fetchWithTimeout("/api/check-in/validate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code, eventId: currentEventId }),
      }, VALIDATION_REQUEST_TIMEOUT_MS);

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Invalid code");
        setIsSubmitting(false);
        return;
      }

      setWorker({
        name: data.name,
        workerId: data.workerId,
        codeId: data.codeId,
        status: data.status,
        clockedInAt: data.clockedInAt,
        mealStartedAt: data.mealStartedAt ?? null,
        code,
      });
    } catch (err) {
      if (isAbortError(err)) {
        setError(
          "Connection is slow or unavailable. Code validation needs internet. If a worker is already verified on screen, actions can still be saved locally."
        );
      } else {
        setError("Connection error. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Perform action (online or queue offline) ──────────────────
  const performAction = async (
    action: ActionType,
    sig?: string,
    options?: { attestationAccepted?: boolean; rejectionReason?: string }
  ) => {
    if (!worker) return;
    if (!currentEventId) {
      setError("This kiosk is not attached to an event. Open check-in from a specific event link.");
      return;
    }
    setIsActioning(true);
    setError("");
    const attestationAccepted = options?.attestationAccepted;
    const rejectionReason = options?.rejectionReason;
    const clientActionId = generateId();
    const actionLabel =
      action === "clock_out" && attestationAccepted === false
        ? "Clocked Out (attestation rejected)"
        : ({
            clock_in: "Checked In",
            clock_out: "Clocked Out",
            meal_start: "Meal Started",
            meal_end: "Meal Ended",
          } as Record<ActionType, string>)[action];

    const queuedItem: QueuedAction = {
      id: clientActionId,
      clientActionId,
      code: worker.code,
      action,
      timestamp: new Date().toISOString(),
      userName: worker.name,
      signature: sig,
      attestationAccepted,
      rejectionReason,
      eventId: currentEventId,
    };

    if (!isOnline) {
      try {
        await queueActionLocally(queuedItem, actionLabel, "offline");
      } catch {
        setError("Failed to save offline. Please try again.");
      } finally {
        setIsActioning(false);
      }
      return;
    }

    try {
      const token = accessTokenRef.current;
      if (!token) {
        setError("Session expired. Please refresh.");
        setIsActioning(false);
        return;
      }

      const res = await fetchWithTimeout("/api/check-in/action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code: worker.code,
          action,
          signature: sig,
          attestationAccepted,
          rejectionReason,
          eventId: queuedItem.eventId,
          clientActionId,
        }),
      }, ACTION_REQUEST_TIMEOUT_MS);

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Server explicitly rejected this action — never queue it offline,
        // as the sync route does not re-check team membership / rejection status.
        setError(data.error || "Action failed");
        return;
      }

      if (action === "clock_in") showEventCheckInFlashMessage(worker.name);
      showSuccessMessage(`${worker.name} - ${actionLabel}!`);
      fetchRecentActivity();
      setTimeout(resetToCodeEntry, 1500);
    } catch (err) {
      // Slow or failed network requests fall back to the local queue.
      if (isAbortError(err) || !navigator.onLine || err instanceof TypeError) {
        try {
          await queueActionLocally(
            queuedItem,
            actionLabel,
            isAbortError(err) && navigator.onLine ? "slow" : "offline"
          );
        } catch {
          setError("Failed to save locally. Please try again.");
        }
      } else {
        setError("Action failed. Please try again.");
      }
    } finally {
      setIsActioning(false);
    }
  };

  // ─── Action handlers ───────────────────────────────────────────
  const handleCheckIn = () => performAction("clock_in");
  const handleMealStart = () => performAction("meal_start");
  const handleMealEnd = () => performAction("meal_end");

  const handleClockOutClick = () => setShowAttestation(true);
  const handleConfirmClockOut = () => {
    if (!signature) {
      setError("Please sign before confirming");
      return;
    }
    performAction("clock_out", signature, { attestationAccepted: true });
    setShowAttestation(false);
    setAttestationSummary(null);
    setAttestationSummaryLoading(false);
    setSignature("");
  };
  const handleRejectAttestation = () => {
    setShowRejectionForm(true);
  };
  const handleConfirmRejection = () => {
    if (!rejectionReason) {
      setError("Please select a reason for rejection");
      return;
    }
    if (rejectionReason === "Other" && !rejectionNote.trim()) {
      setError("Please provide a note explaining the reason");
      return;
    }
    if (!rejectionSignature) {
      setError("Please sign before confirming");
      return;
    }
    const finalReason =
      rejectionReason === "Other" ? `Other: ${rejectionNote.trim()}` : rejectionReason;
    performAction("clock_out", rejectionSignature, {
      attestationAccepted: false,
      rejectionReason: finalReason,
    });
    setShowRejectionForm(false);
    setShowAttestation(false);
    setAttestationSummary(null);
    setAttestationSummaryLoading(false);
    setSignature("");
    setRejectionReason("");
    setRejectionNote("");
    setRejectionSignature("");
  };
  const handleCancelAttestation = () => {
    setShowAttestation(false);
    setShowRejectionForm(false);
    setAttestationSummary(null);
    setAttestationSummaryLoading(false);
    setSignature("");
    setRejectionReason("");
    setRejectionNote("");
    setRejectionSignature("");
    clearSignature();
  };

  // ─── Loading state ─────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-ios-blue" />
      </div>
    );
  }
  if (!isAuthed) return null;

  const codeComplete = isValidCheckinCode(digits.join(""));

  // ─── Rejection reason screen ───────────────────────────────────
  if (showAttestation && showRejectionForm && worker) {
    const REJECTION_REASONS = [
      "I was provided an opportunity to take a 30-minute duty-free meal break before the end of my 5th hour of work but chose not to;",
      "I was provided an opportunity to take a 30-minute duty-free meal break before the end of my 5th hour of work but chose to take a shorter break;",
      "I was provided an opportunity to take a 30-minute duty-free meal break before the end of my 5th hour of work but chose to take a later break;",
      "I was not provided an opportunity to take a 30-minute duty-free meal break before the end of my 5th hour of work.",
      "Other",
    ];
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Reason for Rejection</h2>
              <p className="text-gray-600 mt-2">Please select the reason you are rejecting the attestation.</p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2 mb-4">
                <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <div className="space-y-2 mb-4">
              {REJECTION_REASONS.map((reason) => (
                <button
                  key={reason}
                  onClick={() => { setRejectionReason(reason); setError(""); }}
                  className={`w-full text-left px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
                    rejectionReason === reason
                      ? "border-red-400 bg-red-50 text-red-800"
                      : "border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {reason}
                </button>
              ))}
              {rejectionReason === "Other" && (
                <textarea
                  value={rejectionNote}
                  onChange={(e) => setRejectionNote(e.target.value)}
                  placeholder="Please describe the reason..."
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border-2 border-red-300 bg-red-50 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-red-400 resize-none mt-1"
                />
              )}
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Your Signature</label>
              <div className="border-2 border-gray-300 rounded-xl overflow-hidden bg-white">
                <canvas
                  ref={rejectionCanvasRef}
                  width={400}
                  height={150}
                  className="w-full h-32 touch-none cursor-crosshair"
                  onMouseDown={startRejectionDrawing}
                  onMouseMove={drawRejection}
                  onMouseUp={stopRejectionDrawing}
                  onMouseLeave={stopRejectionDrawing}
                  onTouchStart={startRejectionDrawing}
                  onTouchMove={drawRejection}
                  onTouchEnd={stopRejectionDrawing}
                />
              </div>
              <button onClick={clearRejectionSignature} className="text-sm text-ios-blue hover:text-blue-700 mt-2">
                Clear Signature
              </button>
            </div>

            <div className="space-y-3">
              <button
                onClick={handleConfirmRejection}
                disabled={isActioning}
                className="w-full py-3 px-4 bg-red-500 hover:bg-red-600 text-white rounded-xl font-medium transition-all shadow-lg disabled:opacity-50"
              >
                {isActioning ? "Processing..." : "Confirm Rejection & Clock Out"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Attestation screen ────────────────────────────────────────
  if (showAttestation && worker) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Clock Out Attestation</h2>
              <p className="text-gray-600 mt-2">Sign to accept, or reject if these statements are not accurate.</p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2 mb-6">
                <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6 text-sm text-gray-700">
              <p className="mb-2">
                I, <span className="font-semibold">{worker.name}</span>, hereby attest that:
              </p>
              <ul className="list-disc list-inside space-y-1 text-gray-600">
                <li>All of my hours recorded for the workday are complete and accurate.</li>
                <li>I was provided with all meal periods and was authorized and permitted to take all rest and recovery periods to which I was entitled in compliance with the Company's policies during the workday, except any that I previously reported to my supervisor/Operations Director and/or Human Resources.</li>
                <li>I have not violated any Company policy during the workday, including, but not limited to, the Company's policy against working off-the clock.</li>
                <li>I understand that I may raise any concerns about my ability to take meal periods or rest breaks, or any instruction or pressure to work "off-the-clock," or incorrectly reporting my time worked at any time without fear of retaliation.</li>
              </ul>
            </div>

            <div className="bg-white/70 border border-gray-200 rounded-xl p-4 mb-6">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Check In</div>
                  <div className="mt-1 font-semibold text-gray-900">
                    {toPacificHHMM(worker.clockedInAt)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Check Out</div>
                  <div className="mt-1 font-semibold text-gray-900">
                    {toPacificHHMM(attestationNowMs)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Meal Time</div>
                  <div className="mt-1 font-semibold text-gray-900">
                    {attestationSummaryLoading
                      ? "Loading..."
                      : attestationSummary
                        ? formatDuration(attestationSummary.mealMs)
                        : "--"}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Admin response time / entry processing time</div>
                  <div className="mt-1 font-semibold text-gray-900">
                    {formatDuration(attestationSummary?.adminResponseEntryProcessingMs ?? ADMIN_RESPONSE_ENTRY_PROCESSING_MS)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Total Time</div>
                  <div className="mt-1 font-semibold text-gray-900">
                    {(() => {
                      const startIso = attestationSummary?.clockInAt || worker.clockedInAt;
                      const startMs = startIso ? Date.parse(startIso) : NaN;
                      if (Number.isNaN(startMs)) {
                        if (
                          attestationSummary &&
                          Number.isFinite(attestationSummary.totalMsWithAdminResponse) &&
                          attestationSummary.totalMsWithAdminResponse > 0
                        ) {
                          return formatDuration(attestationSummary.totalMsWithAdminResponse);
                        }
                        return "--";
                      }
                      const mealMs = attestationSummary?.mealMs || 0;
                      const netMs = Math.max(0, attestationNowMs - startMs - mealMs);
                      const adminMs =
                        attestationSummary?.adminResponseEntryProcessingMs ??
                        ADMIN_RESPONSE_ENTRY_PROCESSING_MS;
                      return formatDuration(netMs + adminMs);
                    })()}
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Your Signature</label>
              <div className="border-2 border-gray-300 rounded-xl overflow-hidden bg-white">
                <canvas
                  ref={canvasRef}
                  width={400}
                  height={150}
                  className="w-full h-32 touch-none cursor-crosshair"
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={draw}
                  onTouchEnd={stopDrawing}
                />
              </div>
              <button onClick={clearSignature} className="text-sm text-ios-blue hover:text-blue-700 mt-2">
                Clear Signature
              </button>
            </div>

            <div className="space-y-3">
              <button
                onClick={handleConfirmClockOut}
                disabled={isActioning}
                className="w-full py-3 px-4 bg-green-500 hover:bg-green-600 text-white rounded-xl font-medium transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isActioning ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Processing...
                  </span>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Accept & Clock Out
                  </>
                )}
              </button>
              <button
                onClick={handleRejectAttestation}
                disabled={isActioning}
                className="w-full py-3 px-4 border border-red-300 text-red-700 rounded-xl font-medium hover:bg-red-50 transition-all disabled:opacity-50"
              >
                Reject & Clock Out
              </button>
              <button
                onClick={handleCancelAttestation}
                className="w-full py-3 px-4 border border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Main kiosk UI ─────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex flex-col">
      {/* Top bar: online status + offline queue badge */}
      <div className="flex items-center justify-between px-4 py-3">
        <div
          className={`inline-flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium ${
            isOnline
              ? "bg-green-100 text-green-800 border border-green-300"
              : "bg-red-100 text-red-800 border border-red-300"
          }`}
        >
          <div className={`w-2.5 h-2.5 rounded-full ${isOnline ? "bg-green-500" : "bg-red-500 animate-pulse"}`} />
          {isOnline ? "Online" : "Offline"}
        </div>
        <div className="flex items-center gap-3">
          {queueCount > 0 && (
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium bg-amber-100 text-amber-800 border border-amber-300">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {queueCount} pending
              {isSyncing && <span className="animate-spin ml-1">...</span>}
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
            {/* Success toast */}
            {success && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3 mb-6 animate-pulse">
                <svg className="w-6 h-6 text-green-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <p className="text-green-800 font-medium">{success}</p>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2 mb-6">
                <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            {/* ── Worker identified: show action buttons ── */}
            {worker && !success && (
              <div className="text-center">
                {/* Greeting */}
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-6">
                  <p className="text-2xl font-bold text-blue-700">Hello, {worker.name}</p>
                  <p className="text-blue-600 text-sm mt-2">
                    {worker.status === "not_clocked_in" && "You are not clocked in"}
                    {worker.status === "clocked_in" && "You are currently clocked in"}
                    {worker.status === "on_meal" && "You are on a meal break"}
                  </p>
                  {worker.status === "on_meal" && worker.mealStartedAt && (
                    <p className="text-blue-500 text-xs mt-1">
                      Since {toPacificHHMM(worker.mealStartedAt)}
                    </p>
                  )}
                  {worker.status === "clocked_in" && worker.clockedInAt && (
                    <p className="text-blue-500 text-xs mt-1">
                      Since {toPacificHHMM(worker.clockedInAt)}
                    </p>
                  )}
                </div>

                {/* Action buttons based on status */}
                <div className="space-y-3">
                  {/* NOT CLOCKED IN → Check In */}
                  {worker.status === "not_clocked_in" && (
                    <button
                      onClick={handleCheckIn}
                      disabled={isActioning}
                      className="w-full py-4 px-4 bg-green-500 hover:bg-green-600 text-white rounded-xl font-semibold text-lg transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isActioning ? (
                        <span className="flex items-center gap-2">
                          <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Checking in...
                        </span>
                      ) : (
                        <>
                          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                          </svg>
                          Check In
                        </>
                      )}
                    </button>
                  )}

                  {/* CLOCKED IN → Meal Time + Clock Out */}
                  {worker.status === "clocked_in" && (
                    <>
                      <button
                        onClick={handleMealStart}
                        disabled={isActioning}
                        className="w-full py-4 px-4 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold text-lg transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {isActioning ? "Processing..." : (
                          <>
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Meal Time
                          </>
                        )}
                      </button>
                      <button
                        onClick={handleClockOutClick}
                        disabled={isActioning}
                        className="w-full py-4 px-4 bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold text-lg transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        Clock Out
                      </button>
                    </>
                  )}

                  {/* ON MEAL → End Meal + Clock Out */}
                  {worker.status === "on_meal" && (() => {
                    const THIRTY_MIN_MS = 30 * 60 * 1000;
                    const mealElapsedMs = worker.mealStartedAt
                      ? mealNowMs - new Date(worker.mealStartedAt).getTime()
                      : THIRTY_MIN_MS;
                    const mealReady = mealElapsedMs >= THIRTY_MIN_MS;
                    const remainingMs = Math.max(0, THIRTY_MIN_MS - mealElapsedMs);
                    const remainingMins = Math.floor(remainingMs / 60000);
                    const remainingSecs = Math.floor((remainingMs % 60000) / 1000);
                    return (
                    <>
                      <button
                        onClick={handleMealEnd}
                        disabled={isActioning || !mealReady}
                        className={`w-full py-4 px-4 text-white rounded-xl font-semibold text-lg transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 ${mealReady ? "bg-amber-500 hover:bg-amber-600" : "bg-gray-400 cursor-not-allowed"}`}
                      >
                        {isActioning ? "Processing..." : (
                          <>
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {mealReady
                              ? "End Meal"
                              : `End Meal (${remainingMins}:${remainingSecs.toString().padStart(2, "0")} remaining)`}
                          </>
                        )}
                      </button>
                      <button
                        onClick={handleClockOutClick}
                        disabled={isActioning}
                        className="w-full py-4 px-4 bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold text-lg transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        Clock Out
                      </button>
                    </>
                    );
                  })()}

                  {/* Cancel / back to code entry */}
                  <button
                    onClick={resetToCodeEntry}
                    className="w-full py-3 px-4 border border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* ── Code entry (Step 1) ── */}
            {!worker && !success && (
              <>
                <div className="text-center mb-8">
                  <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900">Kiosk Check-In</h2>
                  <p className="text-gray-600 mt-2">Enter your code (2 initials + 4 digits)</p>
                </div>

                <div className="flex justify-center gap-3 mb-8" onPaste={handlePaste}>
                  {digits.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => { inputRefs.current[i] = el; }}
                      type="text"
                      inputMode={i < 2 ? "text" : "numeric"}
                      autoCapitalize="characters"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleDigitChange(i, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(i, e)}
                      className={`w-12 h-14 text-center text-2xl font-bold rounded-xl border-2 outline-none transition-all ${
                        digit
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-gray-300 text-gray-900"
                      } focus:border-blue-500 focus:ring-2 focus:ring-blue-200`}
                      autoFocus={i === 0}
                    />
                  ))}
                </div>

                <div className="space-y-3">
                  <button
                    onClick={handleValidate}
                    disabled={!codeComplete || isSubmitting}
                    className="w-full py-3 px-4 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                  >
                    {isSubmitting ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Verifying...
                      </span>
                    ) : (
                      "Verify Code"
                    )}
                  </button>
                  <button
                    onClick={resetToCodeEntry}
                    className="w-full py-3 px-4 border border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all"
                  >
                    Clear
                  </button>
                </div>
              </>
            )}
          </div>

            {/* Event check-in flash (only the current user, briefly after clock-in) */}
            {eventCheckInFlash && (
              <div className="mt-4 bg-white/80 backdrop-blur-sm rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Event Check-Ins</h3>
                    <div className="mt-1 text-sm font-semibold text-gray-900 truncate">
                      {eventCheckInFlash.eventName || "Active Event"}
                    </div>
                  </div>
                  {eventCheckInFlash.eventEndIso && (
                    <div className="text-right">
                      <div className="text-[11px] text-gray-500">Ends</div>
                      <div className="text-xs font-semibold text-gray-700">
                        {toPacificHHMM(eventCheckInFlash.eventEndIso)}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-gray-800 truncate">{eventCheckInFlash.name}</span>
                    <span className="text-gray-500">Checked In</span>
                    {eventCheckInFlash.offline && (
                      <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full">offline</span>
                    )}
                  </div>
                  <span className="text-gray-400 text-xs">{eventCheckInFlash.time}</span>
                </div>
              </div>
            )}

            {/* Offline indicator at the bottom */}
            {!isOnline && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                <p className="text-sm text-amber-800 font-medium">
                  You are offline. Actions will be saved locally and synced when connection is restored.
                </p>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
