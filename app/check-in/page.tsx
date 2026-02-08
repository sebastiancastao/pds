"use client";

import { useEffect, useRef, useState, useCallback, MouseEvent, TouchEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

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

  // Online / offline
  const [isOnline, setIsOnline] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  // Inactivity reset (back to code entry after 30s of no interaction)
  const inactivityRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const INACTIVITY_TIMEOUT = 30_000;

  // Recent activity log (shows last few actions on the kiosk)
  const [recentActions, setRecentActions] = useState<
    Array<{ name: string; action: string; time: string; offline?: boolean }>
  >([]);

  // ─── Auth & session keep-alive ──────────────────────────────────
  useEffect(() => {
    checkAuth();
  }, []);

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

  // ─── Online / offline handling ──────────────────────────────────
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      syncOfflineQueue();
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

  const refreshQueueCount = async () => {
    try {
      const items = await getAllQueued();
      setQueueCount(items.length);
    } catch {}
  };

  const syncOfflineQueue = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const items = await getAllQueued();
      if (items.length === 0) {
        setIsSyncing(false);
        return;
      }

      const token = accessTokenRef.current;
      if (!token) {
        setIsSyncing(false);
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
        }
      }
    } catch (err) {
      console.error("Sync failed:", err);
    } finally {
      setIsSyncing(false);
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
  const showSuccessMessage = (msg: string) => {
    setSuccess(msg);
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    successTimeoutRef.current = setTimeout(() => setSuccess(""), 3000);
  };

  const addRecentAction = (name: string, action: string, offline?: boolean) => {
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setRecentActions((prev) => [{ name, action, time, offline }, ...prev].slice(0, 8));
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
    setTimeout(() => inputRefs.current[0]?.focus(), 100);
  };

  // ─── Code input handlers ───────────────────────────────────────
  const handleDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
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
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length > 0) {
      const newDigits = [...digits];
      for (let i = 0; i < 6; i++) newDigits[i] = pasted[i] || "";
      setDigits(newDigits);
      setError("");
      inputRefs.current[Math.min(pasted.length, 5)]?.focus();
    }
  };

  // ─── Validate code ─────────────────────────────────────────────
  const handleValidate = async () => {
    const code = digits.join("");
    if (code.length !== 6) {
      setError("Please enter all 6 digits");
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
  const performAction = async (action: ActionType, sig?: string) => {
    if (!worker) return;
    setIsActioning(true);
    setError("");

    const actionLabels: Record<ActionType, string> = {
      clock_in: "Checked In",
      clock_out: "Clocked Out",
      meal_start: "Meal Started",
      meal_end: "Meal Ended",
    };

    if (!isOnline) {
      // Queue in IndexedDB
      const queuedItem: QueuedAction = {
        id: generateId(),
        code: worker.code,
        action,
        timestamp: new Date().toISOString(),
        userName: worker.name,
        signature: sig,
      };
      try {
        await addToQueue(queuedItem);
        await refreshQueueCount();
        addRecentAction(worker.name, actionLabels[action], true);
        showSuccessMessage(`${actionLabels[action]} (queued offline)`);
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
          };
          await addToQueue(queuedItem);
          await refreshQueueCount();
          addRecentAction(worker.name, actionLabels[action], true);
          showSuccessMessage(`${actionLabels[action]} (queued offline)`);
          setTimeout(resetToCodeEntry, 1500);
          setIsActioning(false);
          return;
        }
        setError(data.error || "Action failed");
        setIsActioning(false);
        return;
      }

      addRecentAction(worker.name, actionLabels[action]);
      showSuccessMessage(`${worker.name} - ${actionLabels[action]}!`);
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
      };
      try {
        await addToQueue(queuedItem);
        await refreshQueueCount();
        addRecentAction(worker.name, actionLabels[action], true);
        showSuccessMessage(`${actionLabels[action]} (queued offline)`);
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
    performAction("clock_out", signature);
    setShowAttestation(false);
    setSignature("");
  };
  const handleCancelAttestation = () => {
    setShowAttestation(false);
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

  const codeComplete = digits.every((d) => d !== "");

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
              <p className="text-gray-600 mt-2">Please sign below to confirm your clock out</p>
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
                <li>I have accurately reported all hours worked</li>
                <li>I have taken all required meal and rest breaks</li>
                <li>I am clocking out at the correct time</li>
              </ul>
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
                      Since {new Date(worker.clockedInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
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
                  <p className="text-gray-600 mt-2">Enter your 6-digit code</p>
                </div>

                <div className="flex justify-center gap-3 mb-8" onPaste={handlePaste}>
                  {digits.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => { inputRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
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

          {/* ── Recent activity log ── */}
          {recentActions.length > 0 && (
            <div className="mt-4 bg-white/80 backdrop-blur-sm rounded-xl border border-gray-200 p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Recent Activity</h3>
              <div className="space-y-2">
                {recentActions.map((entry, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-800">{entry.name}</span>
                      <span className="text-gray-500">{entry.action}</span>
                      {entry.offline && (
                        <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full">offline</span>
                      )}
                    </div>
                    <span className="text-gray-400 text-xs">{entry.time}</span>
                  </div>
                ))}
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
