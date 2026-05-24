// app/employees/[id]/page.tsx
"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { KnowYourRightsNoticeSection } from "@/components/KnowYourRightsNoticeSection";
import { supabase } from "@/lib/supabase";
import {
  isCaTempAgreementCustomFormTitle,
  isTempAgreementForm as isTempAgreementFormRecord,
} from "@/app/lib/temp-agreement";
import {
  getTempAgreementSignaturePlacement,
  LEGACY_TEMP_AGREEMENT_SIGNATURE_RECT,
} from "@/app/lib/temp-agreement-signature-placement";
import { mergeSavedPdfFieldsOntoTemplate } from "@/app/lib/pdf-template-field-merge";

type Employee = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  department: string;
  position: string;
  hire_date: string;
  status: "active" | "on_leave" | "inactive";
  salary: number | null;
  profile_photo_url?: string | null;
  state: string | null;
  city: string | null;
  region_id?: string | null;
  region_name?: string | null;
  performance_score?: number | null;
  projects_completed?: number | null;
  attendance_rate?: number | null;
  customer_satisfaction?: number | null;
};


type TimeEntry = {
  id: string;
  event_id: string | null;
  clock_in: string | null;  // ISO
  clock_out: string | null; // ISO
  duration_hours?: number;  // pre-computed: meals deducted + 30 min bonus
};

type PerEvent = {
  event_id: string | null;
  shifts: number;
  hours: number;
  event_name: string | null;
  event_date: string | null; // YYYY-MM-DD
  venue?: string | null;
  event_type?: string | null;
  is_team_member?: boolean;
  timesheet_attestation_status?: "submitted" | "rejected" | "not_submitted";
  timesheet_edit_request_status?: string | null;
  timesheet_edit_request_created_at?: string | null;
};

type SickLeaveStatus = "pending" | "approved" | "denied";

type SickLeaveEntry = {
  id: string;
  start_date: string | null;
  end_date: string | null;
  duration_hours: number;
  status: string;
  reason: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string | null;
};

type SickLeaveSummary = {
  total_hours: number;
  total_days: number;
  entries: SickLeaveEntry[];
  accrued_months: number;
  accrued_hours: number;
  accrued_days: number;
  carry_over_hours: number;
  carry_over_days?: number;
  balance_hours: number;
  balance_days: number;
};

type SummaryPayload = {
  employee: Employee;
  summary: {
    total_hours: number;
    total_shifts: number;
    month_hours: number;
    last_30d_hours: number;
    per_event: PerEvent[];
    sick_leave: SickLeaveSummary;
  };
  entries: TimeEntry[];
};

const sickLeaveStatusStyles: Record<SickLeaveStatus, string> = {
  approved: "bg-green-100 text-green-700 border-green-200",
  pending: "bg-yellow-100 text-yellow-700 border-yellow-200",
  denied: "bg-red-100 text-red-700 border-red-200",
};

const fallbackSickLeaveStatusStyle = "bg-gray-100 text-gray-700 border-gray-200";

type I9Documents = {
  id?: string;
  user_id?: string;
  drivers_license_url?: string;
  drivers_license_filename?: string;
  drivers_license_uploaded_at?: string;
  ssn_document_url?: string;
  ssn_document_filename?: string;
  ssn_document_uploaded_at?: string;
  additional_doc_url?: string;
  additional_doc_filename?: string;
  additional_doc_uploaded_at?: string;
  created_at?: string;
  updated_at?: string;
};

type PDFForm = {
  id?: string;
  form_name: string;
  display_name: string;
  form_data: string; // base64
  updated_at: string;
  created_at: string;
  form_date: string | null;
};

const normalizeStandardOnboardingFormName = (formName?: string | null) =>
  String(formName || '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]{2}-/, '');

type PaystubDistributionEntry = {
  id: string;
  employee_name: string;
  pay_date: string | null;
  pay_period_start: string | null;
  pay_period_end: string | null;
  triggered_by_email: string | null;
  distribution_mode: "single" | "batch";
  status: "sent" | "failed";
  error_message: string | null;
  pdf_storage_path: string | null;
  sent_at: string;
};

const isTempAgreementPdfForm = (form: Pick<PDFForm, "form_name" | "display_name">) =>
  isTempAgreementFormRecord(form);

const isI9PdfForm = (form: Pick<PDFForm, "form_name" | "display_name">) => {
  const values = [form.form_name, form.display_name]
    .filter(Boolean)
    .map((value) => value.toLowerCase());

  return values.some((value) => /i-?9/.test(value));
};

const isI9CustomFormTitle = (title?: string | null) => /i-?9/i.test(title ?? "");

type OnboardingTemplate = {
  id: string;
  form_name: string;
  form_display_name: string;
  form_description: string | null;
  state_code: string | null;
  form_category: string;
  form_order: number;
  pdf_data: string; // base64
  file_size: number | null;
  is_active: boolean;
  is_required: boolean;
  created_at: string;
  updated_at: string;
};

type EventInvitation = {
  id: string;
  event_id: string;
  event_name: string | null;
  event_date: string | null;
  start_time: string | null;
  venue: string | null;
  city: string | null;
  state: string | null;
  status: string;
  source: "team" | "location";
  location_name: string | null;
  assigned_at: string;
  confirmation_token?: string | null;
};

type SubmittedAvailabilityDay = {
  date: string;
  available: boolean;
  notes?: string | null;
  submitted_at?: string | null;
};

function hoursBetween(clock_in: string | null, clock_out: string | null) {
  if (!clock_in || !clock_out) return 0;
  const a = new Date(clock_in).getTime();
  const b = new Date(clock_out).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return 0;
  return (b - a) / (1000 * 60 * 60);
}

function formatHours(h: number) {
  const totalMinutes = Math.round(h * 60);
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${hh}:${mm.toString().padStart(2, "0")}`;
}

function formatDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString();
}

// Parses a YYYY-MM-DD date as local time (avoids UTC-to-local day shift)
function formatEventDate(d?: string | null) {
  if (!d) return "—";
  const match = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const dt = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
    return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatEventTime(t?: string | null) {
  if (!t) return null;
  const match = t.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return t;
  const h = parseInt(match[1]);
  const m = match[2];
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${ampm}`;
}

// Maps US state codes to IANA timezone identifiers
const STATE_TIMEZONES: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix",
  AR: "America/Chicago", CA: "America/Los_Angeles", CO: "America/Denver",
  CT: "America/New_York", DE: "America/New_York", FL: "America/New_York",
  GA: "America/New_York", HI: "Pacific/Honolulu", ID: "America/Boise",
  IL: "America/Chicago", IN: "America/Indiana/Indianapolis", IA: "America/Chicago",
  KS: "America/Chicago", KY: "America/Kentucky/Louisville", LA: "America/Chicago",
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
  WI: "America/Chicago", WY: "America/Denver",
};

const EMPLOYEE_DETAIL_REFRESH_MS = 45000;

// Formats an ISO timestamp as "Jan 1, 2025, 9:00 AM", optionally in a venue state's timezone
function formatDateTime(d?: string | null, state?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  const tz = (state && STATE_TIMEZONES[state.toUpperCase()]) || undefined;
  return dt.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
    ...(tz ? { timeZone: tz } : {}),
  });
}

