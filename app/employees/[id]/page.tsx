// app/employees/[id]/page.tsx
"use client";

import { FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from "react";
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
import { stampHomeVenueAssignmentLayout } from "@/app/lib/home-venue-pdf-layout";
import { renderCustomFormInputsOnDetectedLines } from "@/app/lib/custom-form-line-renderer";
import { getKnownCustomFlatFormLayout } from "@/app/lib/custom-flat-form-layout";
import { getTimezoneForState, toZonedIso } from "@/lib/timezones";

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
  division?: string | null;
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
  event_id: string | null;
  event_name: string | null;
  event_date: string | null;
  start_date: string | null;
  end_date: string | null;
  duration_hours: number;
  status: string;
  reason: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string | null;
};

type SickLeavePaysheet = {
  id: string;
  hours: number;
  rate: number;
  amount: number;
  payment_date: string | null;
  status: string;
  notes: string | null;
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
  paysheets?: SickLeavePaysheet[];
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

type EmailLogEntry = {
  id: string;
  subject: string;
  html_body: string;
  from_address: string;
  recipient_email: string;
  recipient_type: "to" | "cc";
  status: "sent" | "failed";
  error_message: string | null;
  provider_message_id: string | null;
  created_at: string;
  read_at: string | null;
  read_by: string | null;
  sender_user_id?: string | null;
  in_reply_to_id?: string | null;
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
  end_date: string | null;
  start_time: string | null;
  venue: string | null;
  city: string | null;
  state: string | null;
  status: string;
  source: "team" | "location";
  location_name: string | null;
  assigned_at: string;
  confirmation_token?: string | null;
  stand_leader?: boolean;
};

// Mirrors the server-side gate in /api/invitation-cancellation-requests (POST):
// requests are rejected once the event is this close.
const MIN_HOURS_BEFORE_EVENT_CANCELLATION = 24;

/** Hours until the invitation's event starts (in the event's own local/state time), or null if it can't be computed. */
function getHoursUntilEventStart(inv: Pick<EventInvitation, "event_date" | "start_time" | "state">): number | null {
  if (!inv.event_date || !inv.start_time) return null;
  const dateStr = inv.event_date.split("T")[0];
  const tz = getTimezoneForState(inv.state);
  const iso = toZonedIso(dateStr, inv.start_time, tz);
  const eventStartMs = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(eventStartMs)) return null;
  return (eventStartMs - Date.now()) / (60 * 60 * 1000);
}

type SubmittedAvailabilityDay = {
  date: string;
  available: boolean;
  notes?: string | null;
  submitted_at?: string | null;
};

type AvailabilityDateChange = { date: string; current_available: boolean | null; requested_available: boolean };

type AvailabilityChangeRequest = {
  id: string;
  vendor_id: string;
  date_changes: AvailabilityDateChange[];
  reason: string;
  status: "pending" | "approved" | "rejected";
  requested_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
  updated_at: string;
};

type InvitationCancellationStatus = "pending" | "approved" | "rejected";

type InvitationCancellationRequest = {
  id: string;
  user_id: string;
  event_id: string;
  source: "team" | "location";
  team_member_id: string | null;
  location_assignment_id: string | null;
  previous_status: string | null;
  reason: string;
  status: InvitationCancellationStatus;
  requested_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
  updated_at: string;
  events?:
    | { event_name: string | null; event_date: string | null; venue: string | null; city: string | null; state: string | null }
    | { event_name: string | null; event_date: string | null; venue: string | null; city: string | null; state: string | null }[]
    | null;
};

type HelpdeskTicketUrgency = "low" | "medium" | "high" | "critical";

type HelpdeskTicketStatus = "open" | "in_progress" | "resolved" | "closed";

