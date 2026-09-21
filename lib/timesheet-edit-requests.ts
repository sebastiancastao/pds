// Shared rules for the timesheet edit permission workflow.
//
// A timesheet that has been attested (or whose attestation was rejected) is
// locked. To change it, the worker or a privileged user files an edit request;
// a reviewer approves or rejects it. An approved request re-opens the timesheet
// for exactly one correction, after which it is closed as "completed".
//
// This file is imported by both API routes and client components, so it must
// stay free of server-only imports.

export const TIMESHEET_EDIT_STATUSES = [
  "submitted",
  "in_review",
  "approved",
  "rejected",
  "completed",
  "cancelled",
] as const;

export type TimesheetEditStatus = (typeof TIMESHEET_EDIT_STATUSES)[number];

// Requests still waiting on a reviewer decision.
export const OPEN_TIMESHEET_EDIT_STATUSES: readonly TimesheetEditStatus[] = [
  "submitted",
  "in_review",
];

// Requests that block filing a new one for the same event and worker: still
// waiting on a decision, or approved and not yet used.
export const ACTIVE_TIMESHEET_EDIT_STATUSES: readonly TimesheetEditStatus[] = [
  "submitted",
  "in_review",
  "approved",
];

// Roles that may approve or reject requests, and may also file them on behalf
// of a worker. Matches the roles allowed on the /employees list.
export const TIMESHEET_EDIT_REVIEW_ROLES: ReadonlySet<string> = new Set([
  "admin",
  "exec",
  "hr",
  "hr_admin",
  "manager",
  "supervisor",
  "supervisor2",
  "supervisor3",
]);

export const TIMESHEET_EDIT_REASON_MAX_LENGTH = 2000;

// Allowed status changes. Rejected, completed and cancelled are terminal: a new
// request has to be filed instead of reviving an old one.
const TRANSITIONS: Record<TimesheetEditStatus, readonly TimesheetEditStatus[]> = {
  submitted: ["in_review", "approved", "rejected", "cancelled"],
  in_review: ["approved", "rejected", "cancelled"],
  // "cancelled" revokes an approval that has not been used yet.
  approved: ["cancelled", "completed"],
  rejected: [],
  completed: [],
  cancelled: [],
};

export function isTimesheetEditStatus(value: unknown): value is TimesheetEditStatus {
  return (
    typeof value === "string" &&
    (TIMESHEET_EDIT_STATUSES as readonly string[]).includes(value)
  );
}

export function isTimesheetEditReviewer(role: string | null | undefined): boolean {
  return TIMESHEET_EDIT_REVIEW_ROLES.has(String(role || "").trim().toLowerCase());
}

export function isOpenTimesheetEditStatus(status: string | null | undefined): boolean {
  return (OPEN_TIMESHEET_EDIT_STATUSES as readonly string[]).includes(String(status || ""));
}

export function canTransitionTimesheetEditRequest(
  from: string | null | undefined,
  to: string | null | undefined
): boolean {
  if (!isTimesheetEditStatus(from) || !isTimesheetEditStatus(to)) return false;
  return TRANSITIONS[from].includes(to);
}

// What a non-reviewer (the requester or the worker) may do to a request:
// withdraw it while it is still waiting on a decision.
export function canRequesterWithdraw(status: string | null | undefined): boolean {
  return isOpenTimesheetEditStatus(status);
}

