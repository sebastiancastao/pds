"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

const ADMIN_RESPONSE_ENTRY_PROCESSING_MS = 30 * 60 * 1000;
const REJECTION_REASONS = [
  "I was provided an opportunity to take a 30-minute duty-free meal break before the end of my 5th hour of work but chose not to;",
  "I was provided an opportunity to take a 30-minute duty-free meal break before the end of my 5th hour of work but chose to take a shorter break;",
  "I was provided an opportunity to take a 30-minute duty-free meal break before the end of my 5th hour of work but chose to take a later break;",
  "I was not provided an opportunity to take a 30-minute duty-free meal break before the end of my 5th hour of work.",
  "Other",
];

type TimeForm = {
  firstIn: string;
  firstMealStart: string;
  lastMealEnd: string;
  secondMealStart: string;
  secondMealEnd: string;
  lastOut: string;
};

type TimesheetSnapshot = {
  firstIn: string | null;
  lastOut: string | null;
  firstMealStart: string | null;
  lastMealEnd: string | null;
  secondMealStart: string | null;
  secondMealEnd: string | null;
  firstInDisplay: string;
  lastOutDisplay: string;
  firstMealStartDisplay: string;
  lastMealEndDisplay: string;
  secondMealStartDisplay: string;
  secondMealEndDisplay: string;
  mealMs: number;
  totalMs: number;
  totalMsWithAdminResponse: number;
  attestationStatus: "submitted" | "rejected" | "not_submitted";
  attestationSignedAt: string | null;
  rejectionReason: string | null;
};

type TeamMemberOption = {
  id: string;
  name: string;
  role: string;
};

type TimesheetEditRequestSummary = {
  id: string;
  status: string;
  requestReason: string;
  createdAt: string;
};

type LoadedPayload = {
  event: {
    id: string;
    name: string | null;
    date: string;
    endDate?: string | null;
    startTime: string | null;
    endTime: string | null;
    endsNextDay?: boolean;
    venue: string | null;
    city: string | null;
    state: string | null;
    type: string;
    timezone: string;
  };
  selectedDate?: string;
  user: {
    id: string;
    name: string;
    role: string;
  };
  requester?: {
    id: string;
    name: string;
    role: string;
  };
  timesheet: TimesheetSnapshot;
  teamMembers?: TeamMemberOption[];
  editRequest?: TimesheetEditRequestSummary | null;
};

type PreviewResult = {
  isComplete: boolean;
  error: string | null;
  mealMs: number;
  totalMs: number;
  totalMsWithAdminResponse: number;
  overnight: boolean;
};

const EMPTY_FORM: TimeForm = {
  firstIn: "",
  firstMealStart: "",
  lastMealEnd: "",
  secondMealStart: "",
  secondMealEnd: "",
  lastOut: "",
};

function parseTimeToMinutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatDuration(ms: number) {
  const safeMs = Math.max(0, Math.round(ms));
  const totalMinutes = Math.floor(safeMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatEventDate(value?: string | null) {
  if (!value) return "Date TBD";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function buildDateList(start: string, end: string) {
  const dates: string[] = [];
  let current = start;
  // Bounded loop: event date ranges are capped at a week
  for (let i = 0; i < 31 && current && current <= end; i++) {
    dates.push(current);
    const date = new Date(`${current}T00:00:00`);
    date.setDate(date.getDate() + 1);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    current = `${date.getFullYear()}-${month}-${day}`;
  }
  return dates;
}

function formatClockValue(value?: string | null) {
  const raw = String(value || "").trim();
  const normalized = raw.length >= 5 ? raw.slice(0, 5) : raw;
  if (!normalized) return "--:--";
  const [hours, minutes] = normalized.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return normalized;
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function canManageOtherTimesheets(role?: string | null) {
  const normalized = String(role || "").trim().toLowerCase();
  return (
    normalized === "admin" ||
    normalized === "hr" ||
    normalized === "manager" ||
    normalized === "supervisor" ||
    normalized === "supervisor2" ||
    normalized === "supervisor3" ||
    normalized === "exec"
  );
}

function subtractMinutes(timeHHMM: string, mins: number): string {
  const [h, m] = timeHHMM.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return timeHHMM;
  const total = h * 60 + m - mins;
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hh = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const mm = String(wrapped % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function eventAllowsOvernight(startTime?: string | null, endTime?: string | null, endsNextDay?: boolean) {
  if (endsNextDay) return true;
  const startMinutes = parseTimeToMinutes(String(startTime || "").trim().slice(0, 5));
  const endMinutes = parseTimeToMinutes(String(endTime || "").trim().slice(0, 5));
  return startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes;
}

function computePreview(
  form: TimeForm,
  strict: boolean,
  allowOvernight: boolean,
  eventStartTime?: string | null,
  eventEndTime?: string | null
): PreviewResult {
  const meal1HasAnyValue = Boolean(form.firstMealStart || form.lastMealEnd);
  const meal2HasAnyValue = Boolean(form.secondMealStart || form.secondMealEnd);

  if (meal1HasAnyValue && !(form.firstMealStart && form.lastMealEnd)) {
    return {
      isComplete: false,
      error: "Meal 1 requires both start and end times.",
      mealMs: 0,
      totalMs: 0,
      totalMsWithAdminResponse: 0,
      overnight: false,
    };
  }

  if (meal2HasAnyValue && !(form.secondMealStart && form.secondMealEnd)) {
    return {
      isComplete: false,
      error: "Meal 2 requires both start and end times.",
      mealMs: 0,
      totalMs: 0,
      totalMsWithAdminResponse: 0,
      overnight: false,
    };
  }

  if (!form.firstIn || !form.lastOut) {
    return {
      isComplete: false,
      error: strict ? "Clock in and clock out times are required." : null,
      mealMs: 0,
      totalMs: 0,
      totalMsWithAdminResponse: 0,
      overnight: false,
    };
  }

  const orderedValues = [
    { label: "Clock In", value: form.firstIn },
    ...(form.firstMealStart && form.lastMealEnd
      ? [
          { label: "Meal 1 Start", value: form.firstMealStart },
          { label: "Meal 1 End", value: form.lastMealEnd },
        ]
      : []),
    ...(form.secondMealStart && form.secondMealEnd
      ? [
          { label: "Meal 2 Start", value: form.secondMealStart },
          { label: "Meal 2 End", value: form.secondMealEnd },
        ]
      : []),
    { label: "Clock Out", value: form.lastOut },
  ];

  let previousAbsoluteMinutes: number | null = null;
  let overnight = false;
  const resolvedMinutes: number[] = [];

  for (const item of orderedValues) {
    const baseMinutes = parseTimeToMinutes(item.value);
    if (baseMinutes === null) {
      return {
        isComplete: false,
        error: `${item.label} is invalid.`,
        mealMs: 0,
        totalMs: 0,
        totalMsWithAdminResponse: 0,
        overnight: false,
      };
    }

    let absoluteMinutes = baseMinutes;
    while (previousAbsoluteMinutes !== null && absoluteMinutes <= previousAbsoluteMinutes) {
      if (!allowOvernight) {
        return {
          isComplete: false,
          error: `${item.label} must be later than the previous time for a same-day shift.`,
          mealMs: 0,
          totalMs: 0,
          totalMsWithAdminResponse: 0,
          overnight: false,
        };
      }
      absoluteMinutes += 24 * 60;
      overnight = true;
    }

    resolvedMinutes.push(absoluteMinutes);
    previousAbsoluteMinutes = absoluteMinutes;
  }

  if (eventStartTime) {
    const eventStartMin = parseTimeToMinutes(String(eventStartTime).trim().slice(0, 5));
    if (eventStartMin !== null && resolvedMinutes[0] < eventStartMin) {
      return {
        isComplete: false,
        error: "Clock in time cannot be before the event start time.",
        mealMs: 0,
        totalMs: 0,
        totalMsWithAdminResponse: 0,
        overnight,
      };
    }
  }

  const totalWindowMinutes = resolvedMinutes[resolvedMinutes.length - 1] - resolvedMinutes[0];
  if (totalWindowMinutes <= 0) {
    return {
      isComplete: false,
      error: "Clock out must be later than clock in.",
      mealMs: 0,
      totalMs: 0,
      totalMsWithAdminResponse: 0,
      overnight,
    };
  }

  let mealMinutes = 0;
  if (form.firstMealStart && form.lastMealEnd) {
    mealMinutes += Math.max(0, resolvedMinutes[2] - resolvedMinutes[1]);
  }

  if (form.secondMealStart && form.secondMealEnd) {
    const meal2StartIndex = form.firstMealStart && form.lastMealEnd ? 3 : 1;
    const meal2EndIndex = meal2StartIndex + 1;
    mealMinutes += Math.max(0, resolvedMinutes[meal2EndIndex] - resolvedMinutes[meal2StartIndex]);
  }

  const totalMs = Math.max(0, (totalWindowMinutes - mealMinutes) * 60 * 1000);
  return {
    isComplete: true,
    error: null,
    mealMs: mealMinutes * 60 * 1000,
    totalMs,
    totalMsWithAdminResponse: totalMs + ADMIN_RESPONSE_ENTRY_PROCESSING_MS,
    overnight,
  };
}

function getCanvasCoordinates(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function signatureStatusClass(status: TimesheetSnapshot["attestationStatus"]) {
  if (status === "submitted") return "bg-green-100 text-green-800 border-green-200";
  if (status === "rejected") return "bg-red-100 text-red-800 border-red-200";
  return "bg-gray-100 text-gray-700 border-gray-200";
}

export default function TimeSheetsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const eventIdParam = params?.id;
  const eventId = Array.isArray(eventIdParam) ? eventIdParam[0] : String(eventIdParam || "");
  const requestedUserId = searchParams.get("userId")?.trim() || "";

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState<LoadedPayload | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [form, setForm] = useState<TimeForm>(EMPTY_FORM);
  const [mode, setMode] = useState<"form" | "attestation" | "reject" | "complete">("form");
  const [submittedTimesheet, setSubmittedTimesheet] = useState<TimesheetSnapshot | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectionNote, setRejectionNote] = useState("");
  const [signatureIsEmpty, setSignatureIsEmpty] = useState(true);
  const [rejectionSignatureIsEmpty, setRejectionSignatureIsEmpty] = useState(true);

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rejectionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingSignatureRef = useRef(false);
  const isDrawingRejectionRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMultiDay = Boolean(
    payload?.event.date && payload?.event.endDate && payload.event.endDate > payload.event.date
  );
  const dayOptions = useMemo(
    () =>
      payload?.event.date && payload?.event.endDate && payload.event.endDate > payload.event.date
        ? buildDateList(payload.event.date, payload.event.endDate)
        : [],
    [payload?.event.date, payload?.event.endDate]
  );
  // Attestation is signed on the last day of a multi-day event; earlier days are draft-saved only
  const isLastDay = !isMultiDay || !payload?.event.endDate || selectedDate === payload.event.endDate;
  // Multi-day events keep each day isolated, so times cannot wrap past midnight
  const allowOvernight = useMemo(
    () =>
      isMultiDay
        ? false
        : eventAllowsOvernight(payload?.event.startTime, payload?.event.endTime, payload?.event.endsNextDay),
    [isMultiDay, payload?.event.endTime, payload?.event.endsNextDay, payload?.event.startTime]
  );
  const preview = useMemo(
    () => computePreview(form, false, allowOvernight, payload?.event.startTime, payload?.event.endTime),
    [allowOvernight, form, payload?.event.startTime, payload?.event.endTime]
  );

  const loadPage = useCallback(async (dateOverride?: string) => {
    if (!eventId) {
      setError("Event ID is missing.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        window.location.href = "/login";
        return;
      }

      const queryParams = new URLSearchParams();
      if (requestedUserId) queryParams.set("userId", requestedUserId);
      if (dateOverride) queryParams.set("date", dateOverride);
      const queryString = queryParams.toString();
      const res = await fetch(`/api/events/${eventId}/self-timesheet${queryString ? `?${queryString}` : ""}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to load time sheet.");
      }

      const loaded = data as LoadedPayload;
      setPayload(loaded);
      setSelectedDate(loaded.selectedDate || loaded.event.date || "");
      setForm({
        firstIn: loaded.timesheet.firstInDisplay || "",
        firstMealStart: loaded.timesheet.firstMealStartDisplay || "",
        lastMealEnd: loaded.timesheet.lastMealEndDisplay || "",
        secondMealStart: loaded.timesheet.secondMealStartDisplay || "",
        secondMealEnd: loaded.timesheet.secondMealEndDisplay || "",
        lastOut: loaded.timesheet.lastOutDisplay || "",
      });

      if (
        loaded.timesheet.attestationStatus !== "not_submitted" &&
        loaded.editRequest?.status !== "approved"
      ) {
        setSubmittedTimesheet(loaded.timesheet);
        setMode("complete");
      } else {
        setSubmittedTimesheet(null);
        setMode("form");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load time sheet.");
    } finally {
      setLoading(false);
    }
  }, [eventId, requestedUserId]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const handleDayChange = (value: string) => {
    if (!value || value === selectedDate) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    setError("");
    void loadPage(value);
  };

  const handleManualSave = () => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    if (!form.firstIn || !form.lastOut) {
      setError("Enter clock in and clock out times before saving.");
      return;
    }
    setError("");
    void draftSave(form);
  };

  const draftSave = useCallback(async (currentForm: TimeForm) => {
    if (!eventId || !currentForm.firstIn || !currentForm.lastOut) return;
    setSaveStatus("saving");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`/api/events/${eventId}/self-timesheet`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          spans: {
            firstIn: currentForm.firstIn,
            lastOut: currentForm.lastOut,
            firstMealStart: currentForm.firstMealStart,
            lastMealEnd: currentForm.lastMealEnd,
            secondMealStart: currentForm.secondMealStart,
            secondMealEnd: currentForm.secondMealEnd,
          },
          date: selectedDate || undefined,
          targetUserId: requestedUserId || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } else if (data.skipped) {
        setSaveStatus("idle");
      } else {
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 3000);
      }
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }, [eventId, requestedUserId, selectedDate]);

  const scheduleAutoSave = useCallback((currentForm: TimeForm) => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      void draftSave(currentForm);
    }, 800);
  }, [draftSave]);

  const clearCanvas = useCallback(
    (
      canvasRef: MutableRefObject<HTMLCanvasElement | null>,
      setIsEmpty: (value: boolean) => void
    ) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d");
      context?.clearRect(0, 0, canvas.width, canvas.height);
      setIsEmpty(true);
    },
    []
  );

  const beginStroke = useCallback(
    (
      canvasRef: MutableRefObject<HTMLCanvasElement | null>,
      drawingRef: MutableRefObject<boolean>,
      setIsEmpty: (value: boolean) => void,
      clientX: number,
      clientY: number
    ) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      drawingRef.current = true;
      const { x, y } = getCanvasCoordinates(canvas, clientX, clientY);
      context.beginPath();
      context.moveTo(x, y);
      context.lineWidth = 2;
      context.lineCap = "round";
      context.strokeStyle = "#1e3a5f";
      setIsEmpty(false);
    },
    []
  );

  const continueStroke = useCallback(
    (
      canvasRef: MutableRefObject<HTMLCanvasElement | null>,
      drawingRef: MutableRefObject<boolean>,
      setIsEmpty: (value: boolean) => void,
      clientX: number,
      clientY: number
    ) => {
      if (!drawingRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      const { x, y } = getCanvasCoordinates(canvas, clientX, clientY);
      context.lineTo(x, y);
      context.stroke();
      setIsEmpty(false);
    },
    []
  );

  const endStroke = useCallback((drawingRef: MutableRefObject<boolean>) => {
    drawingRef.current = false;
  }, []);

  const goToAttestation = () => {
    const strictPreview = computePreview(form, true, allowOvernight, payload?.event.startTime, payload?.event.endTime);
    if (strictPreview.error) {
      setError(strictPreview.error);
      return;
    }
    setError("");
    clearCanvas(signatureCanvasRef, setSignatureIsEmpty);
    clearCanvas(rejectionCanvasRef, setRejectionSignatureIsEmpty);
    setRejectionReason("");
    setRejectionNote("");
    setMode("attestation");
  };

  const submitTimesheet = async (attestationAccepted: boolean) => {
    if (!payload) return;

    const strictPreview = computePreview(form, true, allowOvernight, payload?.event.startTime, payload?.event.endTime);
    if (strictPreview.error) {
      setError(strictPreview.error);
      return;
    }

    const canvasRef = attestationAccepted ? signatureCanvasRef : rejectionCanvasRef;
    const isEmpty = attestationAccepted ? signatureIsEmpty : rejectionSignatureIsEmpty;
    if (isEmpty) {
      setError("Please draw your signature before continuing.");
      return;
    }

    const resolvedRejectionReason =
      attestationAccepted
        ? ""
        : rejectionReason === "Other"
          ? `Other: ${rejectionNote.trim()}`
          : rejectionReason;

    if (!attestationAccepted) {
      if (!rejectionReason) {
        setError("Please select a reason for rejection.");
        return;
      }
      if (rejectionReason === "Other" && !rejectionNote.trim()) {
        setError("Please explain the rejection reason.");
        return;
      }
    }

    const signature = canvasRef.current?.toDataURL("image/png") || "";
    if (!signature) {
      setError("Failed to capture the signature.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        window.location.href = "/login";
        return;
      }

      const res = await fetch(`/api/events/${eventId}/self-timesheet`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          spans: form,
          signature,
          attestationAccepted,
          rejectionReason: resolvedRejectionReason,
          date: selectedDate || undefined,
          targetUserId: requestedUserId || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to submit time sheet.");
      }

      const nextTimesheet = data?.timesheet as TimesheetSnapshot;
      if (nextTimesheet) {
        setSubmittedTimesheet(nextTimesheet);
        setPayload((prev) => (prev ? { ...prev, timesheet: nextTimesheet, editRequest: null } : prev));
      }
      setMode("complete");
    } catch (err: any) {
      setError(err?.message || "Failed to submit time sheet.");
    } finally {
      setSubmitting(false);
    }
  };

  const timesheetForSummary = submittedTimesheet || payload?.timesheet || null;
  const requesterCanProxy = canManageOtherTimesheets(payload?.requester?.role);
  const isEventDay = (() => {
    if (!payload?.event?.date || !payload?.event?.timezone) return true;
    try {
      const now = new Date();
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: payload.event.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(now);
      const y = parts.find((p) => p.type === "year")?.value ?? "";
      const m = parts.find((p) => p.type === "month")?.value ?? "";
      const d = parts.find((p) => p.type === "day")?.value ?? "";
      const today = `${y}-${m}-${d}`;
      const lastDay =
        payload.event.endDate && payload.event.endDate > payload.event.date
          ? payload.event.endDate
          : payload.event.date;
      return today >= payload.event.date && today <= lastDay;
    } catch {
      return true;
    }
  })();
  const isProxyView = Boolean(
    payload?.user?.id &&
      payload?.requester?.id &&
      payload.user.id !== payload.requester.id
  );
  const profileLink = payload
    ? `/employees/${isProxyView ? payload.user.id : payload.requester?.id || payload.user.id}`
    : "/dashboard";
  const topRightLink = payload
    ? isProxyView
      ? profileLink
      : requesterCanProxy
        ? `/event-dashboard/${payload.event.id}`
        : profileLink
    : "/dashboard";

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-3xl border border-slate-200 bg-white p-10 shadow-sm">
            <div className="flex items-center gap-3 text-slate-600">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
              Loading time sheet...
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 p-6 text-white shadow-xl">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-100">
                Time Sheets
              </div>
              <h1 className="text-3xl font-bold tracking-tight">
                {payload?.event.name || "Special Event Time Sheet"}
              </h1>
              <div className="space-y-1 text-sm text-slate-200">
                <p>
                  {payload
                    ? isMultiDay
                      ? `${formatEventDate(payload.event.date)} - ${formatEventDate(payload.event.endDate)}`
                      : formatEventDate(payload.event.date)
                    : "Event date unavailable"}
                </p>
                <p>
                  {payload
                    ? `${formatClockValue(payload.event.startTime)} - ${formatClockValue(payload.event.endTime)}`
                    : "Schedule unavailable"}
                </p>
                {payload && (
                  <p>
                    {payload.event.venue || "Venue TBD"}
                    {payload.event.city || payload.event.state
                      ? `, ${[payload.event.city, payload.event.state].filter(Boolean).join(", ")}`
                      : ""}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={topRightLink}
                className="inline-flex items-center rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/15"
              >
                Back
              </Link>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {isMultiDay && payload && (
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">Day you are entering time for</div>
                <p className="mt-0.5 text-xs text-slate-500">
                  This event runs from {formatEventDate(payload.event.date)} to {formatEventDate(payload.event.endDate)}.
                  Each day has its own time sheet.
                </p>
              </div>
              <select
                value={selectedDate}
                onChange={(event) => handleDayChange(event.target.value)}
                disabled={loading || submitting}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {dayOptions.map((day) => (
                  <option key={day} value={day}>
                    {formatEventDate(day)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {mode === "complete" && payload && timesheetForSummary && (
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Attestation Recorded</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {isMultiDay
                      ? `This time sheet has already been submitted for ${formatEventDate(selectedDate)}. Select another day above to enter more time.`
                      : "This time sheet has already been submitted for this event."}
                  </p>
                </div>
                <div
                  className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${signatureStatusClass(
                    timesheetForSummary.attestationStatus
                  )}`}
                >
                  {timesheetForSummary.attestationStatus === "submitted"
                    ? "Attestation Submitted"
                    : timesheetForSummary.attestationStatus === "rejected"
                      ? "Attestation Rejected"
                      : "Not Submitted"}
                </div>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Clock In</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {formatClockValue(timesheetForSummary.firstInDisplay)}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Clock Out</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {formatClockValue(timesheetForSummary.lastOutDisplay)}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Meal Time</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {formatDuration(timesheetForSummary.mealMs)}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Admin Response / Entry Processing
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {formatDuration(ADMIN_RESPONSE_ENTRY_PROCESSING_MS)}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Time</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {formatDuration(timesheetForSummary.totalMsWithAdminResponse)}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Signed At</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {timesheetForSummary.attestationSignedAt
                      ? new Date(timesheetForSummary.attestationSignedAt).toLocaleString()
                      : "Recorded"}
                  </div>
                </div>
              </div>

              {timesheetForSummary.rejectionReason && (
                <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-800">
                  <div className="font-semibold uppercase tracking-wide text-red-700">Rejection Reason</div>
                  <p className="mt-2">{timesheetForSummary.rejectionReason}</p>
                </div>
              )}
            </div>

            <div className="space-y-6">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900">Event Details</h3>
                <dl className="mt-4 space-y-3 text-sm text-slate-700">
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500">Event</dt>
                    <dd className="text-right font-medium text-slate-900">{payload.event.name || "Unnamed Event"}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500">Date</dt>
                    <dd className="text-right font-medium text-slate-900">{formatEventDate(selectedDate || payload.event.date)}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500">Venue</dt>
                    <dd className="text-right font-medium text-slate-900">
                      {payload.event.venue || "Venue TBD"}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500">Timezone</dt>
                    <dd className="text-right font-medium text-slate-900">{payload.event.timezone}</dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900">Need a Correction?</h3>
                {payload.editRequest ? (
                  <>
                    <div
                      className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                        payload.editRequest.status === "rejected"
                          ? "border-red-200 bg-red-50 text-red-700"
                          : payload.editRequest.status === "approved"
                            ? "border-blue-200 bg-blue-50 text-blue-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                      }`}
                    >
                      {payload.editRequest.status === "in_review"
                        ? "Edit Request In Review"
                        : payload.editRequest.status === "approved"
                          ? "Edit Request Approved"
                          : payload.editRequest.status === "rejected"
                            ? "Edit Request Rejected"
                            : "Edit Request Submitted"}
                    </div>
                    <p className="mt-3 text-sm text-slate-600">
                      {payload.editRequest.status === "rejected"
                        ? "The most recent correction request was reviewed on "
                        : "A correction request was sent on "}
                      {payload.editRequest.createdAt
                        ? new Date(payload.editRequest.createdAt).toLocaleString()
                        : "this timesheet"}.
                    </p>
                    {payload.editRequest.requestReason && (
                      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                        {payload.editRequest.requestReason}
                      </div>
                    )}
                    {payload.editRequest.status === "rejected" && (
                      <p className="mt-4 text-sm text-slate-600">
                        Contact a manager or exec if this timesheet still needs to be reopened.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-2 text-sm text-slate-600">
                    This timesheet is attested and locked. Contact a manager or exec if it needs to be reviewed and reopened.
                  </p>
                )}
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900">Next Step</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Your time and attestation are stored. If something needs to change, a manager or exec can update the event timesheet.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Link
                    href={topRightLink}
                    className="inline-flex items-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    {isProxyView ? "Back to Employee" : requesterCanProxy ? "Back to Event" : "Back to Profile"}
                  </Link>
                  {requesterCanProxy && !isProxyView && (
                    <Link
                      href={`/event-dashboard/${payload.event.id}`}
                      className="inline-flex items-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      Open Event
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {mode !== "complete" && payload && (
          <div className="grid gap-6 lg:grid-cols-[1.12fr_0.88fr]">
            <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
              {mode === "form" && (
                <>
                  {!isEventDay && !requesterCanProxy ? (
                    <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
                        <svg className="h-7 w-7 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-slate-900">Time Sheet Unavailable</h2>
                        <p className="mt-2 text-sm text-slate-600">
                          {isMultiDay ? (
                            <>
                              This time sheet can only be filled out during the event:{" "}
                              <span className="font-semibold">
                                {formatEventDate(payload.event.date)} - {formatEventDate(payload.event.endDate)}
                              </span>.
                            </>
                          ) : (
                            <>
                              This time sheet can only be filled out on the event date:{" "}
                              <span className="font-semibold">{formatEventDate(payload.event.date)}</span>.
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                  ) : (
                  <>
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">
                        {isProxyView && payload?.user.name
                          ? `Enter Time for ${payload.user.name}`
                          : "Enter Your Time"}
                      </h2>
                      <p className="mt-1 text-sm text-slate-600">
                        Enter the workday exactly as worked. Meal fields are mandatory, and each meal requires a start and end time.
                      </p>
                      <p className="mt-2 text-sm text-slate-500">
                        This page only records time for {formatEventDate(selectedDate || payload.event.date)}
                        {allowOvernight ? " and the event's overnight continuation." : "."}
                      </p>
                    </div>
                    <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {isLastDay ? "Step 1 of 2" : "Daily Time Entry"}
                    </div>
                  </div>

                  {payload.editRequest?.status === "approved" && (
                    <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                      Edit permission approved. Update the timesheet and submit a new attestation to complete the correction.
                    </div>
                  )}

                  <div className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-4 text-sm text-sky-900">
                    <h3 className="font-semibold">Break And Meal Rules</h3>
                    <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sky-800">
                      <li>A 10-minute break is required around the 3rd hour and should be taken without clocking out and back in.</li>
                      <li>A 30-minute lunch break is required around the 4th hour and must be clocked out and back in.</li>
                      <li>A second 10-minute break is required around the 6th hour.</li>
                      <li>A second meal break is required if you work past 10 hours and must be clocked out and back in.</li>
                    </ul>
                  </div>

                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-slate-700">Clock In</span>
                      <input
                        type="time"
                        value={form.firstIn}
                        onChange={(event) => {
                          const next = { ...form, firstIn: event.target.value };
                          setForm(next);
                          scheduleAutoSave(next);
                        }}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-slate-700">Clock Out</span>
                      <input
                        type="time"
                        value={form.lastOut}
                        onChange={(event) => {
                          const next = { ...form, lastOut: event.target.value };
                          setForm(next);
                          scheduleAutoSave(next);
                        }}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-slate-700">Meal 1 Start</span>
                      <input
                        type="time"
                        value={form.firstMealStart}
                        onChange={(event) => {
                          const next = { ...form, firstMealStart: event.target.value };
                          setForm(next);
                          scheduleAutoSave(next);
                        }}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-slate-700">Meal 1 End</span>
                      <input
                        type="time"
                        value={form.lastMealEnd}
                        onChange={(event) => {
                          const next = { ...form, lastMealEnd: event.target.value };
                          setForm(next);
                          scheduleAutoSave(next);
                        }}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-slate-700">Meal 2 Start</span>
                      <input
                        type="time"
                        value={form.secondMealStart}
                        onChange={(event) => {
                          const next = { ...form, secondMealStart: event.target.value };
                          setForm(next);
                          scheduleAutoSave(next);
                        }}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-slate-700">Meal 2 End</span>
                      <input
                        type="time"
                        value={form.secondMealEnd}
                        onChange={(event) => {
                          const next = { ...form, secondMealEnd: event.target.value };
                          setForm(next);
                          scheduleAutoSave(next);
                        }}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      />
                    </label>
                  </div>

                  {saveStatus !== "idle" && (
                    <div className={`mt-3 flex items-center gap-1.5 text-xs ${
                      saveStatus === "saving" ? "text-slate-400" :
                      saveStatus === "saved" ? "text-emerald-600" :
                      "text-rose-500"
                    }`}>
                      {saveStatus === "saving" && <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />}
                      {saveStatus === "saving" && "Saving…"}
                      {saveStatus === "saved" && "✓ Saved"}
                      {saveStatus === "error" && "Failed to save"}
                    </div>
                  )}

                  <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    <div>
                      {preview.error
                        ? preview.error
                        : preview.isComplete
                          ? `Estimated total with admin response time: ${formatDuration(preview.totalMsWithAdminResponse)}${
                              isLastDay ? "" : " — save this day; the attestation is signed on the last day of the event."
                            }`
                          : isLastDay
                            ? "Enter your clock in and clock out time to continue."
                            : "Enter your clock in and clock out time, then save this day."}
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={handleManualSave}
                        disabled={saveStatus === "saving" || submitting}
                        className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {saveStatus === "saving" ? "Saving..." : isMultiDay ? "Save Day" : "Save"}
                      </button>
                      {isLastDay && (
                        <button
                          onClick={goToAttestation}
                          className="inline-flex items-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                        >
                          Continue to Attestation
                        </button>
                      )}
                    </div>
                  </div>
                  </>
                  )}
                </>
              )}

              {mode === "attestation" && (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">Clock Out Attestation</h2>
                      <p className="mt-1 text-sm text-slate-600">
                        Sign to accept the attestation, or reject it if these statements are not accurate.
                      </p>
                    </div>
                    <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Step 2 of 2
                    </div>
                  </div>

                  <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
                    <p className="mb-3">
                      I, <span className="font-semibold">{payload.user.name}</span>, hereby attest that:
                    </p>
                    <ul className="list-disc space-y-2 pl-5 text-slate-600">
                      <li>All of my hours recorded for the workday are complete and accurate.</li>
                      <li>
                        I was provided with all meal periods and was authorized and permitted to take all rest and recovery periods to which I was entitled in compliance with the Company&apos;s policies during the workday, except any that I previously reported to my supervisor/Operations Director and/or Human Resources.
                      </li>
                      <li>
                        I have not violated any Company policy during the workday, including, but not limited to, the Company&apos;s policy against working off-the-clock.
                      </li>
                      <li>
                        I understand that I may raise any concerns about my ability to take meal periods or rest breaks, or any instruction or pressure to work &quot;off-the-clock,&quot; or incorrectly reporting my time worked at any time without fear of retaliation.
                      </li>
                    </ul>
                  </div>

                  <div className="mt-6">
                    <div className="mb-2 flex items-center justify-between">
                      <label className="text-sm font-medium text-slate-700">Your Signature</label>
                      <button
                        type="button"
                        onClick={() => clearCanvas(signatureCanvasRef, setSignatureIsEmpty)}
                        className="text-xs font-medium text-slate-500 underline hover:text-red-600"
                      >
                        Clear
                      </button>
                    </div>
                    <div className={`overflow-hidden rounded-2xl border-2 ${signatureIsEmpty ? "border-slate-300" : "border-slate-500"}`}>
                      <canvas
                        ref={signatureCanvasRef}
                        width={700}
                        height={180}
                        className="h-40 w-full touch-none bg-white"
                        onMouseDown={(event) =>
                          beginStroke(
                            signatureCanvasRef,
                            isDrawingSignatureRef,
                            setSignatureIsEmpty,
                            event.clientX,
                            event.clientY
                          )
                        }
                        onMouseMove={(event) =>
                          continueStroke(
                            signatureCanvasRef,
                            isDrawingSignatureRef,
                            setSignatureIsEmpty,
                            event.clientX,
                            event.clientY
                          )
                        }
                        onMouseUp={() => endStroke(isDrawingSignatureRef)}
                        onMouseLeave={() => endStroke(isDrawingSignatureRef)}
                        onTouchStart={(event) => {
                          event.preventDefault();
                          const touch = event.touches[0];
                          beginStroke(
                            signatureCanvasRef,
                            isDrawingSignatureRef,
                            setSignatureIsEmpty,
                            touch.clientX,
                            touch.clientY
                          );
                        }}
                        onTouchMove={(event) => {
                          event.preventDefault();
                          const touch = event.touches[0];
                          continueStroke(
                            signatureCanvasRef,
                            isDrawingSignatureRef,
                            setSignatureIsEmpty,
                            touch.clientX,
                            touch.clientY
                          );
                        }}
                        onTouchEnd={() => endStroke(isDrawingSignatureRef)}
                      />
                    </div>
                  </div>

                  <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                    <button
                      onClick={() => setMode("form")}
                      className="inline-flex items-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      Back to Edit
                    </button>
                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={() => {
                          setError("");
                          setMode("reject");
                          clearCanvas(rejectionCanvasRef, setRejectionSignatureIsEmpty);
                        }}
                        className="inline-flex items-center rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100"
                      >
                        Reject Attestation
                      </button>
                      <button
                        onClick={() => void submitTimesheet(true)}
                        disabled={submitting}
                        className="inline-flex items-center rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {submitting ? "Submitting..." : "Accept & Submit"}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {mode === "reject" && (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">Reason for Rejection</h2>
                      <p className="mt-1 text-sm text-slate-600">
                        Select the reason you are rejecting the attestation and sign to confirm.
                      </p>
                    </div>
                    <div className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red-700">
                      Rejection Flow
                    </div>
                  </div>

                  <div className="mt-6 space-y-3">
                    {REJECTION_REASONS.map((reason) => (
                      <button
                        key={reason}
                        type="button"
                        onClick={() => setRejectionReason(reason)}
                        className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
                          rejectionReason === reason
                            ? "border-red-500 bg-red-50 text-red-800"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        {reason}
                      </button>
                    ))}
                  </div>

                  {rejectionReason === "Other" && (
                    <div className="mt-4">
                      <label className="mb-2 block text-sm font-medium text-slate-700">Additional Notes</label>
                      <textarea
                        value={rejectionNote}
                        onChange={(event) => setRejectionNote(event.target.value)}
                        rows={4}
                        className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                        placeholder="Explain why you are rejecting the attestation..."
                      />
                    </div>
                  )}

                  <div className="mt-6">
                    <div className="mb-2 flex items-center justify-between">
                      <label className="text-sm font-medium text-slate-700">Your Signature</label>
                      <button
                        type="button"
                        onClick={() => clearCanvas(rejectionCanvasRef, setRejectionSignatureIsEmpty)}
                        className="text-xs font-medium text-slate-500 underline hover:text-red-600"
                      >
                        Clear
                      </button>
                    </div>
                    <div className={`overflow-hidden rounded-2xl border-2 ${rejectionSignatureIsEmpty ? "border-slate-300" : "border-red-400"}`}>
                      <canvas
                        ref={rejectionCanvasRef}
                        width={700}
                        height={180}
                        className="h-40 w-full touch-none bg-white"
                        onMouseDown={(event) =>
                          beginStroke(
                            rejectionCanvasRef,
                            isDrawingRejectionRef,
                            setRejectionSignatureIsEmpty,
                            event.clientX,
                            event.clientY
                          )
                        }
                        onMouseMove={(event) =>
                          continueStroke(
                            rejectionCanvasRef,
                            isDrawingRejectionRef,
                            setRejectionSignatureIsEmpty,
                            event.clientX,
                            event.clientY
                          )
                        }
                        onMouseUp={() => endStroke(isDrawingRejectionRef)}
                        onMouseLeave={() => endStroke(isDrawingRejectionRef)}
                        onTouchStart={(event) => {
                          event.preventDefault();
                          const touch = event.touches[0];
                          beginStroke(
                            rejectionCanvasRef,
                            isDrawingRejectionRef,
                            setRejectionSignatureIsEmpty,
                            touch.clientX,
                            touch.clientY
                          );
                        }}
                        onTouchMove={(event) => {
                          event.preventDefault();
                          const touch = event.touches[0];
                          continueStroke(
                            rejectionCanvasRef,
                            isDrawingRejectionRef,
                            setRejectionSignatureIsEmpty,
                            touch.clientX,
                            touch.clientY
                          );
                        }}
                        onTouchEnd={() => endStroke(isDrawingRejectionRef)}
                      />
                    </div>
                  </div>

                  <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                    <button
                      onClick={() => setMode("attestation")}
                      className="inline-flex items-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      Back
                    </button>
                    <button
                      onClick={() => void submitTimesheet(false)}
                      disabled={submitting}
                      className="inline-flex items-center rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {submitting ? "Submitting..." : "Confirm Rejection & Submit"}
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="space-y-6">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900">Shift Summary</h3>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Check In</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">
                      {form.firstIn ? formatClockValue(subtractMinutes(form.firstIn, 30)) : "--"}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Check Out</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">
                      {form.lastOut ? formatClockValue(form.lastOut) : "--"}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Meal Time</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">
                      {preview.isComplete ? formatDuration(preview.mealMs) : "--"}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Admin Response / Entry Processing
                    </div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">
                      {formatDuration(ADMIN_RESPONSE_ENTRY_PROCESSING_MS)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 sm:col-span-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total Time</div>
                    <div className="mt-1 text-2xl font-bold text-slate-900">
                      {preview.isComplete ? formatDuration(preview.totalMsWithAdminResponse) : "--"}
                    </div>
                  </div>
                </div>

              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900">Event Details</h3>
                <dl className="mt-4 space-y-3 text-sm text-slate-700">
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500">Date</dt>
                    <dd className="text-right font-medium text-slate-900">{formatEventDate(selectedDate || payload.event.date)}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500">Scheduled</dt>
                    <dd className="text-right font-medium text-slate-900">
                      {`${formatClockValue(payload.event.startTime)} - ${formatClockValue(payload.event.endTime)}`}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500">Venue</dt>
                    <dd className="text-right font-medium text-slate-900">{payload.event.venue || "Venue TBD"}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500">Location</dt>
                    <dd className="text-right font-medium text-slate-900">
                      {[payload.event.city, payload.event.state].filter(Boolean).join(", ") || "TBD"}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500">Timezone</dt>
                    <dd className="text-right font-medium text-slate-900">{payload.event.timezone}</dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900">Important</h3>
                <p className="mt-2 text-sm text-slate-600">
                  The attestation step stores your signature using the same clock-out attestation record used elsewhere in the system.
                </p>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
