"use client";

import { useEffect, useRef, useState, useCallback, MouseEvent, TouchEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { isValidCheckinCode, normalizeCheckinCode } from "@/lib/checkin-code";

// ─── Types ───────────────────────────────────────────────────────────
type WorkerStatus = "not_clocked_in" | "clocked_in" | "on_meal";
type ActionType = "clock_in" | "clock_out" | "meal_start" | "meal_end";

type QueuedAction = {
  id: string;
  code: string;
  action: ActionType;
  timestamp: string;
  userName: string;
  signature?: string;
  attestationAccepted?: boolean;
  eventId?: string;
};





type ValidatedWorker = {
  name: string;
  workerId: string;
  codeId: string;
  status: WorkerStatus;
  clockedInAt: string | null;
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
    tx.objectStore(STORE_NAME).add(item);
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
  const [attestationSummary, setAttestationSummary] = useState<{ clockInAt: string; mealMs: number } | null>(null);
  const [attestationSummaryLoading, setAttestationSummaryLoading] = useState(false);
  const [attestationNowMs, setAttestationNowMs] = useState<number>(() => Date.now());

  // Online / offline
  const [isOnline, setIsOnline] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const isSyncingRef = useRef(false);

  // Inactivity reset (back to code entry after 30s of no interaction)
  const inactivityRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const INACTIVITY_TIMEOUT = 30_000;

  const [activeEvent, setActiveEvent] = useState<{ id: string; name: string | null; startIso: string; endIso: string } | null>(
    null
  );

  // Briefly show the current user's event check-in after they clock in.
  const [eventCheckInFlash, setEventCheckInFlash] = useState<{
    name: string;
    time: string;
    offline?: boolean;
    eventName: string | null;
    eventEndIso?: string;
  } | null>(null);
  const eventCheckInFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Auth & session keep-alive ──────────────────────────────────
  useEffect(() => {
    checkAuth();
  }, []);

  // Attestation clock (for the displayed "Clock out time")
  useEffect(() => {
    if (!showAttestation || !worker) return;
    setAttestationNowMs(Date.now());
    const t = setInterval(() => setAttestationNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [showAttestation, worker]);

  // Load shift summary when attestation opens (meal time, etc.)
  useEffect(() => {
    if (!showAttestation || !worker) return;
    if (!isOnline) {
      setAttestationSummary(null);
      setAttestationSummaryLoading(false);
      return;
    }

    const run = async () => {
      try {
        setAttestationSummaryLoading(true);
        const token = accessTokenRef.current;
        if (!token) return;
        const res = await fetch(`/api/check-in/shift-summary?workerId=${encodeURIComponent(worker.workerId)}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        if (data?.active && typeof data?.clockInAt === "string" && typeof data?.mealMs === "number") {
          setAttestationSummary({ clockInAt: data.clockInAt, mealMs: data.mealMs });
        } else {
          setAttestationSummary(null);
        }
      } catch (e) {
        console.error("Failed to load shift summary:", e);
      } finally {
        setAttestationSummaryLoading(false);
      }
    };

    run();
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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    const mfaVerified = sessionStorage.getItem("mfa_verified");
    if (!mfaVerified) {
      router.push("/verify-mfa");
      return;
    }
    const { data } = await supabase.auth.getSession();
    accessTokenRef.current = data.session?.access_token || null;
    setIsAuthed(true);
    setLoading(false);
  };

  const fetchRecentActivity = useCallback(async () => {
    try {
      if (!isAuthed) return;
      if (!isOnline) return;
      const token = accessTokenRef.current;
      if (!token) return;

      const qs = eventIdFromUrl ? `?eventId=${encodeURIComponent(eventIdFromUrl)}` : "";
      const res = await fetch(`/api/check-in/recent${qs}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;

      const event = data?.event;
      if (event?.id && event?.startIso && event?.endIso) {
        setActiveEvent({
          id: String(event.id),
          name: typeof event.name === "string" ? event.name : null,
          startIso: String(event.startIso),
          endIso: String(event.endIso),
        });
      } else {
        setActiveEvent(null);
      }

    } catch (err) {
      console.error("Failed to fetch kiosk event status:", err);
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
    const interval = setInterval(fetchRecentActivity, 30_000);
    return () => clearInterval(interval);
  }, [fetchRecentActivity, isAuthed, isOnline]);

  // Kiosk heartbeat — lets the admin monitor know this kiosk page is open.
  useEffect(() => {
    if (!isAuthed || !isOnline) return;
    const sendHeartbeat = async () => {
      try {
        const token = accessTokenRef.current;
        if (!token) return;
        await fetch("/api/admin/check-in-monitor", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ eventId: eventIdFromUrl || activeEvent?.id || null }),
        });
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

      const res = await fetch("/api/check-in/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ actions: items }),
      });

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
      console.error("Sync failed:", err);
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

  // ─── Helpers ───────────────────────────────────────────────────
  const toPacificHHMM = (input: string | number | Date | null | undefined): string => {
    if (!input) return "--";
    const d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return "--";
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Los_Angeles",
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

      const res = await fetch("/api/check-in/validate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code }),
      });

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
        code,
      });
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Perform action (online or queue offline) ──────────────────
  const performAction = async (
    action: ActionType,
    sig?: string,
    options?: { attestationAccepted?: boolean }
  ) => {
    if (!worker) return;
    setIsActioning(true);
    setError("");
    const attestationAccepted = options?.attestationAccepted;
    const actionLabel =
      action === "clock_out" && attestationAccepted === false
        ? "Clocked Out (attestation rejected)"
        : ({
            clock_in: "Checked In",
            clock_out: "Clocked Out",
            meal_start: "Meal Started",
            meal_end: "Meal Ended",
          } as Record<ActionType, string>)[action];

      if (!isOnline) {
        // Queue in IndexedDB
        const queuedItem: QueuedAction = {
          id: generateId(),
          code: worker.code,
        action,
        timestamp: new Date().toISOString(),
        userName: worker.name,
        signature: sig,
        attestationAccepted,
        eventId: activeEvent?.id || (eventIdFromUrl || undefined),
      };
        try {
          await addToQueue(queuedItem);
          await refreshQueueCount();
          if (action === "clock_in") showEventCheckInFlashMessage(worker.name, true);
          showSuccessMessage(`${actionLabel} (queued offline)`);
          setTimeout(resetToCodeEntry, 1500);
        } catch (err) {
          setError("Failed to save offline. Please try again.");
        }
      setIsActioning(false);
      return;
    }

    try {
      const token = accessTokenRef.current;
      if (!token) {
        setError("Session expired. Please refresh.");
        setIsActioning(false);
        return;
      }

      const res = await fetch("/api/check-in/action", {
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
          eventId: activeEvent?.id || (eventIdFromUrl || undefined),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        // If network went down mid-request, queue instead
        if (!navigator.onLine) {
          const queuedItem: QueuedAction = {
            id: generateId(),
            code: worker.code,
            action,
            timestamp: new Date().toISOString(),
            userName: worker.name,
            signature: sig,
            attestationAccepted,
            eventId: activeEvent?.id || (eventIdFromUrl || undefined),
            };
            await addToQueue(queuedItem);
            await refreshQueueCount();
            if (action === "clock_in") showEventCheckInFlashMessage(worker.name, true);
            showSuccessMessage(`${actionLabel} (queued offline)`);
            setTimeout(resetToCodeEntry, 1500);
            setIsActioning(false);
            return;
          }
        setError(data.error || "Action failed");
        setIsActioning(false);
          return;
        }

        if (action === "clock_in") showEventCheckInFlashMessage(worker.name);
        showSuccessMessage(`${worker.name} - ${actionLabel}!`);
        fetchRecentActivity();
        setTimeout(resetToCodeEntry, 1500);
      } catch {
      // Network error - queue offline
      const queuedItem: QueuedAction = {
        id: generateId(),
        code: worker.code,
        action,
        timestamp: new Date().toISOString(),
        userName: worker.name,
        signature: sig,
        attestationAccepted,
        eventId: activeEvent?.id || (eventIdFromUrl || undefined),
      };
        try {
          await addToQueue(queuedItem);
          await refreshQueueCount();
          if (action === "clock_in") showEventCheckInFlashMessage(worker.name, true);
          showSuccessMessage(`${actionLabel} (queued offline)`);
          setTimeout(resetToCodeEntry, 1500);
        } catch {
          setError("Failed to save. Please try again.");
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
    performAction("clock_out", undefined, { attestationAccepted: false });
    setShowAttestation(false);
    setAttestationSummary(null);
    setAttestationSummaryLoading(false);
    setSignature("");
  };
  const handleCancelAttestation = () => {
    setShowAttestation(false);
    setAttestationSummary(null);
    setAttestationSummaryLoading(false);
    setSignature("");
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
                <li>I certify that all of my hours recorded for the workday are complete and accurate. I also certify that all work time is reflected in my time records and I did not perform any work off-the-clock.</li>
                <li>I certify that I was provided with all meal periods and rest breaks during this workday.</li>
                <li>I understand that if any of the above statements are incorrect, I must inform my supervisor or Human Resources immediately.</li>
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
                  <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Total Time</div>
                  <div className="mt-1 font-semibold text-gray-900">
                    {(() => {
                      const startMs = worker.clockedInAt ? Date.parse(worker.clockedInAt) : NaN;
                      if (Number.isNaN(startMs)) return "--";
                      if (!attestationSummary) return "--";
                      const netMs = Math.max(0, attestationNowMs - startMs - attestationSummary.mealMs);
                      return formatDuration(netMs);
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
                  {worker.clockedInAt && worker.status !== "not_clocked_in" && (
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
                  {worker.status === "on_meal" && (
                    <>
                      <button
                        onClick={handleMealEnd}
                        disabled={isActioning}
                        className="w-full py-4 px-4 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold text-lg transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {isActioning ? "Processing..." : (
                          <>
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            End Meal
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