type HelpdeskTicket = {
  id: string;
  ticketNumber: string;
  ticketDate: string;
  urgency: HelpdeskTicketUrgency;
  status: HelpdeskTicketStatus | undefined;
  description: string;
  createdAt: string;
  createdBy: string;
  createdByEmail: string;
  createdByName: string;
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

function getTodayInputValue() {
  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  return today.toISOString().slice(0, 10);
}

function getHelpdeskUrgencyClasses(urgency: HelpdeskTicketUrgency) {
  switch (urgency) {
    case "critical":
      return "bg-red-50 text-red-700 border-red-200";
    case "high":
      return "bg-orange-50 text-orange-700 border-orange-200";
    case "medium":
      return "bg-amber-50 text-amber-700 border-amber-200";
    default:
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
}

function getHelpdeskStatusClasses(status: HelpdeskTicketStatus | undefined) {
  switch (status) {
    case "in_progress": return "bg-amber-50 text-amber-700 border-amber-200";
    case "resolved":    return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "closed":      return "bg-gray-100 text-gray-600 border-gray-200";
    default:            return "bg-blue-50 text-blue-700 border-blue-200";
  }
}

function formatHelpdeskStatus(status: HelpdeskTicketStatus | undefined) {
  if (!status || status === "open") return "Open";
  if (status === "in_progress") return "In Progress";
  return status.charAt(0).toUpperCase() + status.slice(1);
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
  const [sickRequestEventId, setSickRequestEventId] = useState<string>("");
  const [sickRequestReason, setSickRequestReason] = useState<string>("");
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
  // Tracks an in-flight confirm/decline response for a team invitation (keyed by invitation id).
  const [respondingInvitationId, setRespondingInvitationId] = useState<string | null>(null);
  // Per-invitation feedback shown inline after a confirm/decline attempt (keyed by invitation id).
  const [invitationFeedback, setInvitationFeedback] = useState<Record<string, { type: "error" | "success"; text: string }>>({});

  // Cancellation requests for already-responded invitations: initiated here on the
  // profile, then held pending until a privileged reviewer approves/rejects them.
  const [cancellationRequests, setCancellationRequests] = useState<InvitationCancellationRequest[]>([]);
  const [cancellationRequestsLoading, setCancellationRequestsLoading] = useState(false);
  const [canReviewCancellationRequests, setCanReviewCancellationRequests] = useState(false);
  const [cancelModalInvitation, setCancelModalInvitation] = useState<EventInvitation | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [submittingCancelRequest, setSubmittingCancelRequest] = useState(false);
  const [cancelRequestError, setCancelRequestError] = useState("");
  const [reviewingCancelRequestId, setReviewingCancelRequestId] = useState<string | null>(null);
  const [cancelReviewNotes, setCancelReviewNotes] = useState<Record<string, string>>({});
  const [cancelReviewError, setCancelReviewError] = useState<Record<string, string>>({});

  // Availability change requests: the vendor (or an admin on their behalf)
  // selects specific dates directly on the Personal Calendar and requests a
  // correction; held pending until a privileged reviewer approves/rejects here.
  const [availabilityChangeRequests, setAvailabilityChangeRequests] = useState<AvailabilityChangeRequest[]>([]);
  const [availabilityChangeRequestsLoading, setAvailabilityChangeRequestsLoading] = useState(false);
  const [canReviewAvailabilityChangeRequests, setCanReviewAvailabilityChangeRequests] = useState(false);
  const [selectingAvailabilityDates, setSelectingAvailabilityDates] = useState(false);
  const [selectedAvailabilityChanges, setSelectedAvailabilityChanges] = useState<Map<string, boolean>>(new Map());
  const [availabilityChangeReason, setAvailabilityChangeReason] = useState("");
  const [submittingAvailabilityChange, setSubmittingAvailabilityChange] = useState(false);
  const [availabilityChangeError, setAvailabilityChangeError] = useState("");
  const [reviewingAvailabilityChangeId, setReviewingAvailabilityChangeId] = useState<string | null>(null);
  const [availabilityChangeReviewNotes, setAvailabilityChangeReviewNotes] = useState<Record<string, string>>({});
  const [availabilityChangeReviewError, setAvailabilityChangeReviewError] = useState<Record<string, string>>({});

  // ID of the currently logged-in user, used to detect when someone is viewing
  // their own profile (stand-leader check-in is only offered on your own profile).
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const isOwnProfile = !!currentUserId && !!employeeId && currentUserId === employeeId;

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
            <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border border-red-200 bg-red-50 text-red-700">
              Edit Request Rejected
            </span>
          ) : (
            <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 bg-slate-50 text-slate-600">
              Locked
            </span>
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

  // Confirm or decline a team invitation directly from the Events Recap so the
  // employee can respond to an event cue without leaving their profile.
  const respondToInvitation = async (
    inv: EventInvitation,
    action: "confirm" | "decline"
  ) => {
    if (!inv.confirmation_token || respondingInvitationId) return;
    setRespondingInvitationId(inv.id);
    setInvitationFeedback((prev) => {
      const next = { ...prev };
      delete next[inv.id];
      return next;
    });
    try {
      const res = await fetch(`/api/team-confirmation/${inv.confirmation_token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Unable to record your response. Please try again.");
      }
      const newStatus = (data?.status as string) || (action === "confirm" ? "confirmed" : "declined");
      setEventInvitations((prev) =>
        prev.map((row) => (row.id === inv.id ? { ...row, status: newStatus } : row))
      );
      setInvitationFeedback((prev) => ({
        ...prev,
        [inv.id]: {
          type: "success",
          text: action === "confirm" ? "Attendance confirmed." : "Marked as declined.",
        },
      }));
    } catch (err: any) {
      setInvitationFeedback((prev) => ({
        ...prev,
        [inv.id]: { type: "error", text: err?.message || "Something went wrong." },
      }));
    } finally {
      setRespondingInvitationId(null);
    }
  };

  // Opens the reason modal for an already-responded (confirmed/declined) invitation.
  const openCancelModal = (inv: EventInvitation) => {
    setCancelModalInvitation(inv);
    setCancelReason("");
    setCancelRequestError("");
  };

  const closeCancelModal = () => {
    if (submittingCancelRequest) return;
    setCancelModalInvitation(null);
    setCancelReason("");
    setCancelRequestError("");
  };

  // Files a pending cancellation request for the invitation open in the modal.
  // It does not remove the invitation itself — that only happens once a
  // privileged reviewer approves the request (see reviewCancelRequest below).
  const submitCancelRequest = async () => {
    if (!cancelModalInvitation || !employeeId) return;
    const trimmedReason = cancelReason.trim();
    if (!trimmedReason) {
      setCancelRequestError("Please provide a reason for the cancellation.");
      return;
    }

    const hoursUntilStart = getHoursUntilEventStart(cancelModalInvitation);
    if (hoursUntilStart !== null && hoursUntilStart < MIN_HOURS_BEFORE_EVENT_CANCELLATION) {
      setCancelRequestError(
        `Cancellation requests must be submitted at least ${MIN_HOURS_BEFORE_EVENT_CANCELLATION} hours before the event starts.`
      );
      return;
    }

    setSubmittingCancelRequest(true);
    setCancelRequestError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/invitation-cancellation-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          userId: employeeId,
          invitationId: cancelModalInvitation.id,
          source: cancelModalInvitation.source,
          reason: trimmedReason,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to submit cancellation request.");
      }

      if (data?.request) {
        setCancellationRequests((prev) => [data.request, ...prev]);
      }
      setCancelModalInvitation(null);
      setCancelReason("");
      if (data?.notificationSent === false) {
        alert(data?.message || "Cancellation request submitted, but the notification email to the review team failed to send.");
      }
    } catch (error: any) {
      setCancelRequestError(error?.message || "Failed to submit cancellation request.");
    } finally {
      setSubmittingCancelRequest(false);
    }
  };

  // Approves or rejects a pending cancellation request. Approving actually removes
  // the underlying invitation server-side, so we also drop it from the visible list.
  const reviewCancelRequest = async (requestId: string, status: "approved" | "rejected") => {
    setReviewingCancelRequestId(requestId);
    setCancelReviewError((prev) => {
      const next = { ...prev };
      delete next[requestId];
      return next;
    });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/invitation-cancellation-requests", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          id: requestId,
          status,
          review_notes: cancelReviewNotes[requestId]?.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to update the request.");
      }

      const updatedRequest = data.request as InvitationCancellationRequest | undefined;
      if (updatedRequest) {
        setCancellationRequests((prev) => prev.map((r) => (r.id === requestId ? updatedRequest : r)));
        if (status === "approved") {
          const invitationId =
            updatedRequest.source === "team" ? updatedRequest.team_member_id : updatedRequest.location_assignment_id;
          setEventInvitations((prev) =>
            prev.filter((inv) => !(inv.source === updatedRequest.source && inv.id === invitationId))
          );
        }
      }
    } catch (error: any) {
      setCancelReviewError((prev) => ({
        ...prev,
        [requestId]: error?.message || "Failed to update the request.",
      }));
    } finally {
      setReviewingCancelRequestId(null);
    }
  };

  // Toggles a calendar date in/out of the pending availability-change
  // selection. When first added, the requested value defaults to the
  // opposite of whatever's currently on record (or "available" if there's
  // no answer for that date yet) — the reviewer panel below still lets the
  // requester flip it before submitting.
  const toggleAvailabilityChangeDate = (date: string, currentAvailable: boolean | null) => {
    setSelectedAvailabilityChanges((prev) => {
      const next = new Map(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.set(date, currentAvailable === null ? true : !currentAvailable);
      }
      return next;
    });
  };

  const setAvailabilityChangeRequestedValue = (date: string, value: boolean) => {
    setSelectedAvailabilityChanges((prev) => {
      const next = new Map(prev);
      next.set(date, value);
      return next;
    });
  };

  const cancelAvailabilityChangeSelection = () => {
    setSelectingAvailabilityDates(false);
    setSelectedAvailabilityChanges(new Map());
    setAvailabilityChangeReason("");
    setAvailabilityChangeError("");
  };

  const submitAvailabilityChangeRequest = async () => {
    if (!employeeId || selectedAvailabilityChanges.size === 0) return;
    const trimmedReason = availabilityChangeReason.trim();
    if (!trimmedReason) {
      setAvailabilityChangeError("Please provide a reason for the change.");
      return;
    }

    setSubmittingAvailabilityChange(true);
    setAvailabilityChangeError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/vendor-availability-change-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          userId: employeeId,
          dates: Array.from(selectedAvailabilityChanges.entries()).map(([date, requestedAvailable]) => ({
            date,
            requestedAvailable,
          })),
          reason: trimmedReason,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to submit availability change request.");
      }

      if (data?.request) {
        setAvailabilityChangeRequests((prev) => [data.request, ...prev]);
      }
      cancelAvailabilityChangeSelection();
      if (data?.notificationSent === false) {
        alert(data?.message || "Request submitted, but the notification email to the review team failed to send.");
      }
    } catch (error: any) {
      setAvailabilityChangeError(error?.message || "Failed to submit availability change request.");
    } finally {
      setSubmittingAvailabilityChange(false);
    }
  };

  // Approves or rejects a pending availability change request. Approving
  // actually writes the corrected values server-side, so refetch the
  // calendar to pick them up.
  const reviewAvailabilityChangeRequest = async (requestId: string, status: "approved" | "rejected") => {
    setReviewingAvailabilityChangeId(requestId);
    setAvailabilityChangeReviewError((prev) => {
      const next = { ...prev };
      delete next[requestId];
      return next;
    });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/vendor-availability-change-requests", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          id: requestId,
          status,
          review_notes: availabilityChangeReviewNotes[requestId]?.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to update the request.");
      }

      const updatedRequest = data.request as AvailabilityChangeRequest | undefined;
      if (updatedRequest) {
        setAvailabilityChangeRequests((prev) => prev.map((r) => (r.id === requestId ? updatedRequest : r)));
        if (status === "approved") void loadInvitations();
      }
    } catch (error: any) {
      setAvailabilityChangeReviewError((prev) => ({
        ...prev,
        [requestId]: error?.message || "Failed to update the request.",
      }));
    } finally {
      setReviewingAvailabilityChangeId(null);
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

  const [emailInbox, setEmailInbox] = useState<EmailLogEntry[]>([]);
  const [emailInboxLoading, setEmailInboxLoading] = useState(false);
  const [emailInboxError, setEmailInboxError] = useState<string | null>(null);
  const [selectedInboxEmail, setSelectedInboxEmail] = useState<EmailLogEntry | null>(null);
  // Whether the caller may Reply / send a New Message into this inbox (HR/admin roles only —
  // returned by GET /api/employees/[id]/emails alongside the email list).
  const [canRespondToInbox, setCanRespondToInbox] = useState(false);
  // Compose panel shared by "Reply" (replyTo set) and "New Message" (replyTo null).
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeReplyTo, setComposeReplyTo] = useState<EmailLogEntry | null>(null);
  const [composeSubject, setComposeSubject] = useState("");
  const [composeMessage, setComposeMessage] = useState("");
  const [composeSending, setComposeSending] = useState(false);
  const [composeError, setComposeError] = useState("");

  const [dataEditRequestDoc, setDataEditRequestDoc] = useState<string>("");
  const [dataEditRequestReason, setDataEditRequestReason] = useState<string>("");
  const [submittingDataEditRequest, setSubmittingDataEditRequest] = useState(false);
  const [dataEditRequestError, setDataEditRequestError] = useState("");
  const [dataEditRequestSuccess, setDataEditRequestSuccess] = useState("");
  const [dataEditRequests, setDataEditRequests] = useState<{
    id: string;
    document_name: string;
    document_type: string;
    reason: string | null;
    status: "pending" | "sent" | "approved" | "rejected";
    review_notes: string | null;
    reviewed_at: string | null;
    created_at: string;
  }[]>([]);
  const [dataEditRequestsLoading, setDataEditRequestsLoading] = useState(false);
  const [helpdeskTickets, setHelpdeskTickets] = useState<HelpdeskTicket[]>([]);
  const [helpdeskTicketsLoading, setHelpdeskTicketsLoading] = useState(false);
  const [helpdeskTicketError, setHelpdeskTicketError] = useState("");
  const [helpdeskTicketSuccess, setHelpdeskTicketSuccess] = useState("");
  const [submittingHelpdeskTicket, setSubmittingHelpdeskTicket] = useState(false);
  const [isHelpdeskModalOpen, setIsHelpdeskModalOpen] = useState(false);
  const [helpdeskForm, setHelpdeskForm] = useState({
    ticketDate: getTodayInputValue(),
    urgency: "medium" as HelpdeskTicketUrgency,
    description: "",
  });

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

  // Fetch the employee's email inbox (every app-generated email sent to them)
  useEffect(() => {
    if (!employeeId) return;
    setEmailInboxLoading(true);
    setEmailInboxError(null);
    supabase.auth.getSession().then(({ data: { session } }) => {
      fetch(`/api/employees/${employeeId}/emails`, {
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {},
        cache: "no-store",
      })
        .then((r) => r.json())
        .then((body) => {
          if (body.error) {
            setEmailInboxError(body.error);
            setEmailInbox([]);
            setCanRespondToInbox(false);
          } else {
            setEmailInbox((body.emails as EmailLogEntry[]) ?? []);
            setCanRespondToInbox(Boolean(body.canRespond));
          }
          setEmailInboxLoading(false);
        })
        .catch((e) => {
          setEmailInboxError(e.message ?? "Failed to load inbox");
          setEmailInboxLoading(false);
        });
    });
  }, [employeeId, refreshTick]);

  // Opens an inbox email and marks it read (first open wins) so the list
  // can show a "Read" chip going forward.
  const openInboxEmail = (mail: EmailLogEntry) => {
    setSelectedInboxEmail(mail);
    if (mail.read_at || !employeeId) return;

    // Optimistic: show the chip immediately rather than waiting on the network.
    const readAt = new Date().toISOString();
    setEmailInbox((prev) => prev.map((m) => (m.id === mail.id ? { ...m, read_at: readAt } : m)));
    setSelectedInboxEmail((prev) => (prev && prev.id === mail.id ? { ...prev, read_at: readAt } : prev));

    supabase.auth.getSession().then(({ data: { session } }) => {
      fetch(`/api/employees/${employeeId}/emails`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ emailId: mail.id }),
      }).catch(() => {
        // Non-fatal: worst case the chip re-syncs on next inbox refresh.
      });
    });
  };

  // Opens the compose panel for a brand new message (no reply target).
  const openNewMessage = () => {
    setComposeReplyTo(null);
    setComposeSubject("");
    setComposeMessage("");
    setComposeError("");
    setComposeOpen(true);
  };

  // Opens the compose panel pre-filled to reply to the given inbox email.
  const openReplyToEmail = (mail: EmailLogEntry) => {
    setComposeReplyTo(mail);
    const subject = mail.subject || "";
    setComposeSubject(/^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`);
    setComposeMessage("");
    setComposeError("");
    setComposeOpen(true);
  };

  const closeCompose = () => {
    if (composeSending) return;
    setComposeOpen(false);
    setComposeReplyTo(null);
    setComposeSubject("");
    setComposeMessage("");
    setComposeError("");
  };

  // Sends the composed message (new or reply) as a real email to the employee,
  // logged into email_logs, and prepends it to the inbox list on success.
  const submitCompose = async () => {
    if (!employeeId || composeSending) return;
    const trimmedSubject = composeSubject.trim();
    const trimmedMessage = composeMessage.trim();
    if (!trimmedSubject) {
      setComposeError("Subject is required.");
      return;
    }
    if (!trimmedMessage) {
      setComposeError("Message is required.");
      return;
    }

    setComposeSending(true);
    setComposeError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/employees/${employeeId}/emails`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          subject: trimmedSubject,
          message: trimmedMessage,
          inReplyToId: composeReplyTo?.id,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to send message.");
      }

      if (data?.email) {
        setEmailInbox((prev) => [data.email as EmailLogEntry, ...prev]);
      } else {
        // Sent but the fresh row couldn't be resolved server-side — refresh to pick it up.
        setRefreshTick((current) => current + 1);
      }

      setComposeOpen(false);
      setComposeReplyTo(null);
      setComposeSubject("");
      setComposeMessage("");
    } catch (error: any) {
      setComposeError(error?.message || "Failed to send message.");
    } finally {
      setComposeSending(false);
    }
  };

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

  // Fetch event invitations (team + location assignments) and the merged,
  // latest-per-date availability for this employee. Exposed as a stable
  // callback (not just an effect body) so it can also be triggered by the
  // manual Refresh button and by refocusing the tab — the vendor's own
  // submission almost always happens in a different tab/session, so without
  // this the calendar can sit on stale data indefinitely if the page was
  // left open.
  const loadInvitations = useCallback(async () => {
    if (!employeeId) return;
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
  }, [employeeId]);

  useEffect(() => {
    void loadInvitations();
  }, [loadInvitations]);

  // Refetch whenever this tab regains focus/visibility, so a calendar left
  // open updates once the vendor submits elsewhere instead of only on the
  // next full navigation to this page.
  useEffect(() => {
    const handleFocus = () => { void loadInvitations(); };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void loadInvitations();
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadInvitations]);

  // Fetch invitation cancellation requests (pending/approved/rejected) for this employee
  useEffect(() => {
    if (!employeeId) return;
    const loadCancellationRequests = async () => {
      setCancellationRequestsLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`/api/invitation-cancellation-requests?userId=${employeeId}`, {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          setCancellationRequests(data.requests || []);
          setCanReviewCancellationRequests(Boolean(data.canReview));
        } else {
          setCancellationRequests([]);
          setCanReviewCancellationRequests(false);
        }
      } catch (e) {
        console.error("Error loading invitation cancellation requests:", e);
        setCancellationRequests([]);
        setCanReviewCancellationRequests(false);
      } finally {
        setCancellationRequestsLoading(false);
      }
    };
    loadCancellationRequests();
  }, [employeeId, refreshTick]);

  // Fetch availability change requests (pending/approved/rejected) for this employee
  useEffect(() => {
    if (!employeeId) return;
    const loadAvailabilityChangeRequests = async () => {
      setAvailabilityChangeRequestsLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`/api/vendor-availability-change-requests?userId=${employeeId}`, {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          setAvailabilityChangeRequests(data.requests || []);
          setCanReviewAvailabilityChangeRequests(Boolean(data.canReview));
        } else {
          setAvailabilityChangeRequests([]);
          setCanReviewAvailabilityChangeRequests(false);
        }
      } catch (e) {
        console.error("Error loading availability change requests:", e);
        setAvailabilityChangeRequests([]);
        setCanReviewAvailabilityChangeRequests(false);
      } finally {
        setAvailabilityChangeRequestsLoading(false);
      }
    };
    loadAvailabilityChangeRequests();
  }, [employeeId, refreshTick]);

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

  // Fetch data edition request history for this employee
  useEffect(() => {
    if (!employeeId) return;
    const load = async () => {
      setDataEditRequestsLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`/api/data-edition-requests?userId=${employeeId}`, {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
          cache: 'no-store',
        });
        if (res.ok) {
          const body = await res.json();
          setDataEditRequests(body.requests ?? []);
        }
      } catch (e) {
        console.error('Error loading data edition requests:', e);
      } finally {
        setDataEditRequestsLoading(false);
      }
    };
    load();
  }, [employeeId, refreshTick]);

  useEffect(() => {
    if (!employeeId) return;

    const loadHelpdeskTickets = async () => {
      setHelpdeskTicketsLoading(true);
      setHelpdeskTicketError("");
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/hr/helpdesk-tickets', {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
          cache: 'no-store',
        });

        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body?.error || 'Failed to load helpdesk tickets.');
        }

        setHelpdeskTickets(body.tickets ?? []);
      } catch (error: any) {
        console.error('Error loading helpdesk tickets:', error);
        setHelpdeskTicketError(error?.message || 'Failed to load helpdesk tickets.');
      } finally {
        setHelpdeskTicketsLoading(false);
      }
    };

    loadHelpdeskTickets();
  }, [employeeId, refreshTick]);

  useEffect(() => {
    if (!isHelpdeskModalOpen) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsHelpdeskModalOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isHelpdeskModalOpen]);

  // Identify the logged-in user (to detect own-profile views)
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) setCurrentUserId(session?.user?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  // CW (CWT Trailers division) workers get a distinct badge and CW-only event data
  const isCWEmployee = (employee?.division || "").toLowerCase().trim() === "trailers";

  const computed = useMemo(() => {
    if (!entries) return { totalHoursLocal: 0 };
    // Use pre-computed duration_hours (meals deducted + 30 min bonus)
    const total = entries.reduce((acc, e) => acc + (e.duration_hours ?? 0), 0);
    return { totalHoursLocal: total };
  }, [entries]);

  // Latest cancellation request per invitation (keyed by "source-invitationId"), so
  // the Events Recap row can show "Cancel" / "Pending" / "Rejected" appropriately.
  const cancellationRequestByInvitation = useMemo(() => {
    const map = new Map<string, InvitationCancellationRequest>();
    for (const req of cancellationRequests) {
      const invitationId = req.source === "team" ? req.team_member_id : req.location_assignment_id;
      if (!invitationId) continue;
      const key = `${req.source}-${invitationId}`;
      const existing = map.get(key);
      if (!existing || new Date(req.created_at).getTime() > new Date(existing.created_at).getTime()) {
        map.set(key, req);
      }
    }
    return map;
  }, [cancellationRequests]);

  // Create event name lookup from per_event data

  const sickLeaveSummary = summary?.sick_leave;
  const sickLeaveEntries = sickLeaveSummary?.entries ?? [];
  const sickLeavePaysheets = sickLeaveSummary?.paysheets ?? [];

  // Events the employee can attach a sick leave request to (deduped invitations,
  // most recent event first)
  const sickRequestEventOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: {
      event_id: string;
      event_date: string | null;
      end_date: string | null;
      label: string;
    }[] = [];
    for (const inv of eventInvitations) {
      if (!inv.event_id || seen.has(inv.event_id)) continue;
      seen.add(inv.event_id);
      const datePart = inv.event_date ? ` (${formatEventDate(inv.event_date)})` : "";
      options.push({
        event_id: inv.event_id,
        event_date: inv.event_date,
        end_date: inv.end_date,
        label: `${inv.event_name || "Unnamed event"}${datePart}`,
      });
    }
    return options.sort((a, b) => (b.event_date || "").localeCompare(a.event_date || ""));
  }, [eventInvitations]);

  const selectedSickRequestEvent = sickRequestEventOptions.find(
    (option) => option.event_id === sickRequestEventId
  );
  const sickRequestMinDate = selectedSickRequestEvent?.event_date ?? undefined;
  const sickRequestMaxDate =
    selectedSickRequestEvent?.end_date ?? selectedSickRequestEvent?.event_date ?? undefined;

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
      event_id: record.event_id ? String(record.event_id) : null,
      event_name: record.event_name ? String(record.event_name) : null,
      event_date: record.event_date ? String(record.event_date) : null,
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

  const submitDataEditRequest = async () => {
    if (!dataEditRequestDoc) {
      setDataEditRequestError("Please select a document.");
      return;
    }

    setSubmittingDataEditRequest(true);
    setDataEditRequestError("");
    setDataEditRequestSuccess("");

    try {
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch("/api/onboarding/request-edit-permission", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          userEmail: employee?.email,
          userFirstName: employee?.first_name,
          userLastName: employee?.last_name,
          userId: employeeId,
          documentName: dataEditRequestDoc,
          reason: dataEditRequestReason.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to submit request.");
      }

      setDataEditRequestSuccess("Your data edition request has been submitted. HR will be notified shortly.");
      if (data?.request) {
        setDataEditRequests((prev) => [
          { ...data.request, document_name: dataEditRequestDoc, document_type: 'onboarding', reason: dataEditRequestReason.trim() || null, status: 'pending', review_notes: null, reviewed_at: null },
          ...prev,
        ]);
      }
      setDataEditRequestDoc("");
      setDataEditRequestReason("");
    } catch (error: any) {
      setDataEditRequestError(error?.message || "Failed to submit request.");
    } finally {
      setSubmittingDataEditRequest(false);
    }
  };

  const submitHelpdeskTicket = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setHelpdeskTicketError("");
    setHelpdeskTicketSuccess("");

    if (!helpdeskForm.ticketDate) {
      setHelpdeskTicketError("Please choose a ticket date.");
      return;
    }

    if (!helpdeskForm.description.trim()) {
      setHelpdeskTicketError("Please describe what the user needs.");
      return;
    }

    setSubmittingHelpdeskTicket(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch("/api/hr/helpdesk-tickets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(helpdeskForm),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to create helpdesk ticket.");
      }

      if (data?.ticket) {
        setHelpdeskTickets((prev) => [data.ticket, ...prev].slice(0, 25));
      }
      setHelpdeskTicketSuccess(
        data?.ticket?.ticketNumber
          ? `Ticket ${data.ticket.ticketNumber} submitted successfully.`
          : "Helpdesk ticket submitted successfully."
      );
      setHelpdeskForm((current) => ({
        ...current,
        description: "",
      }));
    } catch (error: any) {
      setHelpdeskTicketError(error?.message || "Failed to create helpdesk ticket.");
    } finally {
      setSubmittingHelpdeskTicket(false);
    }
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

    if (!sickRequestEventId) {
      setSickRequestError("Please select the event this sick leave applies to.");
      return;
    }

    const trimmedSickRequestReason = sickRequestReason.trim();
    if (!trimmedSickRequestReason) {
      setSickRequestError("Please provide a reason for this sick leave request.");
      return;
    }

    if (
      (sickRequestMinDate && sickRequestDate < sickRequestMinDate) ||
      (sickRequestMaxDate && sickRequestDate > sickRequestMaxDate)
    ) {
      setSickRequestError(
        sickRequestMaxDate && sickRequestMaxDate !== sickRequestMinDate
          ? `The date must fall within the selected event (${formatEventDate(sickRequestMinDate)} — ${formatEventDate(sickRequestMaxDate)}).`
          : `The date must match the selected event (${formatEventDate(sickRequestMinDate)}).`
      );
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
          event_id: sickRequestEventId,
          reason: trimmedSickRequestReason,
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
          setSickRequestEventId("");
          setSickRequestReason("");
          return;
        }
        throw new Error(data?.error || "Failed to submit sick leave request");
      }

      if (insertedEntry) {
        appendSickLeaveEntry(insertedEntry);
      }

      setSickRequestSuccess("Sick leave request sent successfully.");
      setSickRequestHours("");
      setSickRequestEventId("");
      setSickRequestReason("");
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
    const isHomeVenueAssignment = formName?.toLowerCase().includes('home-venue-assignment');
    if (isHomeVenueAssignment) {
      await stampHomeVenueAssignmentLayout(pdfDoc, { dateText: formatted });
      const saved = await pdfDoc.save();
      let b = '';
      for (let i = 0; i < saved.length; i++) b += String.fromCharCode(saved[i]);
      return btoa(b);
    }

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

  // Embed venue information using the form-specific layout when applicable.
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
    const isHomeVenueAssignment = formName?.toLowerCase().includes('home-venue-assignment');
    if (isHomeVenueAssignment) {
      await stampHomeVenueAssignmentLayout(pdfDoc, {
        employeeName,
        venueName,
      });
      const saved = await pdfDoc.save();
      let b = '';
      for (let i = 0; i < saved.length; i++) b += String.fromCharCode(saved[i]);
      return btoa(b);
    }

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

  const isAttestationPdfRecord = (
    form: Pick<PDFForm, 'form_name' | 'display_name'>,
    matchingCustomForm?: { title: string } | null
  ) =>
    [form.form_name, form.display_name, matchingCustomForm?.title]
      .filter(Boolean)
      .some((value) => /attestation/i.test(value!));

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

  const withCustomFormInputsAlignedToLines = async (base64Data: string): Promise<string> => {
    const pdfBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const renderedBytes = await renderCustomFormInputsOnDetectedLines(pdfBytes);
    let binary = '';
    for (let i = 0; i < renderedBytes.length; i++) binary += String.fromCharCode(renderedBytes[i]);
    return btoa(binary);
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
      const knownCustomFlatFormLayout = getKnownCustomFlatFormLayout(
        form.form_name,
        form.display_name,
        matchingCustomForm?.title,
      );
      const employeeFullName = employee ? `${employee.first_name} ${employee.last_name}` : undefined;
      const isAttestationPdfForm = isAttestationPdfRecord(form, matchingCustomForm);
      const isNoticeToEmployee = normalizeStandardOnboardingFormName(form.form_name) === 'notice-to-employee';
      const shouldEmbedVenueForForm = Boolean(venueName) && !(isNoticeToEmployee && !matchingCustomForm);
      const shouldEmbedOpeningPrintName = form.form_name.toLowerCase().includes('home-venue-assignment');
      if (
        shouldEmbedProfileFields &&
        form.form_date &&
        !knownCustomFlatFormLayout &&
        !isAttestationPdfForm &&
        !isNoticeToEmployee
      ) {
        data = await withDateEmbedded(data, form.form_date, form.form_name);
      }
      if (shouldEmbedProfileFields && !knownCustomFlatFormLayout && isAttestationPdfForm && employeeFullName) {
        data = await withAttestationPrintNameEmbedded(data, employeeFullName);
      }
      if (shouldEmbedProfileFields && !knownCustomFlatFormLayout && shouldEmbedVenueForForm && venueName) {
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
      if (matchingCustomForm && !knownCustomFlatFormLayout) {
        data = await withCustomFormInputsAlignedToLines(data);
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
      const knownCustomFlatFormLayout = getKnownCustomFlatFormLayout(
        form.form_name,
        form.display_name,
        matchingCustomForm?.title,
      );
      const employeeFullName = employee ? `${employee.first_name} ${employee.last_name}` : undefined;
      const isAttestationPdfForm = isAttestationPdfRecord(form, matchingCustomForm);
      const isNoticeToEmployee = normalizeStandardOnboardingFormName(form.form_name) === 'notice-to-employee';
      const shouldEmbedVenueForForm = Boolean(venueName) && !(isNoticeToEmployee && !matchingCustomForm);
      const shouldEmbedOpeningPrintName = form.form_name.toLowerCase().includes('home-venue-assignment');
      if (
        shouldEmbedProfileFields &&
        form.form_date &&
        !knownCustomFlatFormLayout &&
        !isAttestationPdfForm &&
        !isNoticeToEmployee
      ) {
        data = await withDateEmbedded(data, form.form_date, form.form_name);
      }
      if (shouldEmbedProfileFields && !knownCustomFlatFormLayout && isAttestationPdfForm && employeeFullName) {
        data = await withAttestationPrintNameEmbedded(data, employeeFullName);
      }
      if (shouldEmbedProfileFields && !knownCustomFlatFormLayout && shouldEmbedVenueForForm && venueName) {
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
      if (matchingCustomForm && !knownCustomFlatFormLayout) {
        data = await withCustomFormInputsAlignedToLines(data);
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
                <span className="inline-flex flex-wrap items-center gap-3">
                  <span>
                    {employee.first_name} {employee.last_name}
                  </span>
                  {isCWEmployee && (
                    <span className="inline-flex items-center rounded-full border-2 border-blue-600 bg-blue-50 px-3 py-1 text-sm font-bold text-blue-800">
                      CW user
                    </span>
                  )}
                </span>
              ) : (
                "Worker Profile"
              )}
            </h1>
            <p className="text-gray-600 mt-1">
              {isCWEmployee
                ? "CWT Trailers division — cumulative hours, shifts, and CW event history"
                : "Cumulative hours, shifts, and event history"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsHelpdeskModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h8M8 14h5m-7 6h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Helpdesk
          </button>
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

                  {isCWEmployee && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-blue-600 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-800 mb-2">
                      CW user · CWT Trailers division
                    </span>
                  )}

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

            {isHelpdeskModalOpen && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
                onClick={() => setIsHelpdeskModalOpen(false)}
              >
                <section
                  id="helpdesk-section"
                  className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Helpdesk</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Create a support ticket with urgency, date, and a clear description.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {!helpdeskTicketsLoading && (
                    <span className="text-xs text-gray-400">
                      {helpdeskTickets.length} ticket{helpdeskTickets.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsHelpdeskModalOpen(false)}
                    className="rounded-xl border border-gray-200 p-2 text-gray-500 transition hover:bg-gray-50 hover:text-gray-700"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="apple-card p-6">
                <form onSubmit={submitHelpdeskTicket} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-gray-700">
                        Date <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        value={helpdeskForm.ticketDate}
                        onChange={(e) =>
                          setHelpdeskForm((current) => ({
                            ...current,
                            ticketDate: e.target.value,
                          }))
                        }
                        className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      />
                    </div>

                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-gray-700">
                        Urgency <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={helpdeskForm.urgency}
                        onChange={(e) =>
                          setHelpdeskForm((current) => ({
                            ...current,
                            urgency: e.target.value as HelpdeskTicketUrgency,
                          }))
                        }
                        className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
                    </div>
                  </div>

                  <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                    Ticket numbers are generated automatically when your request is submitted.
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                      Description <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={helpdeskForm.description}
                      onChange={(e) =>
                        setHelpdeskForm((current) => ({
                          ...current,
                          description: e.target.value,
                        }))
                      }
                      rows={4}
                      placeholder="Describe what the user needs help with..."
                      className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 resize-none"
                    />
                  </div>

                  {helpdeskTicketError && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {helpdeskTicketError}
                    </div>
                  )}

                  {helpdeskTicketSuccess && (
                    <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                      {helpdeskTicketSuccess}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={submittingHelpdeskTicket}
                      className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      {submittingHelpdeskTicket ? "Submitting..." : "Create Ticket"}
                    </button>
                  </div>
                </form>

                <div className="mt-6 border-t border-gray-100 pt-6">
                  <h3 className="mb-3 text-sm font-semibold text-gray-700">Recent Tickets</h3>
                  {helpdeskTicketsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <div className="apple-spinner w-4 h-4" />
                      Loading...
                    </div>
                  ) : helpdeskTickets.length === 0 ? (
                    <p className="text-sm text-gray-400">No helpdesk tickets submitted yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {helpdeskTickets.map((ticket) => (
                        <div
                          key={ticket.id}
                          className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 sm:flex-row sm:items-center"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-gray-900">{ticket.ticketNumber}</p>
                                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${getHelpdeskUrgencyClasses(ticket.urgency)}`}>
                                  {ticket.urgency}
                                </span>
                                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${getHelpdeskStatusClasses(ticket.status)}`}>
                                  {formatHelpdeskStatus(ticket.status)}
                                </span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                <span>{formatEventDate(ticket.ticketDate)}</span>
                                <span>•</span>
                                <span>{formatDateTime(ticket.createdAt)}</span>
                              </div>
                              <p className="mt-2 text-sm text-gray-600">{ticket.description}</p>
                            </div>
                          <div className="text-xs text-gray-400 sm:text-right">
                            <div>{ticket.createdByName || ticket.createdByEmail}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
                </section>
              </div>
            )}

            {cancelModalInvitation && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
                onClick={closeCancelModal}
              >
                <div
                  className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Cancel Invitation</h2>
                      <p className="mt-1 text-sm text-gray-500">
                        {cancelModalInvitation.event_name || "This event"} — you previously{" "}
                        {cancelModalInvitation.status === "confirmed" ? "confirmed" : "declined"} this invitation.
                        Submitting this sends a cancellation request for approval; the invitation stays in place
                        until it's approved.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={closeCancelModal}
                      className="shrink-0 rounded-xl border border-gray-200 p-2 text-gray-500 transition hover:bg-gray-50 hover:text-gray-700"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    Reason <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    rows={4}
                    placeholder="Why are you cancelling this invitation?"
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 resize-none"
                  />

                  {cancelRequestError && (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {cancelRequestError}
                    </div>
                  )}

                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={closeCancelModal}
                      className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      Never mind
                    </button>
                    <button
                      type="button"
                      disabled={submittingCancelRequest}
                      onClick={submitCancelRequest}
                      className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {submittingCancelRequest ? "Submitting..." : "Submit Cancellation Request"}
                    </button>
                  </div>
                </div>
              </div>
            )}

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
                    <div className="flex items-center gap-2">
                      {(isOwnProfile || canReviewCancellationRequests) && (
                        <button
                          type="button"
                          onClick={() => {
                            if (selectingAvailabilityDates) cancelAvailabilityChangeSelection();
                            else setSelectingAvailabilityDates(true);
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                            selectingAvailabilityDates
                              ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                              : "border-gray-200 text-gray-600 hover:bg-gray-50"
                          }`}
                          title="Select one or more dates to request an availability correction"
                        >
                          {selectingAvailabilityDates ? "Cancel Selection" : "Request Availability Change"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void loadInvitations()}
                        disabled={invitationsLoading}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                        title="Reload the latest submitted availability"
                      >
                        <svg className={`w-3.5 h-3.5 ${invitationsLoading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        {invitationsLoading ? "Refreshing…" : "Refresh"}
                      </button>
                    </div>
                  </div>
                  {selectingAvailabilityDates && (
                    <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Click any date below to add or remove it from your correction request.
                    </div>
                  )}
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
                        const currentAvailable: boolean | null = hasAvailableSubmission
                          ? true
                          : hasUnavailableSubmission
                            ? false
                            : null;
                        const isSelectedForChange = selectedAvailabilityChanges.has(dateStr);
                        const requestedValue = selectedAvailabilityChanges.get(dateStr);
                        return (
                          <div
                            key={i}
                            onClick={selectingAvailabilityDates ? () => toggleAvailabilityChangeDate(dateStr, currentAvailable) : undefined}
                            className={`flex flex-col items-center py-1 px-0.5 min-h-[3.5rem] rounded-lg transition-colors ${
                              selectingAvailabilityDates ? "cursor-pointer hover:bg-amber-50" : ""
                            } ${isSelectedForChange ? "ring-2 ring-amber-400 bg-amber-50" : ""}`}
                          >
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
                            {isSelectedForChange && (
                              <div className="mt-0.5 px-1 rounded text-[9px] font-semibold leading-tight bg-amber-200 text-amber-900">
                                → {requestedValue ? "Available" : "Unavailable"}
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

                  {selectingAvailabilityDates && selectedAvailabilityChanges.size > 0 && (
                    <div className="apple-card p-4 mt-3 border border-amber-200 bg-amber-50/40">
                      <p className="text-sm font-semibold text-gray-800 mb-2">
                        {selectedAvailabilityChanges.size} date{selectedAvailabilityChanges.size !== 1 ? "s" : ""} selected
                      </p>
                      <div className="space-y-1.5 mb-3">
                        {Array.from(selectedAvailabilityChanges.entries())
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([date, requested]) => (
                            <div key={date} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5">
                              <span className="text-xs font-medium text-gray-700">{formatEventDate(date)}</span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setAvailabilityChangeRequestedValue(date, true)}
                                  className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                                    requested ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                  }`}
                                >
                                  Available
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setAvailabilityChangeRequestedValue(date, false)}
                                  className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                                    !requested ? "bg-rose-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                  }`}
                                >
                                  Unavailable
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleAvailabilityChangeDate(date, null)}
                                  className="text-gray-400 hover:text-gray-600 p-0.5"
                                  title="Remove this date"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          ))}
                      </div>
                      <textarea
                        value={availabilityChangeReason}
                        onChange={(e) => setAvailabilityChangeReason(e.target.value)}
                        placeholder="Reason for this correction (required)..."
                        rows={2}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all mb-2"
                      />
                      {availabilityChangeError && (
                        <p className="text-xs text-red-600 mb-2">{availabilityChangeError}</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void submitAvailabilityChangeRequest()}
                          disabled={submittingAvailabilityChange || !availabilityChangeReason.trim()}
                          className="inline-flex items-center rounded-lg bg-amber-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {submittingAvailabilityChange ? "Submitting..." : "Submit Request"}
                        </button>
                        <button
                          type="button"
                          onClick={cancelAvailabilityChangeSelection}
                          disabled={submittingAvailabilityChange}
                          className="inline-flex items-center rounded-lg border border-gray-300 px-3.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              );
            })()}

            {/* Availability Change Requests — filed from the calendar above, held
                pending until a privileged reviewer approves/rejects them here. */}
            {(availabilityChangeRequestsLoading || availabilityChangeRequests.length > 0) && (
              <section className="mb-8">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Availability Change Requests</h2>
                  {!availabilityChangeRequestsLoading && (
                    <span className="text-sm text-gray-500">
                      {availabilityChangeRequests.length} request{availabilityChangeRequests.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <div className="apple-card divide-y divide-gray-100">
                  {availabilityChangeRequestsLoading ? (
                    <div className="px-6 py-4 text-sm text-gray-400">Loading...</div>
                  ) : (
                    availabilityChangeRequests.map((req) => {
                      const statusStyles: Record<string, string> = {
                        pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
                        approved: "bg-green-50 text-green-700 border-green-200",
                        rejected: "bg-red-50 text-red-700 border-red-200",
                      };
                      return (
                        <div key={req.id} className="px-6 py-4 flex flex-col sm:flex-row sm:items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900">
                              {req.date_changes.length} date{req.date_changes.length !== 1 ? "s" : ""} requested
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {req.date_changes.map((c) => (
                                <span
                                  key={c.date}
                                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600"
                                >
                                  {formatEventDate(c.date)}: {c.current_available === null ? "no answer" : c.current_available ? "available" : "unavailable"}
                                  {" → "}
                                  <span className={c.requested_available ? "text-emerald-700 font-semibold" : "text-rose-700 font-semibold"}>
                                    {c.requested_available ? "available" : "unavailable"}
                                  </span>
                                </span>
                              ))}
                            </div>
                            <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">Reason: {req.reason}</p>
                            {req.review_notes && (
                              <p className="text-xs text-gray-500 mt-1 leading-relaxed">Reviewer notes: {req.review_notes}</p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${statusStyles[req.status] ?? "bg-gray-50 text-gray-700 border-gray-200"}`}>
                              {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                            </span>
                            <p className="text-xs text-gray-400">{formatDate(req.created_at)}</p>
                            {canReviewAvailabilityChangeRequests && req.status === "pending" && (
                              <div className="flex flex-col items-end gap-1.5 mt-1 w-48">
                                <input
                                  type="text"
                                  placeholder="Review note (optional)"
                                  value={availabilityChangeReviewNotes[req.id] ?? ""}
                                  onChange={(e) =>
                                    setAvailabilityChangeReviewNotes((prev) => ({ ...prev, [req.id]: e.target.value }))
                                  }
                                  className="w-full rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-900 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-200"
                                />
                                <div className="flex gap-1.5">
                                  <button
                                    type="button"
                                    disabled={reviewingAvailabilityChangeId === req.id}
                                    onClick={() => reviewAvailabilityChangeRequest(req.id, "approved")}
                                    className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                                  >
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    disabled={reviewingAvailabilityChangeId === req.id}
                                    onClick={() => reviewAvailabilityChangeRequest(req.id, "rejected")}
                                    className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                                  >
                                    Reject
                                  </button>
                                </div>
                                {availabilityChangeReviewError[req.id] && (
                                  <p className="text-xs text-red-600">{availabilityChangeReviewError[req.id]}</p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            )}

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
                  const eventDateKey = (value?: string | null): string | null => {
                    if (!value) return null;
                    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
                    return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
                  };

                  // Pending team invitations for a date the vendor has explicitly
                  // marked themselves unavailable on shouldn't be shown as
                  // actionable — they were sent before/around a stale or
                  // conflicting availability answer. Already-responded
                  // (confirmed/declined) invitations stay visible as history.
                  const unavailableDateKeys = new Set(
                    submittedAvailability.filter(d => d.available === false).map(d => d.date)
                  );
                  const isSelfDeclaredUnavailable = (inv: EventInvitation): boolean => {
                    if (inv.source !== "team") return false;
                    if (inv.status !== "pending_confirmation" && inv.status !== "pending") return false;
                    const key = eventDateKey(inv.event_date);
                    return !!key && unavailableDateKeys.has(key);
                  };
                  const visibleInvitations = eventInvitations.filter(inv => !isSelfDeclaredUnavailable(inv));

                  // Build lookup: event_id → per_event row
                  const perEventMap = new Map((summary?.per_event ?? []).map(r => [r.event_id, r]));
                  // Events with time entries but no team invitation (manually entered via self-timesheet)
                  const invitedEventIds = new Set(visibleInvitations.map(inv => inv.event_id));
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

                  // Split invitations into upcoming vs. past based on the event date
                  // (end date if present, else start date). Undated invitations are
                  // treated as upcoming so their confirm/decline actions stay available.
                  const todayKey = (() => {
                    const now = new Date();
                    const y = now.getFullYear();
                    const m = String(now.getMonth() + 1).padStart(2, "0");
                    const d = String(now.getDate()).padStart(2, "0");
                    return `${y}-${m}-${d}`;
                  })();
                  const isUpcomingInvitation = (inv: EventInvitation): boolean => {
                    const key = eventDateKey(inv.end_date) ?? eventDateKey(inv.event_date);
                    if (!key) return true; // undated → keep it actionable
                    return key >= todayKey;
                  };
                  const upcomingInvitations = visibleInvitations.filter(isUpcomingInvitation);
                  const pastInvitations = visibleInvitations.filter((inv) => !isUpcomingInvitation(inv));
                  const nonEventCount = (entriesByEvent.get("__none__") ?? []).length;
                  const hasPastRows =
                    pastInvitations.length > 0 || orphanedPerEvents.length > 0 || nonEventCount > 0;

                  // Renders an invitation event row plus its time-entry sub-rows.
                  // Confirm/Decline only appear when `showResponseButtons` is true
                  // (upcoming events) — you can't confirm attendance for a past event.
                  const renderInvitationRow = (inv: EventInvitation, showResponseButtons: boolean) => {
                    const agg = perEventMap.get(inv.event_id);
                    const eventEntries = entriesByEvent.get(inv.event_id) ?? [];
                    // When a pending invitation still needs a confirm/decline response,
                    // hide the timesheet action — there's nothing to attest yet.
                    const hasResponseButtons =
                      showResponseButtons &&
                      inv.source === "team" &&
                      !!inv.confirmation_token &&
                      (inv.status === "pending_confirmation" || inv.status === "pending");
                    return (
                      <Fragment key={`inv-${inv.source}-${inv.id}`}>
                        {/* Event row */}
                        <tr className="border-t border-gray-200 bg-white hover:bg-gray-50 transition-colors">
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
                            {isOwnProfile && inv.stand_leader && inv.status !== "declined" && (
                              <Link href={`/check-in?eventId=${encodeURIComponent(inv.event_id)}`}
                                title="You're a stand leader for this event — open check-in to check in the team"
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                Check in
                              </Link>
                            )}
                            {hasResponseButtons && (
                              <span className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={respondingInvitationId === inv.id}
                                  onClick={() => respondToInvitation(inv, "confirm")}
                                  title={isOwnProfile ? "Confirm your attendance for this event" : "Confirm attendance for this employee"}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                  {respondingInvitationId === inv.id ? "Saving…" : "Confirm"}
                                </button>
                                <button
                                  type="button"
                                  disabled={respondingInvitationId === inv.id}
                                  onClick={() => respondToInvitation(inv, "decline")}
                                  title={isOwnProfile ? "Decline this event" : "Decline this event for this employee"}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                  Decline
                                </button>
                              </span>
                            )}
                            {inv.status === "declined" && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border border-red-200 bg-red-50 text-red-700">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                {isOwnProfile ? "You declined" : "Declined"}
                              </span>
                            )}
                            {(inv.status === "confirmed" || inv.status === "declined") && (() => {
                              const cancelReq = cancellationRequestByInvitation.get(`${inv.source}-${inv.id}`);
                              if (cancelReq?.status === "pending") {
                                return (
                                  <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border border-amber-200 bg-amber-50 text-amber-700">
                                    Cancellation Pending
                                  </span>
                                );
                              }

                              const hoursUntilStart = getHoursUntilEventStart(inv);
                              const tooCloseToEvent = hoursUntilStart !== null && hoursUntilStart < MIN_HOURS_BEFORE_EVENT_CANCELLATION;
                              const cancelDisabledTitle = `Cancellations must be requested at least ${MIN_HOURS_BEFORE_EVENT_CANCELLATION} hours before the event starts`;

                              if (cancelReq?.status === "rejected") {
                                return (
                                  <span className="inline-flex items-center gap-1.5">
                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border border-gray-200 bg-gray-50 text-gray-500">
                                      Cancellation Rejected
                                    </span>
                                    <button
                                      type="button"
                                      disabled={tooCloseToEvent}
                                      onClick={() => openCancelModal(inv)}
                                      title={tooCloseToEvent ? cancelDisabledTitle : "Submit a new cancellation request for approval"}
                                      className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border border-red-200 bg-white text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white transition-colors"
                                    >
                                      Request Again
                                    </button>
                                  </span>
                                );
                              }
                              return (
                                <button
                                  type="button"
                                  disabled={tooCloseToEvent}
                                  onClick={() => openCancelModal(inv)}
                                  title={tooCloseToEvent ? cancelDisabledTitle : "Request to cancel this already-responded invitation (requires approval)"}
                                  className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border border-red-200 bg-white text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white transition-colors"
                                >
                                  Cancel Invitation
                                </button>
                              );
                            })()}
                            {!hasResponseButtons && renderTimeSheetAction(
                              inv.event_id,
                              agg?.timesheet_attestation_status,
                              agg?.timesheet_edit_request_status,
                              inv.event_name || inv.event_id
                            )}
                            {invitationFeedback[inv.id] && (
                              <span className={`w-full text-xs ${invitationFeedback[inv.id].type === "error" ? "text-red-600" : "text-green-600"}`}>
                                {invitationFeedback[inv.id].text}
                              </span>
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
                      </Fragment>
                    );
                  };

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
                          {visibleInvitations.length === 0 && orphanedPerEvents.length === 0 && (entriesByEvent.get("__none__") ?? []).length === 0 && (
                            <tr>
                              <td colSpan={7} className="p-6 text-center text-gray-500">No event invitations yet.</td>
                            </tr>
                          )}
                          {/* Upcoming events — confirm/decline cues live here */}
                          {upcomingInvitations.length > 0 && (
                            <tr className="bg-blue-50 border-t border-blue-100">
                              <td colSpan={7} className="px-3 py-2 text-xs font-bold uppercase keeping-wide text-blue-700">
                                Upcoming Events
                              </td>
                            </tr>
                          )}
                          {upcomingInvitations.map((inv) => renderInvitationRow(inv, true))}
                          {/* Past events — recorded history, no confirm/decline actions */}
                          {hasPastRows && (
                            <tr className="bg-gray-100 border-t border-gray-200">
                              <td colSpan={7} className="px-3 py-2 text-xs font-bold uppercase keeping-wide text-gray-500">
                                Past Events
                              </td>
                            </tr>
                          )}
                          {pastInvitations.map((inv) => renderInvitationRow(inv, false))}
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

            {/* Invitation Cancellation Requests — filed from the row above, held pending
                until a privileged reviewer approves/rejects them here. */}
            {(cancellationRequestsLoading || cancellationRequests.length > 0) && (
              <section className="mb-8">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Invitation Cancellation Requests</h2>
                  {!cancellationRequestsLoading && (
                    <span className="text-sm text-gray-500">
                      {cancellationRequests.length} request{cancellationRequests.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <div className="apple-card divide-y divide-gray-100">
                  {cancellationRequestsLoading ? (
                    <div className="px-6 py-4 text-sm text-gray-400">Loading...</div>
                  ) : (
                    cancellationRequests.map((req) => {
                      const eventInfo = Array.isArray(req.events) ? req.events[0] : req.events;
                      const statusStyles: Record<string, string> = {
                        pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
                        approved: "bg-green-50 text-green-700 border-green-200",
                        rejected: "bg-red-50 text-red-700 border-red-200",
                      };
                      return (
                        <div key={req.id} className="px-6 py-4 flex flex-col sm:flex-row sm:items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900">
                              {eventInfo?.event_name || "Event"}
                              {eventInfo?.event_date ? ` — ${formatEventDate(eventInfo.event_date)}` : ""}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5 capitalize">
                              Cancelling a {req.previous_status || "responded"} invitation
                            </p>
                            <p className="text-xs text-gray-600 mt-1 leading-relaxed">Reason: {req.reason}</p>
                            {req.review_notes && (
                              <p className="text-xs text-gray-500 mt-1 leading-relaxed">Reviewer notes: {req.review_notes}</p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${statusStyles[req.status] ?? "bg-gray-50 text-gray-700 border-gray-200"}`}>
                              {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                            </span>
                            <p className="text-xs text-gray-400">{formatDate(req.created_at)}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            )}

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

                  <form onSubmit={submitSickLeaveRequest} className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <div>
                      <label
                        htmlFor="sick-request-event"
                        className="mb-1 block text-xs font-semibold uppercase keeping-wide text-blue-900"
                      >
                        Event
                      </label>
                      <select
                        id="sick-request-event"
                        required
                        value={sickRequestEventId}
                        onChange={(event) => {
                          const nextEventId = event.target.value;
                          setSickRequestEventId(nextEventId);
                          const option = sickRequestEventOptions.find(
                            (opt) => opt.event_id === nextEventId
                          );
                          if (option?.event_date) {
                            setSickRequestDate(option.event_date.slice(0, 10));
                          }
                        }}
                        className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none"
                      >
                        <option value="" disabled>
                          {sickRequestEventOptions.length === 0
                            ? "No events assigned"
                            : "Select an event"}
                        </option>
                        {sickRequestEventOptions.map((option) => (
                          <option key={option.event_id} value={option.event_id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

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
                        min={sickRequestMinDate}
                        max={sickRequestMaxDate}
                        value={sickRequestDate}
                        onChange={(event) => setSickRequestDate(event.target.value)}
                        className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none"
                      />
                      {sickRequestMinDate && (
                        <p className="mt-1 text-[11px] text-blue-700">
                          Event runs {formatEventDate(sickRequestMinDate)}
                          {sickRequestMaxDate && sickRequestMaxDate !== sickRequestMinDate
                            ? ` — ${formatEventDate(sickRequestMaxDate)}`
                            : ""}
                        </p>
                      )}
                    </div>

                    <div className="md:col-span-4">
                      <label
                        htmlFor="sick-request-reason"
                        className="mb-1 block text-xs font-semibold uppercase keeping-wide text-blue-900"
                      >
                        Reason
                      </label>
                      <textarea
                        id="sick-request-reason"
                        required
                        rows={2}
                        value={sickRequestReason}
                        onChange={(event) => setSickRequestReason(event.target.value)}
                        placeholder="Briefly describe the reason for this sick leave request"
                        className="w-full resize-none rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none"
                      />
                    </div>

                    <div className="flex items-end md:col-span-4 md:justify-end">
                      <button
                        type="submit"
                        disabled={submittingSickRequest}
                        className="inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300 md:w-auto md:px-8"
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
                            <span className="font-medium text-gray-900">{formatEventDate(entry.start_date)} — {formatEventDate(entry.end_date)}</span>
                            <span className="text-gray-500">{formatHours(entry.duration_hours)} hrs</span>
                            {entry.event_name && (
                              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                                {entry.event_name}
                              </span>
                            )}
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

                {/* Sick Leave Pay Sheets */}
                <div className="border-t border-gray-100 pt-4">
                  <p className="text-sm font-semibold text-gray-900 mb-2">Sick Leave Pay Sheets</p>
                  {sickLeavePaysheets.length === 0 ? (
                    <div className="text-center py-3 text-sm text-gray-400">
                      No sick leave pay sheets yet.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {sickLeavePaysheets.map((ps) => (
                        <div key={ps.id} className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm">
                          <div className="flex items-center gap-4 text-gray-700">
                            <span className="font-medium text-gray-900">Payment date: {formatDate(ps.payment_date)}</span>
                            <span className="text-gray-500">{formatHours(ps.hours)} hrs</span>
                            <span className="text-gray-500">${ps.amount.toFixed(2)}</span>
                            {ps.notes && <span className="text-gray-400 text-xs">{ps.notes}</span>}
                          </div>
                          <span className={`px-2 py-0.5 text-xs font-semibold capitalize border rounded-full ${ps.status === "paid" ? "bg-green-100 text-green-700 border-green-200" : "bg-blue-100 text-blue-700 border-blue-200"}`}>
                            {ps.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
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

            {/* Data Edition Request */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 keeping-tight mb-3">request data update</h2>
              <div className="apple-card p-6">
                <p className="text-sm text-gray-500 mb-5">
                  Select the form below to request update.
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Document <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={dataEditRequestDoc}
                      onChange={(e) => {
                        setDataEditRequestDoc(e.target.value);
                        setDataEditRequestError("");
                        setDataEditRequestSuccess("");
                      }}
                      className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 bg-white"
                    >
                      <option value="">Select a document…</option>
                      {pdfForms.length > 0 && (
                        <optgroup label="Onboarding Forms">
                          {Array.from(new Map(pdfForms.map((f) => [f.display_name, f])).values()).map((form) => (
                            <option key={form.form_name} value={form.display_name}>
                              {form.display_name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {customFormsList.filter((form) =>
                        pdfForms.some((p) => matchesCustomFormSubmission(p, form))
                      ).length > 0 && (
                        <optgroup label="Custom Forms">
                          {Array.from(
                            new Map(
                              customFormsList
                                .filter((form) => pdfForms.some((p) => matchesCustomFormSubmission(p, form)))
                                .map((form) => [form.title, form])
                            ).values()
                          ).map((form) => (
                            <option key={form.id} value={form.title}>
                              {form.title}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    {pdfForms.length === 0 && customFormsList.filter((f) => pdfForms.some((p) => matchesCustomFormSubmission(p, f))).length === 0 && (
                      <p className="mt-1.5 text-xs text-gray-400">No submitted documents found. Submit your onboarding forms first.</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Reason <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <textarea
                      value={dataEditRequestReason}
                      onChange={(e) => setDataEditRequestReason(e.target.value)}
                      rows={3}
                      placeholder="Describe what needs to be corrected…"
                      className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 resize-none"
                    />
                  </div>

                  {dataEditRequestError && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {dataEditRequestError}
                    </div>
                  )}

                  {dataEditRequestSuccess && (
                    <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                      {dataEditRequestSuccess}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void submitDataEditRequest()}
                      disabled={submittingDataEditRequest || !dataEditRequestDoc}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                      {submittingDataEditRequest ? "Sending…" : "Submit Request"}
                    </button>
                  </div>
                </div>

                {/* Request history */}
                {(dataEditRequestsLoading || dataEditRequests.length > 0) && (
                  <div className="mt-6 pt-6 border-t border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Request History</h3>
                    {dataEditRequestsLoading ? (
                      <div className="flex items-center gap-2 text-sm text-gray-400">
                        <div className="apple-spinner w-4 h-4" />
                        Loading…
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {dataEditRequests.map((req) => (
                          <div key={req.id} className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{req.document_name}</p>
                              {req.reason && (
                                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{req.reason}</p>
                              )}
                              {req.review_notes && (
                                <p className="text-xs text-blue-700 mt-0.5 italic">{req.review_notes}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${
                                req.status === 'approved'
                                  ? 'bg-green-50 text-green-700 border-green-200'
                                  : req.status === 'rejected'
                                  ? 'bg-red-50 text-red-700 border-red-200'
                                  : req.status === 'sent'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                                  : 'bg-amber-50 text-amber-700 border-amber-200'
                              }`}>
                                {req.status === 'approved' ? 'Approved' : req.status === 'rejected' ? 'Rejected' : req.status === 'sent' ? 'Form Sent' : 'Pending'}
                              </span>
                              <span className="text-xs text-gray-400">{formatDate(req.created_at)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
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
              {/* Under construction disclaimer */}
              <div className="px-6 py-3 bg-amber-50 border-b border-amber-200 flex items-start gap-2">
                <svg className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
                </svg>
                <p className="text-sm text-amber-800">
                  <span className="font-semibold">Under construction.</span> This section is a work in progress.
                  
                </p>
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

          {/* Inbox: every app-generated email sent to this employee */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <h2 className="text-base font-semibold text-gray-900">Inbox</h2>
                <div className="ml-auto flex items-center gap-3">
                  {!emailInboxLoading && !emailInboxError && (
                    <span className="text-xs text-gray-400">{emailInbox.length} email{emailInbox.length !== 1 ? "s" : ""}</span>
                  )}
                  {canRespondToInbox && (
                    <button
                      type="button"
                      onClick={openNewMessage}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      New Message
                    </button>
                  )}
                </div>
              </div>
              <div className="divide-y divide-gray-50">
                {emailInboxLoading ? (
                  <div className="px-6 py-4 text-sm text-gray-400">Loading...</div>
                ) : emailInboxError ? (
                  <div className="px-6 py-4 text-sm text-red-600">
                    Could not load inbox: {emailInboxError}
                  </div>
                ) : emailInbox.length === 0 ? (
                  <div className="px-6 py-8 text-center text-sm text-gray-400">No emails sent to this employee yet.</div>
                ) : (
                  emailInbox.map((mail) => (
                    <button
                      key={mail.id}
                      type="button"
                      onClick={() => openInboxEmail(mail)}
                      className="w-full text-left px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 hover:bg-gray-50 transition-colors"
                    >
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border shrink-0 ${
                        mail.status === "failed"
                          ? "bg-red-50 text-red-700 border-red-200"
                          : mail.read_at
                          ? "bg-blue-50 text-blue-700 border-blue-200"
                          : "bg-gray-100 text-gray-600 border-gray-200"
                      }`}>
                        {mail.status === "failed" ? "Failed" : mail.read_at ? "Read" : "Unread"}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{mail.subject}</p>
                        <p className="text-xs text-gray-500 mt-0.5 truncate">
                          From {mail.from_address}{mail.recipient_type === "cc" ? " · CC'd" : ""}
                        </p>
                        {mail.status === "failed" && mail.error_message && (
                          <p className="text-xs text-red-600 mt-0.5">{mail.error_message}</p>
                        )}
                      </div>

                      <span className="text-xs text-gray-400 shrink-0">
                        {new Date(mail.created_at).toLocaleString(undefined, {
                          month: "short", day: "numeric", year: "numeric",
                          hour: "numeric", minute: "2-digit", hour12: true,
                        })}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </section>

          {selectedInboxEmail && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
              onClick={() => setSelectedInboxEmail(null)}
            >
              <div
                className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-6 py-4">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-gray-900 truncate">{selectedInboxEmail.subject}</h3>
                    <p className="mt-1 text-xs text-gray-500">
                      From {selectedInboxEmail.from_address} · To {selectedInboxEmail.recipient_email}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {new Date(selectedInboxEmail.created_at).toLocaleString(undefined, {
                        month: "short", day: "numeric", year: "numeric",
                        hour: "numeric", minute: "2-digit", hour12: true,
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canRespondToInbox && (
                      <button
                        type="button"
                        onClick={() => {
                          const mail = selectedInboxEmail;
                          setSelectedInboxEmail(null);
                          if (mail) openReplyToEmail(mail);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17l-5-5 5-5M4 12h13a4 4 0 014 4v1" />
                        </svg>
                        Reply
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedInboxEmail(null)}
                      className="rounded-xl border border-gray-200 p-2 text-gray-500 transition hover:bg-gray-50 hover:text-gray-700"
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-hidden bg-gray-50">
                  <iframe
                    title="Email preview"
                    sandbox=""
                    srcDoc={selectedInboxEmail.html_body}
                    className="h-[65vh] w-full border-0 bg-white"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Inbox compose panel: shared by "New Message" and "Reply" */}
          {composeOpen && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
              onClick={closeCompose}
            >
              <div
                className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-6 py-4">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {composeReplyTo ? "Reply" : "New Message"}
                    </h3>
                    <p className="mt-1 text-xs text-gray-500 truncate">
                      Regarding {employee?.first_name} {employee?.last_name}
                      {employee?.email ? ` (${employee.email})` : ""}
                      {composeReplyTo ? ` · Replying to "${composeReplyTo.subject}"` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeCompose}
                    disabled={composeSending}
                    className="rounded-xl border border-gray-200 p-2 text-gray-500 transition hover:bg-gray-50 hover:text-gray-700 shrink-0 disabled:opacity-50"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
                    <input
                      type="text"
                      value={composeSubject}
                      onChange={(e) => setComposeSubject(e.target.value)}
                      maxLength={200}
                      disabled={composeSending}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                      placeholder="Subject"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Message</label>
                    <textarea
                      value={composeMessage}
                      onChange={(e) => setComposeMessage(e.target.value)}
                      maxLength={5000}
                      disabled={composeSending}
                      rows={8}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 resize-none"
                      placeholder="Write your message..."
                    />
                    <p className="mt-1 text-right text-[11px] text-gray-400">{composeMessage.length}/5000</p>
                  </div>
                  {composeError && (
                    <p className="text-sm text-red-600">{composeError}</p>
                  )}
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
                  <button
                    type="button"
                    onClick={closeCompose}
                    disabled={composeSending}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitCompose}
                    disabled={composeSending || !composeSubject.trim() || !composeMessage.trim()}
                    className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {composeSending ? "Sending..." : "Send"}
                  </button>
                </div>
              </div>
            </div>
          )}

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

          </>
        )}

      </div>
    </div>
  );
}