export default function WorkerProfilePage() {
  const params = useParams<{ id: string }>();
  const employeeId = params?.id;
  const timeSheetUserQuery = employeeId ? `?userId=${encodeURIComponent(employeeId)}` : "";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [summary, setSummary] = useState<SummaryPayload["summary"] | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [i9Documents, setI9Documents] = useState<I9Documents | null>(null);
  const [i9Loading, setI9Loading] = useState(false);
  const [pdfForms, setPdfForms] = useState<PDFForm[]>([]);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [formsError, setFormsError] = useState<string>('');
  const [customFormsList, setCustomFormsList] = useState<{ id: string; title: string; requires_signature: boolean; target_state: string | null; target_region: string | null; allow_venue_display?: boolean | null; created_at?: string | null; assigned_at?: string | null }[]>([]);
  const [assignedFormIds, setAssignedFormIds] = useState<Set<string>>(new Set());
  const [customFormsLoading, setCustomFormsLoading] = useState(false);
  const [customFormDocs, setCustomFormDocs] = useState<Record<string, { slot: string; label: string; filename: string; url: string | null }[]>>({});
  const [employeeHomeVenue, setEmployeeHomeVenue] = useState<{ id: string; venue_name: string; city: string | null; state: string | null } | null>(null);
  const [uploadedEmails, setUploadedEmails] = useState<{ url: string; name: string; createdAt: string }[]>([]);
  const [sickRequestHours, setSickRequestHours] = useState<string>("");
  const [sickRequestDate, setSickRequestDate] = useState<string>(
    () => new Date().toISOString().slice(0, 10)
  );
  const [submittingSickRequest, setSubmittingSickRequest] = useState(false);
  const [sickRequestError, setSickRequestError] = useState("");
  const [sickRequestSuccess, setSickRequestSuccess] = useState("");

  const [regions, setRegions] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedRegion, setSelectedRegion] = useState<string>("");
  const [savingRegion, setSavingRegion] = useState(false);
  const [regionMessage, setRegionMessage] = useState("");

  const [eventInvitations, setEventInvitations] = useState<EventInvitation[]>([]);
  const [submittedAvailability, setSubmittedAvailability] = useState<SubmittedAvailabilityDay[]>([]);
  const [availabilityLastSubmittedAt, setAvailabilityLastSubmittedAt] = useState<string | null>(null);
  const [timesheetEditRequestTarget, setTimesheetEditRequestTarget] = useState<{
    eventId: string;
    eventName: string;
  } | null>(null);
  const [timesheetEditRequestReason, setTimesheetEditRequestReason] = useState("");
  const [timesheetEditRequestError, setTimesheetEditRequestError] = useState("");
  const [submittingTimesheetEditRequest, setSubmittingTimesheetEditRequest] = useState(false);

  const renderTimeSheetAction = (
    eventId: string | null | undefined,
    attestationStatus: PerEvent["timesheet_attestation_status"] = "not_submitted",
    editRequestStatus: PerEvent["timesheet_edit_request_status"] = null,
    eventName = "this event",
    className = "inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
  ) => {
    if (!eventId) return null;
    if (attestationStatus !== "not_submitted") {
      if (editRequestStatus === "approved") {
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border border-blue-200 bg-blue-50 text-blue-700">
              Edit Approved
            </span>
            <Link
              href={`/time-sheets/${eventId}${timeSheetUserQuery}`}
              className={className}
            >
              Open Timesheet
            </Link>
          </div>
        );
      }

      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border ${
              attestationStatus === "submitted"
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-red-50 text-red-700 border-red-200"
            }`}
          >
            {attestationStatus === "submitted" ? "Attested" : "Rejected"}
          </span>
          {editRequestStatus === "submitted" || editRequestStatus === "in_review" ? (
            <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border border-amber-200 bg-amber-50 text-amber-700">
              Edit Requested
            </span>
          ) : editRequestStatus === "rejected" ? (
            <>
              <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border border-red-200 bg-red-50 text-red-700">
                Edit Request Rejected
              </span>
              <button
                type="button"
                onClick={() => {
                  setTimesheetEditRequestTarget({ eventId, eventName });
                  setTimesheetEditRequestReason("");
                  setTimesheetEditRequestError("");
                }}
                className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Request Again
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setTimesheetEditRequestTarget({ eventId, eventName });
                setTimesheetEditRequestReason("");
                setTimesheetEditRequestError("");
              }}
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Request Edit
            </button>
          )}
        </div>
      );
    }

    return (
      <Link href={`/time-sheets/${eventId}${timeSheetUserQuery}`} className={className}>
        View Timesheet
      </Link>
    );
  };

  const submitTimesheetEditRequest = async () => {
    if (!timesheetEditRequestTarget || !employeeId) return;

    const trimmedReason = timesheetEditRequestReason.trim();
    if (!trimmedReason) {
      setTimesheetEditRequestError("Please explain why this timesheet needs to be edited.");
      return;
    }

    setSubmittingTimesheetEditRequest(true);
    setTimesheetEditRequestError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        window.location.href = "/login";
        return;
      }

      const res = await fetch("/api/timesheet-edit-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          eventId: timesheetEditRequestTarget.eventId,
          targetUserId: employeeId,
          requestReason: trimmedReason,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to submit timesheet edit request.");
      }

      setSummary((prev) =>
        prev
          ? {
              ...prev,
              per_event: prev.per_event.map((row) =>
                row.event_id === timesheetEditRequestTarget.eventId
                  ? {
                      ...row,
                      timesheet_edit_request_status: data?.request?.status || "submitted",
                      timesheet_edit_request_created_at:
                        data?.request?.createdAt || new Date().toISOString(),
                    }
                  : row
              ),
            }
          : prev
      );
      setTimesheetEditRequestTarget(null);
      setTimesheetEditRequestReason("");
    } catch (error: any) {
      setTimesheetEditRequestError(
        error?.message || "Failed to submit timesheet edit request."
      );
    } finally {
      setSubmittingTimesheetEditRequest(false);
    }
  };
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [regionEvents, setRegionEvents] = useState<{ id: string; event_name: string | null; event_date: string | null; start_time: string | null; venue: string | null; city: string | null; state: string | null }[]>([]);
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth()); // 0-11
  const [refreshTick, setRefreshTick] = useState(0);

  const [paystubHistory, setPaystubHistory] = useState<PaystubDistributionEntry[]>([]);
  const [paystubHistoryLoading, setPaystubHistoryLoading] = useState(false);
  const [paystubHistoryError, setPaystubHistoryError] = useState<string | null>(null);

  useEffect(() => {
    if (!employeeId) return;

    const refreshVisiblePage = () => {
      if (document.visibilityState !== "visible") return;
      setRefreshTick((current) => current + 1);
    };

    const intervalId = window.setInterval(refreshVisiblePage, EMPLOYEE_DETAIL_REFRESH_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshVisiblePage();
      }
    };

    window.addEventListener("focus", refreshVisiblePage);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshVisiblePage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [employeeId]);

  useEffect(() => {
    const load = async () => {
      console.log("🔵 [DEBUG] Starting to load worker:", employeeId);
      setLoading(true);
      setErr(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        console.log("🔵 [DEBUG] Session:", session ? "exists" : "none");

        const url = `/api/employees/${employeeId}/summary`;
        console.log("🔵 [DEBUG] Fetching URL:", url);

        const res = await fetch(url, {
          headers: {
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          cache: "no-store",
        });

        console.log("🔵 [DEBUG] Response status:", res.status);

        if (res.status === 404) {
          console.log("🔴 [DEBUG] Worker not found (404)");
          setErr("Worker not found");
          setEmployee(null);
          setSummary(null);
          setEntries([]);
          return;
        }

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          console.log("🔴 [DEBUG] Error response:", data);
          throw new Error(data.error || `Failed to load worker (${res.status})`);
        }

        const data: SummaryPayload = await res.json();
        console.log("🟢 [DEBUG] Received data:", data);
        console.log("🟢 [DEBUG] Worker object:", data.employee);
        console.log("🟢 [DEBUG] Summary object:", data.summary);
        console.log("🟢 [DEBUG] Entries count:", data.entries?.length || 0);

        setEmployee(data.employee);
        setSummary(data.summary);
        setEntries(data.entries || []);

        console.log("🟢 [DEBUG] State updated successfully");
      } catch (e: any) {
        console.log("🔴 [DEBUG] Error caught:", e.message);
        setErr(e.message || "Failed to load worker");
      } finally {
        setLoading(false);
        console.log("🔵 [DEBUG] Loading complete");
      }
    };

    if (employeeId) {
      load();
    } else {
      console.log("🔴 [DEBUG] No employeeId provided");
      setLoading(false);
    }
  }, [employeeId, refreshTick]);

  // Fetch uploaded email images for this employee
  useEffect(() => {
    if (!employee?.id) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      const headers: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};
      fetch(`/api/admin/upload-emails?images=${employee.id}`, { headers, cache: "no-store" })
        .then((r) => r.ok ? r.json() : { images: [] })
        .then((d) => setUploadedEmails(d.images ?? []));
    });
  }, [employee?.id, refreshTick]);

  // Fetch paystub distribution history for this employee
  useEffect(() => {
    if (!employeeId) return;
    setPaystubHistoryLoading(true);
    setPaystubHistoryError(null);
    supabase.auth.getSession().then(({ data: { session } }) => {
      fetch(`/api/employees/${employeeId}/paystub-history`, {
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {},
        cache: "no-store",
      })
        .then((r) => r.json())
        .then((body) => {
          if (body.error) {
            setPaystubHistoryError(body.error);
            setPaystubHistory([]);
          } else {
            setPaystubHistory((body.records as PaystubDistributionEntry[]) ?? []);
          }
          setPaystubHistoryLoading(false);
        })
        .catch((e) => {
          setPaystubHistoryError(e.message ?? "Failed to load paystubs");
          setPaystubHistoryLoading(false);
        });
    });
  }, [employeeId, refreshTick]);

  // Fetch I-9 documents after worker is loaded
  useEffect(() => {
    const loadI9Documents = async () => {
      if (!employee?.id) return;

      setI9Loading(true);

      try {
        const { data: { session } } = await supabase.auth.getSession();

        const response = await fetch(`/api/i9-documents/${employee.id}`, {
          headers: {
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          cache: "no-store",
        });

        if (response.ok) {
          const result = await response.json();
          setI9Documents(result.document || null);
        } else {
          setI9Documents(null);
        }
      } catch (error) {
        console.error("Error loading I-9 documents:", error);
        setI9Documents(null);
      } finally {
        setI9Loading(false);
      }
    };

    loadI9Documents();
  }, [employee?.id, refreshTick]);

  // Fetch PDF forms after worker is loaded
  useEffect(() => {
    const loadPDFForms = async () => {
      if (!employee?.id) return;

      console.log("🔵 [DEBUG] Fetching PDF forms for user:", employee.id);
      setPdfLoading(true);

      try {
        const { data: { session } } = await supabase.auth.getSession();

        const response = await fetch(`/api/pdf-form-progress/user-list/${employee.id}`, {
          headers: {
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          cache: "no-store",
        });

        if (response.ok) {
          const result = await response.json();
          console.log("🟢 [DEBUG] PDF forms response:", result);
          console.log("🟢 [DEBUG] PDF forms count:", result.forms?.length || 0);
          console.log("🟢 [DEBUG] PDF forms array:", result.forms);
          setPdfForms(result.forms || []);
        } else {
          const errorText = await response.text();
          console.log("⚠️ [DEBUG] PDF forms error response:", response.status, errorText);
          setPdfForms([]);
        }
      } catch (error) {
        console.error("🔴 [DEBUG] Error loading PDF forms:", error);
        setPdfForms([]);
      } finally {
        setPdfLoading(false);
      }
    };

    loadPDFForms();
  }, [employee?.id, refreshTick]);

  // Fetch available custom forms list + user-specific assignments
  useEffect(() => {
    if (!employee) return;
    const loadCustomForms = async () => {
      setCustomFormsLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} as Record<string, string>;

        const [formsRes, assignmentsRes, venueRes] = await Promise.all([
          fetch('/api/custom-forms/list', { headers, cache: "no-store" }),
          fetch(`/api/custom-forms/user-assignments?userId=${employee.id}`, { headers, cache: "no-store" }),
          fetch(`/api/my-assigned-venues?asUser=${employee.id}`, { headers, cache: "no-store" }),
        ]);

        if (venueRes.ok) {
          const venueData = await venueRes.json();
          const venues = venueData.venues || [];
          setEmployeeHomeVenue(venues[0] || null);
        }

        let stateForms: typeof customFormsList = [];
        if (formsRes.ok) {
          const data = await formsRes.json();
          const allForms = data.forms || [];
          stateForms = allForms.filter((f: { target_state: string | null; target_region: string | null; assignment_count?: number }) =>
            // State filter
            (!f.target_state || f.target_state === employee.state) &&
            // Region filter
            (!f.target_region || f.target_region === (employee.region_id || null)) &&
            // Only include forms that are unrestricted (no specific user assignments).
            // Forms with assignment_count > 0 are restricted to specific users —
            // those will only appear via specificForms (user-assignments route).
            (f.assignment_count === 0 || f.assignment_count == null)
          );
        }

        let specificIds = new Set<string>();
        let assignedAtMap: Record<string, string | null> = {};
        let specificForms: typeof customFormsList = [];
        if (assignmentsRes.ok) {
          const data = await assignmentsRes.json();
          const assigned: { id: string; title: string; requires_signature: boolean; target_state: string | null; target_region: string | null; allow_venue_display?: boolean | null; created_at?: string | null; assigned_at?: string | null }[] = data.assignedForms || [];
          specificIds = new Set(assigned.map(f => f.id));
          assignedAtMap = Object.fromEntries(assigned.map(f => [f.id, f.assigned_at ?? null]));
          // Add assigned forms not already in the state list
          specificForms = assigned.filter(f => !stateForms.find(sf => sf.id === f.id));
        }

        // Inject assigned_at into state-filtered forms that are also directly assigned
        const mergedStateForms = stateForms.map(f =>
          specificIds.has(f.id) ? { ...f, assigned_at: assignedAtMap[f.id] } : f
        );

        setAssignedFormIds(specificIds);
        // Merge: state-filtered forms first, then any extra assigned forms
        setCustomFormsList([...mergedStateForms, ...specificForms]);
      } catch (e) {
        console.error('Error loading custom forms list:', e);
      } finally {
        setCustomFormsLoading(false);
      }
    };
    loadCustomForms();
  }, [employee]);

  // Load supporting docs for each submitted custom form
  useEffect(() => {
    if (!customFormsList.length || !pdfForms.length || !employeeId) return;
    const submittedFormIds = customFormsList
      .filter(f => isI9CustomFormTitle(f.title))
      .filter(f => pdfForms.some(p => p.form_name === `custom-form-${f.id}`))
      .map(f => f.id);
    if (!submittedFormIds.length) {
      setCustomFormDocs({});
      return;
    }

    const loadDocs = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const results = await Promise.all(
        submittedFormIds.map(async (formId) => {
          try {
            const res = await fetch(
              `/api/custom-forms/${formId}/docs?userId=${employeeId}`,
              {
                headers: { Authorization: `Bearer ${session.access_token}` },
                cache: "no-store",
              },
            );
            if (!res.ok) return [formId, []] as const;
            const data = await res.json();
            return [formId, data.docs ?? []] as const;
          } catch {
            return [formId, []] as const;
          }
        }),
      );

      setCustomFormDocs(Object.fromEntries(results));
    };

    loadDocs();
  }, [customFormsList, pdfForms, employeeId]);

  // Fetch event invitations (team + location assignments) for this employee
  useEffect(() => {
    if (!employeeId) return;
    const loadInvitations = async () => {
      setInvitationsLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`/api/employees/${employeeId}/invitations`, {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json();
          setEventInvitations(data.invitations || []);
          setSubmittedAvailability(data.availability_submissions || []);
          setAvailabilityLastSubmittedAt(data.availability_last_submitted_at || null);
        } else {
          setEventInvitations([]);
          setSubmittedAvailability([]);
          setAvailabilityLastSubmittedAt(null);
        }
      } catch (e) {
        console.error("Error loading event invitations:", e);
        setEventInvitations([]);
        setSubmittedAvailability([]);
        setAvailabilityLastSubmittedAt(null);
      } finally {
        setInvitationsLoading(false);
      }
    };
    loadInvitations();
  }, [employeeId]);

  // Fetch all region events for this employee's assigned region
  useEffect(() => {
    if (!employeeId) return;
    const loadRegionEvents = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`/api/employees/${employeeId}/region-events`, {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          setRegionEvents(data.events || []);
        } else {
          setRegionEvents([]);
        }
      } catch (e) {
        console.error("Error loading region events:", e);
        setRegionEvents([]);
      }
    };
    loadRegionEvents();
  }, [employeeId, employee?.region_id, refreshTick]);

  // Fetch regions list
  useEffect(() => {
    const loadRegions = async () => {
      try {
        const res = await fetch("/api/regions", { cache: "no-store" });
        const data = await res.json();
        if (res.ok) setRegions(Array.isArray(data.regions) ? data.regions : []);
      } catch (e) {
        console.error("Error loading regions:", e);
      }
    };
    loadRegions();
  }, []);

  // Pre-populate selected region when employee data loads
  useEffect(() => {
    if (employee) setSelectedRegion(employee.region_id || "");
  }, [employee?.region_id]);

  const saveRegion = async () => {
    if (!employee) return;
    setSavingRegion(true);
    setRegionMessage("");
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ region_id: selectedRegion || null } as never)
        .eq("user_id", employee.id);
      if (error) throw error;
      const nextRegionName =
        regions.find((region) => region.id === (selectedRegion || ""))?.name || null;
      setEmployee((prev) =>
        prev
          ? {
              ...prev,
              region_id: selectedRegion || null,
              region_name: nextRegionName,
            }
          : prev
      );
      setRegionMessage("Region saved.");
      setTimeout(() => setRegionMessage(""), 3000);
    } catch (e: any) {
      setRegionMessage(e?.message || "Failed to save region");
    } finally {
      setSavingRegion(false);
    }
  };

  const computed = useMemo(() => {
    if (!entries) return { totalHoursLocal: 0 };
    // Use pre-computed duration_hours (meals deducted + 30 min bonus)
    const total = entries.reduce((acc, e) => acc + (e.duration_hours ?? 0), 0);
    return { totalHoursLocal: total };
  }, [entries]);

  // Create event name lookup from per_event data

  const sickLeaveSummary = summary?.sick_leave;
  const sickLeaveEntries = sickLeaveSummary?.entries ?? [];

  // Build a map of YYYY-MM-DD → set of marker types for the calendar
  // and a map of YYYY-MM-DD → confirmed event details
  const { calDots, calEventDetails, calRegionEventDetails } = useMemo(() => {
    const map = new Map<string, Set<"event" | "shift" | "sick" | "available" | "unavailable" | "region_event">>();
    const events = new Map<string, { name: string; start_time: string | null }[]>();
    const regionEvMap = new Map<string, { name: string; start_time: string | null }[]>();
    const mark = (
      dateStr: string | null | undefined,
      type: "event" | "shift" | "sick" | "available" | "unavailable" | "region_event"
    ) => {
      if (!dateStr) return;
      const d = dateStr.slice(0, 10);
      if (!map.has(d)) map.set(d, new Set());
      map.get(d)!.add(type);
    };
    const personalEventIds = new Set(eventInvitations.map(inv => inv.event_id));
    eventInvitations.filter(inv => inv.status === "confirmed").forEach(inv => {
      mark(inv.event_date, "event");
      if (inv.event_date) {
        const d = inv.event_date.slice(0, 10);
        if (!events.has(d)) events.set(d, []);
        events.get(d)!.push({ name: inv.event_name ?? "Event", start_time: inv.start_time ?? null });
      }
    });
    // Region events: all active events not already in personal invitations
    regionEvents.forEach(ev => {
      if (!ev.event_date) return;
      if (personalEventIds.has(ev.id)) return;
      mark(ev.event_date, "region_event");
      const d = ev.event_date.slice(0, 10);
      if (!regionEvMap.has(d)) regionEvMap.set(d, []);
      regionEvMap.get(d)!.push({ name: ev.event_name ?? "Event", start_time: ev.start_time ?? null });
    });
    entries.forEach(e => {
      if (e.clock_in) mark(e.clock_in.slice(0, 10), "shift");
    });
    sickLeaveEntries.forEach(sl => {
      if (!sl.start_date) return;
      const start = new Date(sl.start_date);
      const end = sl.end_date ? new Date(sl.end_date) : start;
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        mark(d.toISOString().slice(0, 10), "sick");
      }
    });
    submittedAvailability.forEach((day) => {
      mark(day.date, day.available ? "available" : "unavailable");
    });
    return { calDots: map, calEventDetails: events, calRegionEventDetails: regionEvMap };
  }, [eventInvitations, regionEvents, entries, sickLeaveEntries, submittedAvailability]);
  const sickLeaveTotalHours = sickLeaveSummary?.total_hours ?? 0;
  const sickLeaveAccruedHours = sickLeaveSummary?.accrued_hours ?? 0;
  const sickLeaveCarryOverHours = sickLeaveSummary?.carry_over_hours ?? 0;
  const sickLeaveEarnedOnlyHours = sickLeaveAccruedHours - sickLeaveCarryOverHours;
  const sickLeaveBalanceHours = sickLeaveSummary?.balance_hours ?? 0;
  const sickLeaveRequestCount = sickLeaveEntries.length;

  const toSickLeaveEntry = (record: any): SickLeaveEntry | null => {
    if (!record?.id) return null;
    const duration = Number(record?.duration_hours ?? 0);
    if (!Number.isFinite(duration) || duration <= 0) return null;

    return {
      id: String(record.id),
      start_date: record.start_date ? String(record.start_date) : null,
      end_date: record.end_date ? String(record.end_date) : null,
      duration_hours: Number(duration.toFixed(2)),
      status: String(record.status || "pending").toLowerCase(),
      reason: record.reason ? String(record.reason) : null,
      approved_at: record.approved_at ? String(record.approved_at) : null,
      approved_by: record.approved_by ? String(record.approved_by) : null,
      created_at: record.created_at ? String(record.created_at) : null,
    };
  };

  const appendSickLeaveEntry = (entry: SickLeaveEntry) => {
    setSummary((prev) => {
      if (!prev) return prev;

      const nextEntries = [entry, ...(prev.sick_leave?.entries || [])];
      const nextTotalHours = Number(
        ((prev.sick_leave?.total_hours || 0) + entry.duration_hours).toFixed(2)
      );
      const nextTotalDays = Number((nextTotalHours / 8).toFixed(2));
      const nextBalanceHours = Number(
        Math.max(0, (prev.sick_leave?.balance_hours || 0) - entry.duration_hours).toFixed(2)
      );
      const nextBalanceDays = Number((nextBalanceHours / 8).toFixed(2));

      return {
        ...prev,
        sick_leave: {
          ...prev.sick_leave,
          entries: nextEntries,
          total_hours: nextTotalHours,
          total_days: nextTotalDays,
          balance_hours: nextBalanceHours,
          balance_days: nextBalanceDays,
        },
      };
    });
  };

  const submitSickLeaveRequest = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSickRequestError("");
    setSickRequestSuccess("");

    const parsedHours = Number(sickRequestHours);
    if (!Number.isFinite(parsedHours) || parsedHours <= 0) {
      setSickRequestError("Please enter a valid number of hours.");
      return;
    }

    if (!sickRequestDate) {
      setSickRequestError("Please choose a date.");
      return;
    }

    setSubmittingSickRequest(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch("/api/sick-leaves/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({
          hours: parsedHours,
          date: sickRequestDate,
        }),
      });

      const data = await res.json().catch(() => ({}));
      const insertedEntry = toSickLeaveEntry(data?.record);

      if (!res.ok) {
        if (insertedEntry) {
          appendSickLeaveEntry(insertedEntry);
          setSickRequestSuccess(
            "Request saved, but notification email failed. Please contact HR if needed."
          );
          setSickRequestHours("");
          return;
        }
        throw new Error(data?.error || "Failed to submit sick leave request");
      }

      if (insertedEntry) {
        appendSickLeaveEntry(insertedEntry);
      }

      setSickRequestSuccess("Sick leave request sent successfully.");
      setSickRequestHours("");
    } catch (error: any) {
      setSickRequestError(error?.message || "Failed to submit sick leave request");
    } finally {
      setSubmittingSickRequest(false);
    }
  };

  // Embed a date string to the right of the signature block on the last PDF page.
  // Safe to call even if the date was already embedded — it just draws over itself.
  const withDateEmbedded = async (
    base64Data: string,
    date: string,
    formName?: string
  ): Promise<string> => {
    const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
    const pdfBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const lastPage = pdfDoc.getPages().at(-1)!;
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const isNoticeToEmployee = normalizeStandardOnboardingFormName(formName) === 'notice-to-employee';
    const footerYShift = isNoticeToEmployee ? -16 : 0;
    const [y, m, d] = date.split('-').map(Number);
    const formatted = new Date(y, m - 1, d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    lastPage.drawRectangle({
      x: 325,
      y: isNoticeToEmployee ? 8 : 28,
      width: 195,
      height: isNoticeToEmployee ? 105 : 85,
      color: rgb(1, 1, 1),
      borderWidth: 0,
    });
    lastPage.drawText('Date', { x: 330, y: 104 + footerYShift, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    lastPage.drawText(formatted, { x: 330, y: 60 + footerYShift, size: 11, font, color: rgb(0, 0, 0) });
    lastPage.drawLine({
      start: { x: 330, y: 38 + footerYShift },
      end: { x: 510, y: 38 + footerYShift },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.6),
    });
    const saved = await pdfDoc.save();
    let b = '';
    for (let i = 0; i < saved.length; i++) b += String.fromCharCode(saved[i]);
    return btoa(b);
  };

  // For attestation forms: ensure the employee_attestation_name field is filled and
  // rendered as static text. Mirrors the server-side flattenAttestField logic so that
  // admin downloads always show the print name even when the server lookup returned empty.
  const withAttestationPrintNameEmbedded = async (base64Data: string, employeeName: string): Promise<string> => {
    const trimmedName = employeeName.trim();
    if (!trimmedName) return base64Data;

    const ATTESTATION_NAME_FIELD_KEY = 'employee_attestation_name';
    const FALLBACK_PAGE_INDEX = 1;
    const FALLBACK_RECT = { x: 238, y: 333, width: 298, height: 18 };

    try {
      const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
      const pdfBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();

      const drawNameAtRect = (page: any, rect: { x: number; y: number; width: number; height: number }) => {
        const maxWidth = Math.max(1, rect.width - 4);
        let fontSize = Math.max(8, Math.min(10, rect.height - 2));
        while (fontSize > 8 && font.widthOfTextAtSize(trimmedName, fontSize) > maxWidth) {
          fontSize -= 0.5;
        }
        page.drawRectangle({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, color: rgb(1, 1, 1), borderWidth: 0 });
        page.drawText(trimmedName, {
          x: rect.x + 2,
          y: rect.y + Math.max(1, (rect.height - fontSize) / 2),
          size: fontSize,
          font,
          maxWidth,
        });
      };

      try {
        const nameField = pdfDoc.getForm().getTextField(ATTESTATION_NAME_FIELD_KEY);
        const currentValue = (nameField.getText() || '').trim();
        if (!currentValue) {
          nameField.setText(trimmedName);
          const widgets = (nameField as any)?.acroField?.getWidgets?.() || [];
          if (widgets.length > 0) {
            const widget = widgets[0];
            const rect = widget.getRectangle();
            const pageRef = widget.P?.();
            const targetPage = pageRef
              ? pages.find((p: any) => p.ref === pageRef)
              : pages[FALLBACK_PAGE_INDEX] ?? pages[pages.length - 1];
            if (targetPage) drawNameAtRect(targetPage, rect);
          } else {
            const fallbackPage = pages[FALLBACK_PAGE_INDEX] ?? pages[pages.length - 1];
            if (fallbackPage) drawNameAtRect(fallbackPage, FALLBACK_RECT);
          }
        }
      } catch {
        const fallbackPage = pages[FALLBACK_PAGE_INDEX] ?? pages[pages.length - 1];
        if (fallbackPage) drawNameAtRect(fallbackPage, FALLBACK_RECT);
      }

      const saved = await pdfDoc.save();
      let b = '';
      for (let i = 0; i < saved.length; i++) b += String.fromCharCode(saved[i]);
      return btoa(b);
    } catch (error) {
      console.warn('[ATTESTATION] Failed to embed print name:', error);
      return base64Data;
    }
  };

  // Embed the home venue footer fields and, for the home venue assignment form,
  // also fill the opening "I, ___" line on page 1.
  const withVenueEmbedded = async (
    base64Data: string,
    venueName: string,
    employeeName?: string,
    includeOpeningPrintName = false,
    formName?: string
  ): Promise<string> => {
    const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
    const pdfBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const lastPage = pages.at(-1)!;
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const isNoticeToEmployee = normalizeStandardOnboardingFormName(formName) === 'notice-to-employee';
    const footerYShift = isNoticeToEmployee ? -16 : 0;
    lastPage.drawRectangle({
      x: 35,
      y: isNoticeToEmployee ? 138 : 150,
      width: 445,
      height: isNoticeToEmployee ? 78 : 60,
      color: rgb(1, 1, 1),
      borderWidth: 0,
    });
    const trimmedEmployeeName = employeeName?.trim();
    if (trimmedEmployeeName) {
      lastPage.drawText('Print Name', { x: 40, y: 200 + footerYShift, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
      lastPage.drawText(trimmedEmployeeName, { x: 40, y: 175 + footerYShift, size: 11, font, color: rgb(0, 0, 0) });
      lastPage.drawLine({
        start: { x: 40, y: 160 + footerYShift },
        end: { x: 210, y: 160 + footerYShift },
        thickness: 0.5,
        color: rgb(0.6, 0.6, 0.6),
      });
      if (includeOpeningPrintName) {
        const openingLineX = 80;
        const openingLineY = 523;
        const openingLineWidth = 120;
        const preferredOpeningSize = 10.5;
        const measuredOpeningWidth = font.widthOfTextAtSize(trimmedEmployeeName, preferredOpeningSize);
        const openingSize =
          measuredOpeningWidth > openingLineWidth
            ? Math.max(8, preferredOpeningSize * (openingLineWidth / measuredOpeningWidth))
            : preferredOpeningSize;

        // Match the opening underline on the scanned template.
        firstPage.drawRectangle({
          x: openingLineX - 2,
          y: openingLineY - 4,
          width: openingLineWidth + 4,
          height: 16,
          color: rgb(1, 1, 1),
          borderWidth: 0,
        });
        firstPage.drawText(trimmedEmployeeName, {
          x: openingLineX,
          y: openingLineY + 2,
          size: openingSize,
          font,
          color: rgb(0, 0, 0),
        });
      }
    }
    lastPage.drawText('Home Venue', { x: 220, y: 200 + footerYShift, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    lastPage.drawText(venueName, { x: 220, y: 175 + footerYShift, size: 11, font, color: rgb(0, 0, 0) });
    lastPage.drawLine({
      start: { x: 220, y: 160 + footerYShift },
      end: { x: 470, y: 160 + footerYShift },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.6),
    });
    const saved = await pdfDoc.save();
    let b = '';
    for (let i = 0; i < saved.length; i++) b += String.fromCharCode(saved[i]);
    return btoa(b);
  };

  const withTempAgreementSignatureRedrawn = async (
    base64Data: string,
    signatureData?: string | null,
    signatureType?: string | null
  ): Promise<string> => {
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const pdfBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const lastPage = pdfDoc.getPages().at(-1);
    if (!lastPage) return base64Data;

    const trimmedSignature = signatureData?.trim();
    if (!trimmedSignature) return base64Data;

    const placement = await getTempAgreementSignaturePlacement(pdfBytes);
    const normalizedType = (signatureType || '').toLowerCase();
    const isImageDataUrl = trimmedSignature.toLowerCase().startsWith('data:image/');
    const isTyped = normalizedType === 'typed' || normalizedType === 'type' || !isImageDataUrl;

    lastPage.drawRectangle({
      x: LEGACY_TEMP_AGREEMENT_SIGNATURE_RECT.x,
      y: LEGACY_TEMP_AGREEMENT_SIGNATURE_RECT.y,
      width: LEGACY_TEMP_AGREEMENT_SIGNATURE_RECT.width,
      height: LEGACY_TEMP_AGREEMENT_SIGNATURE_RECT.height,
      color: rgb(1, 1, 1),
      borderWidth: 0,
    });

    if (isTyped) {
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      lastPage.drawText(trimmedSignature, {
        x: placement.x,
        y: placement.y + 22,
        size: 12,
        font,
      });
    } else {
      const match = trimmedSignature.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.*)$/i);
      const format = (match?.[1] || 'png').toLowerCase();
      const imageBase64 = match?.[2] || trimmedSignature;
      const imageBytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
      const signatureImage =
        format === 'jpg' || format === 'jpeg'
          ? await pdfDoc.embedJpg(imageBytes)
          : await pdfDoc.embedPng(imageBytes);
      const scale = Math.min(placement.width / signatureImage.width, placement.height / signatureImage.height, 1);
      const drawWidth = signatureImage.width * scale;
      const drawHeight = signatureImage.height * scale;

      lastPage.drawImage(signatureImage, {
        x: placement.x,
        y: placement.y + (placement.height - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight,
      });
    }

    const saved = await pdfDoc.save();
    let b = '';
    for (let i = 0; i < saved.length; i++) b += String.fromCharCode(saved[i]);
    return btoa(b);
  };

  const matchesCustomFormSubmission = (
    form: Pick<PDFForm, 'form_name' | 'display_name'>,
    customForm: { id: string; title: string }
  ) => {
    const titlePattern = new RegExp(
      `^${customForm.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: \\d{4})?$`,
      'i'
    );
    return [form.form_name, form.display_name]
      .filter(Boolean)
      .some((value) => value === `custom-form-${customForm.id}` || titlePattern.test(value));
  };

  const getMatchingCustomFormForPdf = (form: Pick<PDFForm, 'form_name' | 'display_name'>) =>
    customFormsList.find((customForm) => {
      return matchesCustomFormSubmission(form, customForm);
    });

  const getTempAgreementCustomFormForPdf = (form: Pick<PDFForm, 'form_name' | 'display_name'>) => {
    const matchingCustomForm = getMatchingCustomFormForPdf(form);
    if (!matchingCustomForm) return null;
    return isCaTempAgreementCustomFormTitle(matchingCustomForm.title) ? matchingCustomForm : null;
  };

  const createPdfBlobUrl = (base64Data: string) => {
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'application/pdf' });
    return window.URL.createObjectURL(blob);
  };

  const openPdfInNewTab = (base64Data: string, existingWindow?: Window | null) => {
    const url = createPdfBlobUrl(base64Data);
    const popup = existingWindow || window.open('', '_blank');
    if (!popup) {
      window.URL.revokeObjectURL(url);
      throw new Error('Popup blocked');
    }
    popup.opener = null;
    popup.location.replace(url);
    setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
  };

  const openPdfBlobInNewTab = (blob: Blob, existingWindow?: Window | null) => {
    const url = window.URL.createObjectURL(blob);
    const popup = existingWindow || window.open('', '_blank');
    if (!popup) {
      window.URL.revokeObjectURL(url);
      throw new Error('Popup blocked');
    }
    popup.opener = null;
    popup.location.replace(url);
    setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
  };

  const downloadPdfBlob = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
  };

  const isEmployeeHandbookPdfForm = (form: Pick<PDFForm, 'form_name'>) =>
    normalizeStandardOnboardingFormName(form.form_name) === 'employee-handbook';

  const getOnboardingRenderedFormBlob = async (form: PDFForm): Promise<Blob | null> => {
    if (!employeeId || !isEmployeeHandbookPdfForm(form)) {
      return null;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `/api/pdf-form-progress/user/${employeeId}?signatureSource=forms_signature&formName=${encodeURIComponent(form.form_name)}`,
        {
          cache: 'no-store',
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        }
      );

      if (!res.ok) {
        return null;
      }

      const pdfBytes = await res.arrayBuffer();
      if (!pdfBytes.byteLength) {
        return null;
      }

      return new Blob([pdfBytes], { type: 'application/pdf' });
    } catch (error) {
      console.warn('Failed to fetch onboarding-rendered PDF form, falling back to per-form render', error);
      return null;
    }
  };

  const rebuildTempAgreementFromTemplate = async (
    customFormId: string | undefined,
    base64Data: string
  ): Promise<string> => {
    if (!customFormId || !employeeId) return base64Data;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const templateRes = await fetch(`/api/custom-forms/${customFormId}/pdf`, {
        cache: 'no-store',
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });

      if (!templateRes.ok) {
        return base64Data;
      }

      const templateBytes = new Uint8Array(await templateRes.arrayBuffer());
      const savedBytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
      const rebuiltBytes = await mergeSavedPdfFieldsOntoTemplate(templateBytes, savedBytes);

      if (!rebuiltBytes) {
        return base64Data;
      }

      let binary = '';
      for (let i = 0; i < rebuiltBytes.length; i++) binary += String.fromCharCode(rebuiltBytes[i]);
      return btoa(binary);
    } catch (error) {
      console.warn('Failed to rebuild temp agreement from template, falling back to saved PDF data', error);
      return base64Data;
    }
  };

  const rebuildNoticeToEmployeeFromTemplate = async (form: PDFForm): Promise<string> => {
    const normalizedName = normalizeStandardOnboardingFormName(form.form_name);
    if (normalizedName !== 'notice-to-employee') {
      return form.form_data;
    }

    const stateCode = String(employee?.state || 'CA').trim().toLowerCase() || 'ca';
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const templateRes = await fetch(`/api/payroll-packet-${stateCode}/notice-to-employee?role=employee`, {
        cache: 'no-store',
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });

      if (!templateRes.ok) {
        return form.form_data;
      }

      const templateBytes = new Uint8Array(await templateRes.arrayBuffer());
      const savedBytes = Uint8Array.from(atob(form.form_data), (c) => c.charCodeAt(0));
      const rebuiltBytes = await mergeSavedPdfFieldsOntoTemplate(templateBytes, savedBytes);

      if (!rebuiltBytes) {
        return form.form_data;
      }

      let binary = '';
      for (let i = 0; i < rebuiltBytes.length; i++) binary += String.fromCharCode(rebuiltBytes[i]);
      return btoa(binary);
    } catch (error) {
      console.warn('Failed to rebuild notice-to-employee from template, falling back to saved PDF data', error);
      return form.form_data;
    }
  };

  const getNoticeToEmployeeRenderData = async (
    form: PDFForm
  ): Promise<{ formData: string; signatureData: string | null; signatureType: string | null }> => {
    if (!employeeId) {
      return { formData: form.form_data, signatureData: null, signatureType: null };
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `/api/pdf-form-progress/with-signature?userId=${employeeId}&formName=${encodeURIComponent(form.form_name)}&returnSignatureData=1`,
        { headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} }
      );
      if (res.ok) {
        const json = await res.json();
        return {
          formData: json.formData || form.form_data,
          signatureData: json.signatureData || null,
          signatureType: json.signatureType || null,
        };
      }
    } catch (e) {
      console.warn('Failed to fetch notice-to-employee signature data, falling back to raw PDF data', e);
    }

    return { formData: form.form_data, signatureData: null, signatureType: null };
  };

  const withNoticeToEmployeeSignatureRedrawn = async (
    base64Data: string,
    signatureData?: string | null,
    signatureType?: string | null
  ): Promise<string> => {
    const trimmedSignature = signatureData?.trim();
    if (!trimmedSignature) return base64Data;

    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const pdfBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const lastPage = pdfDoc.getPages().at(-1);
    if (!lastPage) return base64Data;

    const { width, height } = lastPage.getSize();
    const signatureWidth = 150;
    const signatureHeight = 15;
    const x = Math.max(0, width - 260);
    const y = Math.min(height - signatureHeight, 235);
    const signatureKind = (signatureType || '').toLowerCase();
    const isImageDataUrl = trimmedSignature.toLowerCase().startsWith('data:image/');
    const isTyped = signatureKind === 'typed' || signatureKind === 'type' || !isImageDataUrl;

    if (isTyped) {
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      lastPage.drawText(trimmedSignature, {
        x,
        y: y + signatureHeight / 2,
        size: 10,
        font,
      });
    } else {
      const match = trimmedSignature.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.*)$/i);
      const format = (match?.[1] || 'png').toLowerCase();
      const imageBase64 = match?.[2] || trimmedSignature;
      const imageBytes = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
      const signatureImage =
        format === 'jpg' || format === 'jpeg'
          ? await pdfDoc.embedJpg(imageBytes)
          : await pdfDoc.embedPng(imageBytes);

      lastPage.drawImage(signatureImage, {
        x,
        y,
        width: signatureWidth,
        height: signatureHeight,
      });
    }

    const saved = await pdfDoc.save();
    let b = '';
    for (let i = 0; i < saved.length; i++) b += String.fromCharCode(saved[i]);
    return btoa(b);
  };

  const getFormDataWithSignature = async (form: PDFForm): Promise<string> => {
    if (!employeeId) return form.form_data;
    try {
      const matchingCustomForm = getMatchingCustomFormForPdf(form);
      const signatureFormId = matchingCustomForm ? `custom-form-${matchingCustomForm.id}` : null;
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `/api/pdf-form-progress/with-signature?userId=${employeeId}&formName=${encodeURIComponent(form.form_name)}${signatureFormId ? `&signatureFormId=${encodeURIComponent(signatureFormId)}` : ''}`,
        { headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} }
      );
      if (res.ok) {
        const json = await res.json();
        if (json.formData) return json.formData;
      }
    } catch (e) {
      console.warn('Failed to fetch form with signature, falling back to raw data', e);
    }
    return form.form_data;
  };

  const getTempAgreementRenderData = async (
    form: PDFForm
  ): Promise<{ formData: string; signatureData: string | null; signatureType: string | null }> => {
    if (!employeeId) {
      return { formData: form.form_data, signatureData: null, signatureType: null };
    }

    try {
      const tempAgreementCustomForm = getTempAgreementCustomFormForPdf(form);
      const signatureFormId = tempAgreementCustomForm ? `custom-form-${tempAgreementCustomForm.id}` : null;
      const { data: { session } } = await supabase.auth.getSession();
      // Only CA temp-agree custom forms do not use the generic server-side embed branch.
      // View/download intentionally fetch the raw saved PDF plus the separate signature
      // and then rebuild/redraw in a dedicated temp-agreement pipeline below.
      const res = await fetch(
        `/api/pdf-form-progress/with-signature?userId=${employeeId}&formName=${encodeURIComponent(form.form_name)}&returnSignatureData=1${signatureFormId ? `&signatureFormId=${encodeURIComponent(signatureFormId)}` : ''}`,
        { headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} }
      );
      if (res.ok) {
        const json = await res.json();
        return {
          formData: json.formData || form.form_data,
          signatureData: json.signatureData || null,
          signatureType: json.signatureType || null,
        };
      }
    } catch (e) {
      console.warn('Failed to fetch temp agreement signature data, falling back to raw PDF data', e);
    }

    return { formData: form.form_data, signatureData: null, signatureType: null };
  };

  // Download a single PDF form
  const downloadPaystub = async (logId: string, label: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/distribute-paystub/download?logId=${logId}`, {
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || "Failed to download paystub");
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = label;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const downloadPDFForm = async (form: PDFForm, venueName?: string) => {
    try {
      const onboardingRenderedBlob = await getOnboardingRenderedFormBlob(form);
      if (onboardingRenderedBlob) {
        downloadPdfBlob(onboardingRenderedBlob, `${form.display_name}.pdf`);
        return;
      }

      const matchingCustomForm = getMatchingCustomFormForPdf(form);
      const tempAgreementCustomForm = getTempAgreementCustomFormForPdf(form);
      const isTempAgreementForm =
        !!tempAgreementCustomForm ||
        (!matchingCustomForm &&
          isTempAgreementPdfForm({
          form_name: form.form_name,
          display_name: form.display_name,
        }));
      let data: string;
      if (isTempAgreementForm) {
        const tempAgreementData = await getTempAgreementRenderData(form);
        const rebuiltFormData = tempAgreementData.signatureData?.trim()
          ? await rebuildTempAgreementFromTemplate(
              tempAgreementCustomForm?.id || matchingCustomForm?.id,
              tempAgreementData.formData
            )
          : tempAgreementData.formData;
        data = await withTempAgreementSignatureRedrawn(
          rebuiltFormData,
          tempAgreementData.signatureData,
          tempAgreementData.signatureType
        );
      } else {
        const isNoticeToEmployee = normalizeStandardOnboardingFormName(form.form_name) === 'notice-to-employee';
        const noticeRenderData = isNoticeToEmployee
          ? await getNoticeToEmployeeRenderData(form)
          : null;
        data = noticeRenderData?.formData || await getFormDataWithSignature(form);
        if (isNoticeToEmployee) {
          data = await rebuildNoticeToEmployeeFromTemplate({
            ...form,
            form_data: noticeRenderData?.formData || form.form_data,
          });
        }
      }
      const shouldEmbedProfileFields = !isTempAgreementForm;
      const employeeFullName = employee ? `${employee.first_name} ${employee.last_name}` : undefined;
      const isAttestationPdfForm = form.form_name.toLowerCase().includes('attestation');
      const isNoticeToEmployee = normalizeStandardOnboardingFormName(form.form_name) === 'notice-to-employee';
      const shouldEmbedVenueForForm = Boolean(venueName) && !(isNoticeToEmployee && !matchingCustomForm);
      const shouldEmbedOpeningPrintName = form.form_name.toLowerCase().includes('home-venue-assignment');
      if (
        shouldEmbedProfileFields &&
        form.form_date &&
        !isAttestationPdfForm &&
        !isNoticeToEmployee
      ) {
        data = await withDateEmbedded(data, form.form_date, form.form_name);
      }
      if (shouldEmbedProfileFields && isAttestationPdfForm && employeeFullName) {
        data = await withAttestationPrintNameEmbedded(data, employeeFullName);
      }
      if (shouldEmbedProfileFields && shouldEmbedVenueForForm && venueName) {
        data = await withVenueEmbedded(
          data,
          venueName,
          employeeFullName,
          shouldEmbedOpeningPrintName,
          form.form_name
        );
      }
      if (isNoticeToEmployee) {
        const noticeRenderData = await getNoticeToEmployeeRenderData(form);
        data = await withNoticeToEmployeeSignatureRedrawn(
          data,
          noticeRenderData.signatureData,
          noticeRenderData.signatureType
        );
      }
      const url = createPdfBlobUrl(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${form.display_name}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      console.error('Error downloading PDF:', error);
      alert('Failed to download PDF form');
    }
  };

  const viewPDFForm = async (form: PDFForm, venueName?: string) => {
    const previewWindow = window.open('', '_blank');
    if (previewWindow) {
      previewWindow.document.title = form.display_name || 'PDF Preview';
      previewWindow.document.body.innerHTML = '<div style="font-family: Arial, sans-serif; padding: 24px;">Preparing PDF preview...</div>';
    }

    try {
      const onboardingRenderedBlob = await getOnboardingRenderedFormBlob(form);
      if (onboardingRenderedBlob) {
        openPdfBlobInNewTab(onboardingRenderedBlob, previewWindow);
        return;
      }

      const matchingCustomForm = getMatchingCustomFormForPdf(form);
      const tempAgreementCustomForm = getTempAgreementCustomFormForPdf(form);
      const isTempAgreementForm =
        !!tempAgreementCustomForm ||
        (!matchingCustomForm &&
          isTempAgreementPdfForm({
          form_name: form.form_name,
          display_name: form.display_name,
        }));
      let data: string;
      if (isTempAgreementForm) {
        const tempAgreementData = await getTempAgreementRenderData(form);
        const rebuiltFormData = tempAgreementData.signatureData?.trim()
          ? await rebuildTempAgreementFromTemplate(
              tempAgreementCustomForm?.id || matchingCustomForm?.id,
              tempAgreementData.formData
            )
          : tempAgreementData.formData;
        data = await withTempAgreementSignatureRedrawn(
          rebuiltFormData,
          tempAgreementData.signatureData,
          tempAgreementData.signatureType
        );
      } else {
        const isNoticeToEmployee = normalizeStandardOnboardingFormName(form.form_name) === 'notice-to-employee';
        const noticeRenderData = isNoticeToEmployee
          ? await getNoticeToEmployeeRenderData(form)
          : null;
        data = noticeRenderData?.formData || await getFormDataWithSignature(form);
        if (isNoticeToEmployee) {
          data = await rebuildNoticeToEmployeeFromTemplate({
            ...form,
            form_data: noticeRenderData?.formData || form.form_data,
          });
        }
      }
      const shouldEmbedProfileFields = !isTempAgreementForm;
      const employeeFullName = employee ? `${employee.first_name} ${employee.last_name}` : undefined;
      const isAttestationPdfForm = form.form_name.toLowerCase().includes('attestation');
      const isNoticeToEmployee = normalizeStandardOnboardingFormName(form.form_name) === 'notice-to-employee';
      const shouldEmbedVenueForForm = Boolean(venueName) && !(isNoticeToEmployee && !matchingCustomForm);
      const shouldEmbedOpeningPrintName = form.form_name.toLowerCase().includes('home-venue-assignment');
      if (
        shouldEmbedProfileFields &&
        form.form_date &&
        !isAttestationPdfForm &&
        !isNoticeToEmployee
      ) {
        data = await withDateEmbedded(data, form.form_date, form.form_name);
      }
      if (shouldEmbedProfileFields && isAttestationPdfForm && employeeFullName) {
        data = await withAttestationPrintNameEmbedded(data, employeeFullName);
      }
      if (shouldEmbedProfileFields && shouldEmbedVenueForForm && venueName) {
        data = await withVenueEmbedded(
          data,
          venueName,
          employeeFullName,
          shouldEmbedOpeningPrintName,
          form.form_name
        );
      }
      if (isNoticeToEmployee) {
        const noticeRenderData = await getNoticeToEmployeeRenderData(form);
        data = await withNoticeToEmployeeSignatureRedrawn(
          data,
          noticeRenderData.signatureData,
          noticeRenderData.signatureType
        );
      }
      openPdfInNewTab(data, previewWindow);
    } catch (error) {
      if (previewWindow && !previewWindow.closed) {
        previewWindow.close();
      }
      console.error('Error viewing PDF:', error);
      alert('Failed to open PDF form');
    }
  };

  // Download an I-9 document from storage
  const downloadI9Document = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error('Error downloading I-9 document:', error);
      alert('Failed to download document');
    }
  };

  // Download all documents (PDF forms + I-9 documents)
  const downloadAllDocuments = async () => {
    try {
      // Download all PDF forms
      for (const form of pdfForms) {
        await downloadPDFForm(form);
        // Small delay between downloads to avoid browser blocking
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Count and download I-9 documents if they exist
      let i9Count = 0;
      if (i9Documents) {
        if (i9Documents.drivers_license_url) {
          await downloadI9Document(i9Documents.drivers_license_url, i9Documents.drivers_license_filename || 'drivers_license');
          i9Count++;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (i9Documents.ssn_document_url) {
          await downloadI9Document(i9Documents.ssn_document_url, i9Documents.ssn_document_filename || 'ssn_card');
          i9Count++;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (i9Documents.additional_doc_url) {
          await downloadI9Document(i9Documents.additional_doc_url, i9Documents.additional_doc_filename || 'additional_document');
          i9Count++;
        }
      }

      const totalCount = pdfForms.length + i9Count;
      alert(`Downloaded ${totalCount} documents (${pdfForms.length} onboarding forms, ${i9Count} I-9 documents)`);
    } catch (error) {
      console.error('Error downloading all documents:', error);
      alert('Some documents may have failed to download');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="container mx-auto max-w-6xl py-10 px-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-semibold text-gray-900 keeping-tight">
              {employee ? (
                <>
                  {employee.first_name} {employee.last_name}
                </>
              ) : (
                "Worker Profile"
              )}
            </h1>
            <p className="text-gray-600 mt-1">
              Cumulative hours, shifts, and event history
            </p>
          </div>
        </div>

        {/* Loading & Error */}
        {loading && (
          <div className="apple-card">
            <div className="flex items-center justify-center py-16">
              <div className="apple-spinner" />
              <span className="ml-3 text-gray-600">Loading profile…</span>
            </div>
          </div>
        )}

        {err && !loading && (
          <div className="apple-alert apple-alert-error mb-6">
            {err}
          </div>
        )}

        {/* Profile + Stats */}
        {!loading && !err && employee && (
          <>
            {/* Top section */}
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              {/* Profile card */}
              <div className="apple-card p-8 bg-gradient-to-br from-white to-gray-50 border-2 border-gray-100">
                <div className="flex flex-col items-center text-center">
                  {employee.profile_photo_url ? (
                    <img
                      src={employee.profile_photo_url}
                      alt={`${employee.first_name} ${employee.last_name}`}
                      className="w-24 h-24 rounded-full object-cover border-4 border-white shadow-lg mb-4"
                      onError={(e) => {
                        const t = e.target as HTMLImageElement;
                        t.style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-3xl shadow-lg border-4 border-white mb-4">
                      {employee.first_name?.[0]}
                      {employee.last_name?.[0]}
                    </div>
                  )}

                  <h2 className="text-2xl font-bold text-gray-900 mb-1">
                    {employee.first_name} {employee.last_name}
                  </h2>

                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-lg mb-4">
                    <svg className="w-5 h-5 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                    </svg>
                    <span className="text-sm font-semibold text-blue-900">{employee.position}</span>
                    <span className="text-sm text-blue-600">•</span>
                    <span className="text-sm font-medium text-blue-700">{employee.department}</span>
                  </div>

                  <div className="w-full space-y-3 mb-4">
                    <div className="flex items-center justify-center gap-3 text-sm text-gray-600 bg-gray-50 rounded-lg py-2 px-4">
                      <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M16 2v4M8 2v4M3 10h18M5 22h14a2 2 0 002-2v-8H3v8a2 2 0 002 2z"/>
                      </svg>
                      <span className="font-medium">Hired:</span>
                      <span>{formatDate(employee.hire_date)}</span>
                    </div>

                    <div className="flex items-center justify-center gap-3 text-sm text-gray-600 bg-gray-50 rounded-lg py-2 px-4">
                      <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2z"/>
                      </svg>
                      <span className="truncate">{employee.email}</span>
                    </div>

                    {employee.phone && (
                      <div className="flex items-center justify-center gap-3 text-sm text-gray-600 bg-gray-50 rounded-lg py-2 px-4">
                        <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.95.69l1.5 4.49a1 1 0 01-.5 1.21l-2.26 1.13a11.04 11.04 0 005.52 5.52l1.13-2.26a1 1 0 011.21-.5l4.49 1.5a1 1 0 01.69.95V19a2 2 0 01-2 2h-1C9.72 21 3 14.28 3 6V5z"/>
                        </svg>
                        <span>{employee.phone}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-center gap-3 text-sm text-gray-600 bg-gray-50 rounded-lg py-2 px-4">
                      <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0L6.343 16.657a8 8 0 1111.314 0z"/>
                        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
                      </svg>
                      <span>{(employee.city && employee.state) ? `${employee.city}, ${employee.state}` : (employee.state || "—")}</span>
                    </div>

                  </div>

                  <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold shadow-sm ${
                    employee.status === "active"
                      ? "bg-green-100 text-green-700 border-2 border-green-200"
                      : employee.status === "on_leave"
                      ? "bg-yellow-100 text-yellow-700 border-2 border-yellow-200"
                      : "bg-gray-100 text-gray-700 border-2 border-gray-200"
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${
                      employee.status === "active" ? "bg-green-500" : employee.status === "on_leave" ? "bg-yellow-500" : "bg-gray-500"
                    }`}></span>
                    {employee.status === "active" ? "Active" : employee.status === "on_leave" ? "On Leave" : "Inactive"}
                  </span>
                </div>
              </div>

              {/* Stats cards */}
              <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-6 border-2 border-blue-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-4 mb-3">
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg">
                      <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                      </svg>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-blue-700">Total Hours</div>
                      <div className="text-xs text-blue-600">all time</div>
                    </div>
                  </div>
                  <div className="text-3xl font-bold text-blue-900">
                    {formatHours(summary?.total_hours ?? computed.totalHoursLocal)}
                  </div>
                </div>

                <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-6 border-2 border-green-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-4 mb-3">
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center shadow-lg">
                      <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                      </svg>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-green-700">Total Shifts</div>
                      <div className="text-xs text-green-600">clock-ins</div>
                    </div>
                  </div>
                  <div className="text-3xl font-bold text-green-900">
                    {summary?.total_shifts ?? entries.length}
                  </div>
                </div>

                <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-6 border-2 border-purple-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-4 mb-3">
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center shadow-lg">
                      <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
                      </svg>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-purple-700">Avg Hours / Shift</div>
                      <div className="text-xs text-purple-600">average</div>
                    </div>
                  </div>
                  <div className="text-3xl font-bold text-purple-900">
                    {(() => {
                      const h = summary?.total_hours ?? computed.totalHoursLocal;
                      const s = (summary?.total_shifts ?? entries.length) || 1;
                      return formatHours(h / s);
                    })()}
                  </div>
                </div>
              </div>
            </section>

            <KnowYourRightsNoticeSection state={employee?.state ?? undefined} />

            {/* Personal Calendar */}
            {(() => {
              const today = new Date();
              const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
              const firstDay = new Date(calYear, calMonth, 1).getDay(); // 0=Sun
              const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
              const monthName = new Date(calYear, calMonth, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
              const prevMonth = () => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); } else setCalMonth(m => m - 1); };
              const nextMonth = () => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); } else setCalMonth(m => m + 1); };
              const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({length: daysInMonth}, (_, i) => i + 1)];
              while (cells.length % 7 !== 0) cells.push(null);
              return (
                <section className="mb-8">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Calendar</h2>
                  </div>
                  <div className="apple-card p-4">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-4">
                      <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-600">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
                      </button>
                      <span className="font-semibold text-gray-800 text-sm">{monthName}</span>
                      <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-600">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                      </button>
                    </div>
                    {/* Day labels */}
                    <div className="grid grid-cols-7 mb-1">
                      {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
                        <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
                      ))}
                    </div>
                    {/* Day cells */}
                    <div className="grid grid-cols-7 gap-y-1">
                      {cells.map((day, i) => {
                        if (!day) return <div key={i} />;
                        const dateStr = `${calYear}-${String(calMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
                        const dots = calDots.get(dateStr);
                        const evs = calEventDetails.get(dateStr) ?? [];
                        const regionEvs = calRegionEventDetails.get(dateStr) ?? [];
                        const isToday = dateStr === todayStr;
                        const hasAvailableSubmission = dots?.has("available");
                        const hasUnavailableSubmission = dots?.has("unavailable");
                        const availabilityLabel = hasAvailableSubmission
                          ? "Available"
                          : hasUnavailableSubmission
                            ? "Unavailable"
                            : null;
                        return (
                          <div key={i} className="flex flex-col items-center py-1 px-0.5 min-h-[3.5rem]">
                            <div className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-medium shrink-0
                              ${isToday ? "bg-blue-600 text-white" : "text-gray-700 hover:bg-gray-100"}`}>
                              {day}
                            </div>
                            {availabilityLabel && (
                              <div
                                className={`mt-0.5 px-1 rounded text-[9px] font-semibold leading-tight ${
                                  hasAvailableSubmission
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-rose-100 text-rose-800"
                                }`}
                              >
                                {availabilityLabel}
                              </div>
                            )}
                            {evs.map((ev, ei) => (
                              <div key={ei} className="mt-0.5 w-full text-center">
                                <div className="bg-blue-100 text-blue-800 rounded text-[9px] font-medium leading-tight px-0.5 truncate">
                                  {ev.name}
                                </div>
                                {ev.start_time && (
                                  <div className="text-[9px] text-blue-500 leading-tight">
                                    {formatEventTime(ev.start_time)}
                                  </div>
                                )}
                              </div>
                            ))}
                            {regionEvs.map((ev, ei) => (
                              <div key={`r${ei}`} className="mt-0.5 w-full text-center">
                                <div className="bg-violet-100 text-violet-800 rounded text-[9px] font-medium leading-tight px-0.5 truncate">
                                  {ev.name}
                                </div>
                                {ev.start_time && (
                                  <div className="text-[9px] text-violet-500 leading-tight">
                                    {formatEventTime(ev.start_time)}
                                  </div>
                                )}
                              </div>
                            ))}
                            {dots && (dots.has("shift") || dots.has("sick")) && (
                              <div className="flex gap-0.5 mt-0.5">
                                {dots.has("shift") && <span className="w-1.5 h-1.5 rounded-full bg-cyan-500" />}
                                {dots.has("sick")  && <span className="w-1.5 h-1.5 rounded-full bg-pink-500" />}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* Legend */}
                    <div className="flex flex-wrap gap-4 mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500">
                      <span className="flex items-center gap-1"><span className="px-1 rounded bg-blue-100 text-blue-800 text-[10px] font-semibold">Event</span>My events</span>
                      <span className="flex items-center gap-1"><span className="px-1 rounded bg-violet-100 text-violet-800 text-[10px] font-semibold">Event</span>Region events</span>
                      <span className="flex items-center gap-1"><span className="px-1 rounded bg-emerald-100 text-emerald-800 text-[10px] font-semibold">Available</span>Submitted availability</span>
                      <span className="flex items-center gap-1"><span className="px-1 rounded bg-rose-100 text-rose-800 text-[10px] font-semibold">Unavailable</span>Submitted availability</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-500 inline-block"/>Shift</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-pink-500 inline-block"/>Sick leave</span>
                    </div>
                    {availabilityLastSubmittedAt && (
                      <div className="mt-2 text-xs text-gray-500">
                        Latest availability submission: {formatDateTime(availabilityLastSubmittedAt)}
                      </div>
                    )}
                  </div>
                </section>
              );
            })()}

            {/* Events & Time — combined */}
            <section className="mb-10">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Events Recap</h2>
              </div>
              <div className="apple-card overflow-hidden">
                {invitationsLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <div className="apple-spinner" />
                    <span className="ml-3 text-gray-600">Loading…</span>
                  </div>
                ) : (() => {
                  // Build lookup: event_id → per_event row
                  const perEventMap = new Map((summary?.per_event ?? []).map(r => [r.event_id, r]));
                  // Events with time entries but no team invitation (manually entered via self-timesheet)
                  const invitedEventIds = new Set(eventInvitations.map(inv => inv.event_id));
                  const orphanedPerEvents = (summary?.per_event ?? []).filter(r =>
                    r.event_id && r.event_id !== "unknown" && !invitedEventIds.has(r.event_id) && r.is_team_member === false
                  );
                  // Build lookup: event_id → time entries[]
                  const entriesByEvent = new Map<string, typeof entries>();
                  entries.forEach(e => {
                    const key = e.event_id ?? "__none__";
                    if (!entriesByEvent.has(key)) entriesByEvent.set(key, []);
                    entriesByEvent.get(key)!.push(e);
                  });
                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="text-left p-3 font-semibold text-gray-700 text-sm">Event</th>
                            <th className="text-left p-3 font-semibold text-gray-700 text-sm">Date</th>
                            <th className="text-left p-3 font-semibold text-gray-700 text-sm">Venue</th>
                            <th className="text-left p-3 font-semibold text-gray-700 text-sm">Status</th>
                            <th className="text-left p-3 font-semibold text-gray-700 text-sm">Shifts</th>
                            <th className="text-left p-3 font-semibold text-gray-700 text-sm">Hours</th>
                            <th className="text-left p-3 font-semibold text-gray-700 text-sm">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {eventInvitations.length === 0 && orphanedPerEvents.length === 0 && (entriesByEvent.get("__none__") ?? []).length === 0 && (
                            <tr>
                              <td colSpan={7} className="p-6 text-center text-gray-500">No event invitations yet.</td>
                            </tr>
                          )}
                          {eventInvitations.map((inv) => {
                            const agg = perEventMap.get(inv.event_id);
                            const eventEntries = entriesByEvent.get(inv.event_id) ?? [];
                            return (
                              <>
                                {/* Event row */}
                                <tr key={`inv-${inv.source}-${inv.id}`} className="border-t border-gray-200 bg-white hover:bg-gray-50 transition-colors">
                                  <td className="p-3 font-semibold text-gray-900">{inv.event_name || inv.event_id}</td>
                                  <td className="p-3 text-gray-700 text-sm">
                                    <div>{formatEventDate(inv.event_date)}</div>
                                    {formatEventTime(inv.start_time) && (
                                      <div className="text-gray-400 text-xs">{formatEventTime(inv.start_time)}</div>
                                    )}
                                  </td>
                                  <td className="p-3 text-gray-600 text-sm">
                                    {[inv.venue, inv.city, inv.state].filter(Boolean).join(", ") || "—"}
                                  </td>
                                  <td className="p-3">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                                      inv.status === "confirmed" ? "bg-green-50 text-green-700 border-green-200"
                                      : inv.status === "declined" ? "bg-red-50 text-red-700 border-red-200"
                                      : inv.status === "completed" ? "bg-gray-100 text-gray-600 border-gray-200"
                                      : "bg-yellow-50 text-yellow-700 border-yellow-200"
                                    }`}>
                                      {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                                    </span>
                                  </td>
                                  <td className="p-3 text-gray-900 text-sm font-medium">{agg?.shifts ?? 0}</td>
                                  <td className="p-3 text-gray-900 text-sm font-medium">{formatHours(agg?.hours ?? 0)}</td>
                                  <td className="p-3 flex flex-wrap gap-1.5 items-center">
                                    {inv.source === "team" && inv.confirmation_token && (inv.status === "pending_confirmation" || inv.status === "pending") && (
                                      <Link href={`/team-confirmation/${inv.confirmation_token}`}
                                        className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors">
                                        Confirm Participation
                                      </Link>
                                    )}
                                    {renderTimeSheetAction(
                                      inv.event_id,
                                      agg?.timesheet_attestation_status,
                                      agg?.timesheet_edit_request_status,
                                      inv.event_name || inv.event_id
                                    )}
                                  </td>
                                </tr>
                                {/* Time entry sub-rows */}
                                {eventEntries.map(e => (
                                  <tr key={`entry-${e.id}`} className="bg-gray-50 border-t border-gray-100">
                                    <td className="pl-8 pr-3 py-2">
                                      <span className="text-gray-400 text-xs">↳ Shift</span>
                                    </td>
                                    <td className="px-3 py-2">
                                      <div className="text-xs text-gray-500 font-medium">Clock In</div>
                                      <div className="text-xs text-gray-800">{formatDateTime(e.clock_in, inv.state)}</div>
                                    </td>
                                    <td className="px-3 py-2">
                                      <div className="text-xs text-gray-500 font-medium">Clock Out</div>
                                      <div className="text-xs text-gray-800">{formatDateTime(e.clock_out, inv.state)}</div>
                                    </td>
                                    <td className="px-3 py-2" />
                                    <td className="px-3 py-2" />
                                    <td className="px-3 py-2 text-gray-900 text-xs font-medium">
                                      {e.duration_hours != null ? formatHours(e.duration_hours) : "—"}
                                    </td>
                                    <td className="px-3 py-2" />
                                  </tr>
                                ))}
                              </>
                            );
                          })}
                          {/* Events with time entries but no formal team invitation (e.g. manually entered via self-timesheet) */}
                          {orphanedPerEvents.map((ev) => {
                            const eventEntries = entriesByEvent.get(ev.event_id!) ?? [];
                            const isNonEvent = ev.event_type === "special";
                            return (
                              <>
                                <tr key={`orphan-${ev.event_id}`} className="border-t border-gray-200 bg-white hover:bg-gray-50 transition-colors">
                                  <td className="p-3 font-semibold text-gray-900">
                                    <span>{ev.event_name || ev.event_id}</span>
                                    {isNonEvent && (
                                      <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">Non-Event</span>
                                    )}
                                  </td>
                                  <td className="p-3 text-gray-700 text-sm">{formatEventDate(ev.event_date)}</td>
                                  <td className="p-3 text-gray-600 text-sm">{ev.venue || "—"}</td>
                                  <td className="p-3">
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-gray-100 text-gray-600 border-gray-200">
                                      Recorded
                                    </span>
                                  </td>
                                  <td className="p-3 text-gray-900 text-sm font-medium">{ev.shifts}</td>
                                  <td className="p-3 text-gray-900 text-sm font-medium">{formatHours(ev.hours)}</td>
                                  <td className="p-3">
                                    {renderTimeSheetAction(
                                      ev.event_id,
                                      ev.timesheet_attestation_status,
                                      ev.timesheet_edit_request_status,
                                      ev.event_name || ev.event_id || "this event"
                                    )}
                                  </td>
                                </tr>
                                {eventEntries.map(e => (
                                  <tr key={`orphan-entry-${e.id}`} className="bg-gray-50 border-t border-gray-100">
                                    <td className="pl-8 pr-3 py-2">
                                      <span className="text-gray-400 text-xs">↳ Shift</span>
                                    </td>
                                    <td className="px-3 py-2">
                                      <div className="text-xs text-gray-500 font-medium">Clock In</div>
                                      <div className="text-xs text-gray-800">{formatDateTime(e.clock_in, null)}</div>
                                    </td>
                                    <td className="px-3 py-2">
                                      <div className="text-xs text-gray-500 font-medium">Clock Out</div>
                                      <div className="text-xs text-gray-800">{formatDateTime(e.clock_out, null)}</div>
                                    </td>
                                    <td className="px-3 py-2" />
                                    <td className="px-3 py-2" />
                                    <td className="px-3 py-2 text-gray-900 text-xs font-medium">
                                      {e.duration_hours != null ? formatHours(e.duration_hours) : "—"}
                                    </td>
                                    <td className="px-3 py-2" />
                                  </tr>
                                ))}
                              </>
                            );
                          })}
                          {/* Non-event time entries (no associated event) */}
                          {(() => {
                            const nonEventEntries = entriesByEvent.get("__none__") ?? [];
                            if (nonEventEntries.length === 0) return null;
                            const totalHours = nonEventEntries.reduce((sum, e) => sum + (e.duration_hours ?? hoursBetween(e.clock_in, e.clock_out)), 0);
                            return (
                              <>
                                <tr className="border-t border-gray-200 bg-white hover:bg-gray-50 transition-colors">
                                  <td className="p-3 font-semibold text-gray-900">Non-Event Time</td>
                                  <td className="p-3 text-gray-400 text-sm">—</td>
                                  <td className="p-3 text-gray-400 text-sm">—</td>
                                  <td className="p-3">
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-purple-50 text-purple-700 border-purple-200">
                                      Non-Event
                                    </span>
                                  </td>
                                  <td className="p-3 text-gray-900 text-sm font-medium">{nonEventEntries.length}</td>
                                  <td className="p-3 text-gray-900 text-sm font-medium">{formatHours(totalHours)}</td>
                                  <td className="p-3"><span className="text-gray-400 text-xs">—</span></td>
                                </tr>
                                {nonEventEntries.map(e => (
                                  <tr key={`ne-entry-${e.id}`} className="bg-gray-50 border-t border-gray-100">
                                    <td className="pl-8 pr-3 py-2">
                                      <span className="text-gray-400 text-xs">↳ Shift</span>
                                    </td>
                                    <td className="px-3 py-2">
                                      <div className="text-xs text-gray-500 font-medium">Clock In</div>
                                      <div className="text-xs text-gray-800">{formatDateTime(e.clock_in, null)}</div>
                                    </td>
                                    <td className="px-3 py-2">
                                      <div className="text-xs text-gray-500 font-medium">Clock Out</div>
                                      <div className="text-xs text-gray-800">{formatDateTime(e.clock_out, null)}</div>
                                    </td>
                                    <td className="px-3 py-2" />
                                    <td className="px-3 py-2" />
                                    <td className="px-3 py-2 text-gray-900 text-xs font-medium">
                                      {e.duration_hours != null ? formatHours(e.duration_hours) : "—"}
                                    </td>
                                    <td className="px-3 py-2" />
                                  </tr>
                                ))}
                              </>
                            );
                          })()}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            </section>

            {/* Sick Leave Summary */}
            <section className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Sick Leave</h2>
                <span className="text-sm text-gray-500">
                  {sickLeaveRequestCount} request{sickLeaveRequestCount === 1 ? "" : "s"}
                </span>
              </div>
              <div className="apple-card p-4 space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-100">
                    <div className="text-xs font-medium text-emerald-700">Total Hours Worked</div>
                    <div className="text-xl font-bold text-emerald-900">{formatHours(summary?.total_hours ?? 0)} hrs</div>
                  </div>
                  <div className="bg-violet-50 rounded-lg p-3 border border-violet-100">
                    <div className="text-xs font-medium text-violet-700">Carry Over</div>
                    <div className="text-xl font-bold text-violet-900">{formatHours(sickLeaveCarryOverHours)} hrs</div>
                  </div>
                  <div className="bg-indigo-50 rounded-lg p-3 border border-indigo-100">
                    <div className="text-xs font-medium text-indigo-700">Earned</div>
                    <div className="text-xl font-bold text-indigo-900">{formatHours(sickLeaveEarnedOnlyHours)} hrs</div>
                  </div>
                  <div className="bg-pink-50 rounded-lg p-3 border border-pink-100">
                    <div className="text-xs font-medium text-pink-700">Used</div>
                    <div className="text-xl font-bold text-pink-900">{formatHours(sickLeaveTotalHours)} hrs</div>
                  </div>
                  <div className="bg-amber-50 rounded-lg p-3 border border-amber-100">
                    <div className="text-xs font-medium text-amber-700">Balance</div>
                    <div className="text-xl font-bold text-amber-900">{formatHours(sickLeaveBalanceHours)} hrs</div>
                  </div>
                </div>

                <p className="text-xs text-gray-400">1 hr earned per 30 hrs worked</p>
                <p className="text-xs text-amber-600 font-medium">Maximum sick leave allowed is 48 hours per year.</p>

                <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                  <p className="text-sm font-semibold text-blue-900 mb-2">Request Sick Leave</p>

                  <form onSubmit={submitSickLeaveRequest} className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div>
                      <label
                        htmlFor="sick-request-hours"
                        className="mb-1 block text-xs font-semibold uppercase keeping-wide text-blue-900"
                      >
                        Sick Leave Hours
                      </label>
                      <input
                        id="sick-request-hours"
                        type="number"
                        inputMode="decimal"
                        min="0.25"
                        max="24"
                        step="0.25"
                        required
                        value={sickRequestHours}
                        onChange={(event) => setSickRequestHours(event.target.value)}
                        placeholder="0"
                        className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="sick-request-date"
                        className="mb-1 block text-xs font-semibold uppercase keeping-wide text-blue-900"
                      >
                        Date
                      </label>
                      <input
                        id="sick-request-date"
                        type="date"
                        required
                        value={sickRequestDate}
                        onChange={(event) => setSickRequestDate(event.target.value)}
                        className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none"
                      />
                    </div>

                    <div className="flex items-end">
                      <button
                        type="submit"
                        disabled={submittingSickRequest}
                        className="inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                      >
                        {submittingSickRequest ? "Sending..." : "Send Request"}
                      </button>
                    </div>
                  </form>

                  {sickRequestError && (
                    <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
                      {sickRequestError}
                    </div>
                  )}
                  {sickRequestSuccess && (
                    <div className="mt-2 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs text-green-700">
                      {sickRequestSuccess}
                    </div>
                  )}
                </div>

                {sickLeaveEntries.length === 0 ? (
                  <div className="text-center py-4 text-sm text-gray-400">
                    No sick leave records yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sickLeaveEntries.map((entry) => {
                      const normalizedStatus = (entry.status ?? "pending").toLowerCase() as SickLeaveStatus;
                      const statusClasses =
                        sickLeaveStatusStyles[normalizedStatus] ?? fallbackSickLeaveStatusStyle;
                      return (
                        <div key={entry.id} className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm">
                          <div className="flex items-center gap-4 text-gray-700">
                            <span className="font-medium text-gray-900">{formatDate(entry.start_date)} — {formatDate(entry.end_date)}</span>
                            <span className="text-gray-500">{formatHours(entry.duration_hours)} hrs</span>
                            {entry.reason && <span className="text-gray-400 text-xs">{entry.reason}</span>}
                          </div>
                          <span className={`px-2 py-0.5 text-xs font-semibold capitalize border rounded-full ${statusClasses}`}>
                            {entry.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            {/* I-9 Documents */}
            <section className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">I-9 Documentation</h2>
              </div>
              <div className="apple-card p-6">
                {i9Loading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="apple-spinner" />
                    <span className="ml-3 text-gray-600">Loading documents…</span>
                  </div>
                ) : !i9Documents ? (
                  <div className="text-center py-8">
                    <svg className="w-16 h-16 mx-auto text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-gray-500 font-medium">No I-9 documents uploaded yet</p>
                    <p className="text-sm text-gray-400 mt-1">Worker has not completed I-9 verification</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* List B — Identity Document */}
                    <div className="border border-gray-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-md transition-all">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                            i9Documents.drivers_license_url
                              ? 'bg-green-100 text-green-600'
                              : 'bg-gray-100 text-gray-400'
                          }`}>
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                            </svg>
                          </div>
                          <div>
                            <h3 className="font-semibold text-gray-900">List B — Identity Document</h3>
                            <p className="text-sm text-gray-500">e.g. Driver's License, State ID</p>
                          </div>
                        </div>
                        {i9Documents.drivers_license_url && (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            Uploaded
                          </span>
                        )}
                      </div>
                      {i9Documents.drivers_license_url ? (
                        <div className="space-y-2">
                          <div className="flex items-center text-sm text-gray-600">
                            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="truncate">{i9Documents.drivers_license_filename || 'document'}</span>
                          </div>
                          {i9Documents.drivers_license_uploaded_at && (
                            <div className="flex items-center text-sm text-gray-500">
                              <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              {formatDate(i9Documents.drivers_license_uploaded_at)}
                            </div>
                          )}
                          <div className="flex gap-2 mt-3">
                            <a
                              href={i9Documents.drivers_license_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                              View
                            </a>
                            <button
                              onClick={() => downloadI9Document(i9Documents.drivers_license_url!, i9Documents.drivers_license_filename || 'drivers_license')}
                              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-sm font-medium"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              Download
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400 italic">Not uploaded</p>
                      )}
                    </div>

                    {/* List C — Work Authorization */}
                    <div className="border border-gray-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-md transition-all">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                            i9Documents.ssn_document_url
                              ? 'bg-green-100 text-green-600'
                              : 'bg-gray-100 text-gray-400'
                          }`}>
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          </div>
                          <div>
                            <h3 className="font-semibold text-gray-900">List C — Work Authorization</h3>
                            <p className="text-sm text-gray-500">e.g. Social Security Card, Birth Certificate</p>
                          </div>
                        </div>
                        {i9Documents.ssn_document_url && (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            Uploaded
                          </span>
                        )}
                      </div>
                      {i9Documents.ssn_document_url ? (
                        <div className="space-y-2">
                          <div className="flex items-center text-sm text-gray-600">
                            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="truncate">{i9Documents.ssn_document_filename || 'document'}</span>
                          </div>
                          {i9Documents.ssn_document_uploaded_at && (
                            <div className="flex items-center text-sm text-gray-500">
                              <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              {formatDate(i9Documents.ssn_document_uploaded_at)}
                            </div>
                          )}
                          <div className="flex gap-2 mt-3">
                            <a
                              href={i9Documents.ssn_document_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                              View
                            </a>
                            <button
                              onClick={() => downloadI9Document(i9Documents.ssn_document_url!, i9Documents.ssn_document_filename || 'ssn_card')}
                              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-sm font-medium"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              Download
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400 italic">Not uploaded</p>
                      )}
                    </div>

                    {/* List A — Identity & Work Authorization */}
                    <div className="border border-gray-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-md transition-all md:col-span-2">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                            i9Documents.additional_doc_url
                              ? 'bg-blue-100 text-blue-600'
                              : 'bg-gray-100 text-gray-400'
                          }`}>
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                          </div>
                          <div>
                            <h3 className="font-semibold text-gray-900">List A — Identity &amp; Work Authorization</h3>
                            <p className="text-sm text-gray-500">e.g. Passport, Permanent Resident Card</p>
                          </div>
                        </div>
                        {i9Documents.additional_doc_url && (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                            <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            Uploaded
                          </span>
                        )}
                      </div>
                      {i9Documents.additional_doc_url ? (
                        <div className="space-y-2">
                          <div className="flex items-center text-sm text-gray-600">
                            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="truncate">{i9Documents.additional_doc_filename || 'document'}</span>
                          </div>
                          {i9Documents.additional_doc_uploaded_at && (
                            <div className="flex items-center text-sm text-gray-500">
                              <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              {formatDate(i9Documents.additional_doc_uploaded_at)}
                            </div>
                          )}
                          <div className="flex gap-2 mt-3">
                            <a
                              href={i9Documents.additional_doc_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                              View
                            </a>
                            <button
                              onClick={() => downloadI9Document(i9Documents.additional_doc_url!, i9Documents.additional_doc_filename || 'list_a_document')}
                              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-sm font-medium"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              Download
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400 italic">Not uploaded</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Onboarding PDF Forms */}
            <section className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Onboarding Forms</h2>
                <div className="flex items-center gap-2">
                  {(pdfForms.length > 0 || i9Documents) && (
                    <button
                      onClick={downloadAllDocuments}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download All Documents
                    </button>
                  )}
                </div>
              </div>
              <div className="apple-card p-6">
                {pdfLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="apple-spinner" />
                    <span className="ml-3 text-gray-600">Loading forms…</span>
                  </div>
                ) : (pdfForms.length === 0) ? (
                  <div className="text-center py-8">
                    <svg className="w-16 h-16 mx-auto text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-gray-500 font-medium">No onboarding forms submitted yet</p>
                    <p className="text-sm text-gray-400 mt-1">This section shows user rows from `pdf_form_progress`.</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Filled Forms Section */}
                    {pdfForms.length > 0 && (
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-700 text-xs font-bold">
                            {pdfForms.length}
                          </span>
                          Completed Forms
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {pdfForms.map((form) => (
                            <div
                              key={form.id || form.form_name}
                              className="border border-green-200 bg-green-50 rounded-xl p-4 hover:border-green-300 hover:shadow-md transition-all"
                            >
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-lg bg-green-500 text-white flex items-center justify-center flex-shrink-0">
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                  </div>
                                  <div>
                                    <h3 className="font-semibold text-gray-900 text-sm">{form.display_name}</h3>
                                    <p className="text-xs text-green-700">Filled & Submitted</p>
                                  </div>
                                </div>
                              </div>
                              <div className="space-y-2">
                                <div className="flex items-center text-xs text-gray-500">
                                  <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  {formatDate(form.updated_at)}
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => viewPDFForm(form)}
                                    className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
                                  >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                    </svg>
                                    View
                                  </button>
                                  <button
                                    onClick={() => downloadPDFForm(form)}
                                    className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                                  >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                    Download
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>
                )}
              </div>
            </section>

            {/* Custom PDF Forms */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 keeping-tight mb-3">Custom Forms</h2>
              <div className="apple-card p-6">
                {customFormsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="apple-spinner" />
                    <span className="ml-3 text-gray-600">Loading custom forms…</span>
                  </div>
                ) : customFormsList.length === 0 ? (
                  <div className="text-center py-8">
                    <svg className="w-16 h-16 mx-auto text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-gray-500 font-medium">No custom forms uploaded yet</p>
                    <p className="text-sm text-gray-400 mt-1">
                      Upload forms at{' '}
                      <Link href="/admin/pdf-forms" className="text-blue-600 hover:underline">/admin/pdf-forms</Link>
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {customFormsList.map((form) => {
                      const submitted = pdfForms.find((p) => matchesCustomFormSubmission(p, form));
                      const isDirectlyAssigned = assignedFormIds.has(form.id);
                      const venueForForm =
                        submitted &&
                        !submitted.form_name.includes('home-venue-assignment') &&
                        employeeHomeVenue &&
                        form.allow_venue_display &&
                        !isCaTempAgreementCustomFormTitle(form.title)
                          ? employeeHomeVenue.venue_name
                          : undefined;
                      return (
                        <div
                          key={form.id}
                          className={`border rounded-xl p-4 hover:shadow-md transition-all ${
                            submitted
                              ? 'border-green-200 bg-green-50'
                              : 'border-amber-200 bg-amber-50'
                          }`}
                        >
                          <div className="flex items-start gap-3 mb-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                              submitted ? 'bg-green-500 text-white' : 'bg-amber-400 text-white'
                            }`}>
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                {submitted ? (
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                ) : (
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                )}
                              </svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold text-gray-900 text-sm truncate">{form.title}</h3>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {isDirectlyAssigned && (
                                  <span className="text-xs font-medium text-purple-700 bg-purple-100 border border-purple-200 rounded-full px-2 py-0.5">
                                    Assigned
                                  </span>
                                )}
                                {form.created_at && (
                                  <span className="text-xs font-medium text-gray-600 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5">
                                    Distribution Date: {formatDate(form.created_at)}
                                  </span>
                                )}
                                {form.requires_signature && (
                                  <span className="text-xs font-medium text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5">
                                    Sig. required
                                  </span>
                                )}
                                {form.target_region && (
                                  <span className="text-xs font-medium text-teal-700 bg-teal-100 border border-teal-200 rounded-full px-2 py-0.5">
                                    Region restricted
                                  </span>
                                )}
                                <span className={`text-xs font-medium rounded-full px-2 py-0.5 border ${
                                  submitted
                                    ? 'text-green-700 bg-green-100 border-green-200'
                                    : 'text-amber-700 bg-amber-100 border-amber-200'
                                }`}>
                                  {submitted ? `Submitted ${formatDate(submitted.updated_at)}` : 'Pending'}
                                </span>
                                {submitted?.form_date && (
                                  <span className="text-xs font-medium text-purple-700 bg-purple-100 border border-purple-200 rounded-full px-2 py-0.5">
                                    Date: {formatDate(submitted.form_date)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {submitted ? (
                              <>
                                <button
                                  onClick={() => viewPDFForm(submitted, venueForForm)}
                                  className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-xs font-medium"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                  </svg>
                                  View
                                </button>
                                <button
                                  onClick={() => downloadPDFForm(submitted, venueForForm)}
                                  className="inline-flex items-center justify-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-xs font-medium"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                  </svg>
                                  Download
                                </button>
                              </>
                            ) : (
                              <Link
                                href={`/employee/form/${form.id}?asUser=${employeeId}`}
                                className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-medium"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                                Fill Out Form
                              </Link>
                            )}
                          </div>
                          {/* Supporting documents uploaded with this form */}
                          {submitted &&
                            isI9PdfForm({
                              form_name: submitted.form_name,
                              display_name: form.title,
                            }) &&
                            customFormDocs[form.id]?.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-green-200">
                              <p className="text-xs font-semibold text-gray-500 mb-1.5">Supporting Documents</p>
                              <div className="space-y-1">
                                {customFormDocs[form.id].map(doc => (
                                  <div key={doc.slot} className="flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="text-xs text-gray-400 leading-none">{doc.label}</p>
                                      <p className="text-xs text-gray-700 font-medium truncate">{doc.filename}</p>
                                    </div>
                                    {doc.url && (
                                      <a href={doc.url} target="_blank" rel="noopener noreferrer"
                                        className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-800 px-2 py-0.5 rounded hover:bg-blue-50 border border-blue-200 transition-colors">
                                        View
                                      </a>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

          {/* Paystub Distribution History */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <h2 className="text-base font-semibold text-gray-900">My Paystubs</h2>
                {!paystubHistoryLoading && !paystubHistoryError && (
                  <span className="ml-auto text-xs text-gray-400">{paystubHistory.length} record{paystubHistory.length !== 1 ? "s" : ""}</span>
                )}
              </div>
              <div className="divide-y divide-gray-50">
                {paystubHistoryLoading ? (
                  <div className="px-6 py-4 text-sm text-gray-400">Loading...</div>
                ) : paystubHistoryError ? (
                  <div className="px-6 py-4 text-sm text-red-600">
                    Could not load paystubs: {paystubHistoryError}
                  </div>
                ) : paystubHistory.length === 0 ? (
                  <div className="px-6 py-8 text-center text-sm text-gray-400">No paystubs distributed yet.</div>
                ) : (
                  paystubHistory.map((entry) => (
                    <div key={entry.id} className="px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                      {/* Status badge */}
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border shrink-0 ${
                        entry.status === "sent"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-red-50 text-red-700 border-red-200"
                      }`}>
                        {entry.status === "sent" ? "Distributed" : "Failed"}
                      </span>

                      {/* Pay date / period */}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {entry.pay_date
                            ? `Pay date: ${formatEventDate(entry.pay_date)}`
                            : "Pay date not recorded"}
                        </p>
                        {(entry.pay_period_start || entry.pay_period_end) && (
                          <p className="text-xs text-gray-500 mt-0.5">
                            Period: {formatEventDate(entry.pay_period_start)} - {formatEventDate(entry.pay_period_end)}
                          </p>
                        )}
                        {entry.status === "failed" && entry.error_message && (
                          <p className="text-xs text-red-600 mt-0.5">{entry.error_message}</p>
                        )}
                      </div>

                      {/* Right-side meta + download */}
                      <div className="text-right shrink-0 space-y-1">
                        <p className="text-xs text-gray-400">
                          By {entry.triggered_by_email ?? "unknown"} - {entry.distribution_mode === "batch" ? "batch" : "single"}
                        </p>
                        <p className="text-xs text-gray-400">
                          {new Date(entry.sent_at).toLocaleString(undefined, {
                            month: "short", day: "numeric", year: "numeric",
                            hour: "numeric", minute: "2-digit", hour12: true,
                          })}
                        </p>
                        {entry.pdf_storage_path && (
                          <button
                            onClick={() => downloadPaystub(entry.id, `paystub-${entry.pay_date ?? "unknown"}.pdf`)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            Download PDF
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

          {/* Uploaded Emails */}
          {uploadedEmails.length > 0 && (
            <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-base font-semibold text-gray-900">Uploaded Emails</h2>
              </div>
              <div className="p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {uploadedEmails.map((img) => (
                  <a key={img.name} href={img.url} target="_blank" rel="noopener noreferrer"
                    className="group block rounded-xl overflow-hidden border border-gray-100 hover:shadow-md transition-shadow">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt={img.name}
                      className="w-full h-32 object-cover"
                    />
                    <div className="px-2 py-1.5 bg-gray-50">
                      <p className="text-xs text-gray-500">
                        {new Date(img.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Non-Event Timesheets */}
          {(() => {
            const nonEventSheets = (summary?.per_event ?? []).filter(e => e.event_type === "special" && e.event_id);
            if (nonEventSheets.length === 0) return null;
            return (
              <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
                  <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <h2 className="text-base font-semibold text-gray-900">Non-Event Timesheets</h2>
                  <span className="ml-auto text-xs text-gray-400">{nonEventSheets.length} sheet{nonEventSheets.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {nonEventSheets.map((sheet) => (
                    <div key={sheet.event_id} className="px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900">{sheet.event_name || sheet.event_id}</p>
                        {sheet.event_date && (
                          <p className="text-xs text-gray-500 mt-0.5">{formatEventDate(sheet.event_date)}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-gray-500">{sheet.shifts} shift{sheet.shifts !== 1 ? "s" : ""}</span>
                          <span className="text-xs text-gray-400">·</span>
                          <span className="text-xs text-gray-500">{formatHours(sheet.hours)} hrs</span>
                        </div>
                      </div>
                      {renderTimeSheetAction(
                        sheet.event_id,
                        sheet.timesheet_attestation_status,
                        sheet.timesheet_edit_request_status,
                        sheet.event_name || sheet.event_id || "this event",
                        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 transition-colors shrink-0"
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })()}

          {timesheetEditRequestTarget && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
              onClick={() => {
                if (submittingTimesheetEditRequest) return;
                setTimesheetEditRequestTarget(null);
                setTimesheetEditRequestReason("");
                setTimesheetEditRequestError("");
              }}
            >
              <div
                className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="border-b border-gray-200 px-6 py-4">
                  <h3 className="text-lg font-semibold text-gray-900">Request Timesheet Edit</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Submit a correction request for <span className="font-medium text-gray-700">{timesheetEditRequestTarget.eventName}</span>.
                  </p>
                </div>

                <div className="space-y-4 px-6 py-5">
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    The attested timesheet will stay locked until a manager or exec reviews this request in the event dashboard.
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">
                      Reason for edit <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={timesheetEditRequestReason}
                      onChange={(e) => setTimesheetEditRequestReason(e.target.value)}
                      rows={5}
                      placeholder="Describe what needs to be corrected in this timesheet..."
                      className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    />
                  </div>

                  {timesheetEditRequestError && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {timesheetEditRequestError}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
                  <button
                    type="button"
                    onClick={() => {
                      setTimesheetEditRequestTarget(null);
                      setTimesheetEditRequestReason("");
                      setTimesheetEditRequestError("");
                    }}
                    disabled={submittingTimesheetEditRequest}
                    className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitTimesheetEditRequest()}
                    disabled={submittingTimesheetEditRequest}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submittingTimesheetEditRequest ? "Sending..." : "Send Request"}
                  </button>
                </div>
              </div>
            </div>
          )}

          </>
        )}

      </div>
    </div>
  );
}