export type TimesheetEditRequest = {
  id: string;
  eventId: string;
  eventName: string;
  eventDate: string | null;
  venue: string | null;
  city: string | null;
  state: string | null;
  userId: string;
  workerName: string | null;
  workerEmail: string | null;
  workerRole: string | null;
  requestedBy: string;
  requesterName: string | null;
  requesterEmail: string | null;
  requesterRole: string | null;
  requestReason: string;
  // Times the requester wants on the timesheet. Null for a reason-only request.
  requestedChanges: TimesheetEditProposal | null;
  status: string;
  reviewNotes: string | null;
  reviewedBy: string | null;
  reviewerName: string | null;
  reviewerEmail: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TimesheetEditViewer = {
  id: string;
  role: string;
  canReview: boolean;
};

export function timesheetEditStatusLabel(status: string): string {
  if (status === "cancelled") return "Cancelled";
  return String(status || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/* ------------------------------------------------------------------ */
/* Proposed times                                                      */
/* ------------------------------------------------------------------ */

// The six fields of a timesheet, in the order they happen during a shift. The
// keys match the timesheet form and the submit endpoint.
export const TIMESHEET_TIME_FIELDS = [
  { key: "firstIn", label: "Clock In" },
  { key: "firstMealStart", label: "Meal 1 Start" },
  { key: "lastMealEnd", label: "Meal 1 End" },
  { key: "secondMealStart", label: "Meal 2 Start" },
  { key: "secondMealEnd", label: "Meal 2 End" },
  { key: "lastOut", label: "Clock Out" },
] as const;

export type TimesheetTimeKey = (typeof TIMESHEET_TIME_FIELDS)[number]["key"];

// Each value is "HH:MM" in 24 hour event local time, or "" when not set.
export type TimesheetTimes = Record<TimesheetTimeKey, string>;

export type TimesheetEditProposal = {
  // The day the times apply to. Only meaningful for multi day events.
  workDate: string | null;
  requested: TimesheetTimes;
  // What was recorded when the request was filed, for comparison. Null when it
  // could not be loaded.
  previous: TimesheetTimes | null;
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function emptyTimesheetTimes(): TimesheetTimes {
  return {
    firstIn: "",
    firstMealStart: "",
    lastMealEnd: "",
    secondMealStart: "",
    secondMealEnd: "",
    lastOut: "",
  };
}

// Keys whose value differs. With no previous times, every filled field counts.
export function changedTimeKeys(
  previous: TimesheetTimes | null,
  requested: TimesheetTimes
): TimesheetTimeKey[] {
  return TIMESHEET_TIME_FIELDS.map((field) => field.key).filter(
    (key) => (previous ? previous[key] : "") !== requested[key]
  );
}

// The same rules the submit endpoint applies: a shift needs a clock in and a
// clock out, and each meal needs both a start and an end.
export function validateTimesheetTimes(times: TimesheetTimes): string | null {
  for (const field of TIMESHEET_TIME_FIELDS) {
    if (times[field.key] && !TIME_PATTERN.test(times[field.key])) {
      return `${field.label} must be a valid time.`;
    }
  }
  if (!times.firstIn || !times.lastOut) {
    return "Clock In and Clock Out are both required.";
  }
  if (!!times.firstMealStart !== !!times.lastMealEnd) {
    return "Meal 1 needs both a start and an end time.";
  }
  if (!!times.secondMealStart !== !!times.secondMealEnd) {
    return "Meal 2 needs both a start and an end time.";
  }
  return null;
}

function readTimes(raw: unknown): TimesheetTimes | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const times = emptyTimesheetTimes();
  for (const field of TIMESHEET_TIME_FIELDS) {
    const value = source[field.key];
    times[field.key] = typeof value === "string" ? value.trim() : "";
  }
  return times;
}

function isRealDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

// Checks and normalises the proposal sent with a request. Anything that is not
// a well formed proposal is refused. A proposal that changes nothing is
// dropped, so the request only carries its reason.
export function parseTimesheetEditProposal(
  raw: unknown
): { ok: true; value: TimesheetEditProposal | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "The requested times are not valid." };
  }
  const source = raw as Record<string, unknown>;

  const requested = readTimes(source.requested);
  if (!requested) {
    return { ok: false, error: "The requested times are missing." };
  }
  const requestedError = validateTimesheetTimes(requested);
  if (requestedError) return { ok: false, error: requestedError };

  let previous: TimesheetTimes | null = null;
  if (source.previous !== null && source.previous !== undefined) {
    previous = readTimes(source.previous);
    if (!previous) return { ok: false, error: "The current times are not valid." };
    for (const field of TIMESHEET_TIME_FIELDS) {
      if (previous[field.key] && !TIME_PATTERN.test(previous[field.key])) {
        return { ok: false, error: "The current times are not valid." };
      }
    }
  }

  let workDate: string | null = null;
  if (typeof source.workDate === "string" && source.workDate.trim()) {
    workDate = source.workDate.trim();
    if (!isRealDate(workDate)) {
      return { ok: false, error: "The work date is not valid." };
    }
  }

  if (previous && changedTimeKeys(previous, requested).length === 0) {
    return { ok: true, value: null };
  }
  return { ok: true, value: { workDate, requested, previous } };
}

// "18:30" becomes "6:30 PM". Anything unexpected is shown as typed.
export function formatClock12h(value: string | null | undefined): string {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return value ? String(value) : "-";
  const hours = Number(match[1]);
  const period = hours >= 12 ? "PM" : "AM";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${match[2]} ${period}`;
}
