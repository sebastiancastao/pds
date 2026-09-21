// Shared types, input validation and dashboard aggregation for venue data.
// Pure functions only (no I/O) so the API routes, the CSV importer and the
// dashboard all apply exactly the same rules.

export const VENUE_DATA_ROLES = ['exec', 'admin'] as const;
export const MAX_IMPORT_ROWS = 500;

export type VenueDataEntry = {
  id: string;
  venue_id: string;
  event_date: string; // YYYY-MM-DD
  event_name: string | null;
  attendance: number | null;
  capacity: number | null;
  gross_sales: number | null;
  staff_count: number | null;
  notes: string | null;
  source: 'manual' | 'csv';
  created_at: string;
  updated_at: string;
};

export type VenueSummary = {
  id: string;
  venue_name: string;
  city: string | null;
  state: string | null;
};

export type VenueDataEntryWithVenue = VenueDataEntry & { venue: VenueSummary | null };

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

export type NormalizedEntry = {
  event_date: string;
  event_name: string | null;
  attendance: number | null;
  capacity: number | null;
  gross_sales: number | null;
  staff_count: number | null;
  notes: string | null;
};

export type NormalizeResult =
  | { ok: true; value: NormalizedEntry }
  | { ok: false; error: string };

const MAX_ATTENDANCE = 1_000_000;
const MAX_CAPACITY = 1_000_000;
const MAX_GROSS_SALES = 100_000_000;
const MAX_STAFF = 10_000;
const MAX_EVENT_NAME = 200;
const MAX_NOTES = 2000;
const EARLIEST_EVENT_DATE = '2000-01-01';

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

// Accepts 1234, "1,234", "$1,234.50". Returns NaN for anything else.
function parseNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string') return NaN;
  const cleaned = value.trim().replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Accepts YYYY-MM-DD (optionally followed by a time) and M/D/YYYY or M/D/YY
// (what Excel writes to CSV). Returns YYYY-MM-DD, or null when it is not a real date.
export function parseEventDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  let year: number;
  let month: number;
  let day: number;

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (us) {
    month = Number(us[1]);
    day = Number(us[2]);
    year = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
  } else {
    return null;
  }

  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

type NumberRule = { label: string; max: number; integer: boolean; min: number };

function readNumber(raw: unknown, rule: NumberRule, errors: string[]): number | null {
  if (isBlank(raw)) return null;
  const n = parseNumber(raw);
  if (Number.isNaN(n)) {
    errors.push(`${rule.label} must be a number`);
    return null;
  }
  if (rule.integer && !Number.isInteger(n)) {
    errors.push(`${rule.label} must be a whole number`);
    return null;
  }
  if (n < rule.min) {
    errors.push(rule.min > 0 ? `${rule.label} must be greater than 0` : `${rule.label} cannot be negative`);
    return null;
  }
  if (n > rule.max) {
    errors.push(`${rule.label} is unrealistically large (max ${rule.max.toLocaleString('en-US')})`);
    return null;
  }
  return rule.integer ? n : Math.round(n * 100) / 100;
}

function readText(raw: unknown, label: string, max: number, errors: string[]): string | null {
  if (isBlank(raw)) return null;
  const text = String(raw).trim();
  if (text.length > max) {
    errors.push(`${label} is too long (max ${max} characters)`);
    return null;
  }
  return text;
}

// Validates and cleans one entry (the venue is resolved by the caller).
export function normalizeEntry(raw: Record<string, unknown>, now: Date = new Date()): NormalizeResult {
  const errors: string[] = [];

  const event_date = parseEventDate(raw.event_date);
  if (!event_date) {
    errors.push('Event date is missing or not a valid date (use YYYY-MM-DD or M/D/YYYY)');
  } else {
    // Small slack so a venue in a timezone ahead of UTC can still report "today".
    const latest = new Date(now.getTime() + 36 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (event_date > latest) errors.push('Event date cannot be in the future');
    if (event_date < EARLIEST_EVENT_DATE) errors.push('Event date is too far in the past');
  }

  const attendance = readNumber(raw.attendance, { label: 'Attendance', max: MAX_ATTENDANCE, integer: true, min: 0 }, errors);
  const capacity = readNumber(raw.capacity, { label: 'Capacity', max: MAX_CAPACITY, integer: true, min: 1 }, errors);
  const gross_sales = readNumber(raw.gross_sales, { label: 'Gross sales', max: MAX_GROSS_SALES, integer: false, min: 0 }, errors);
  const staff_count = readNumber(raw.staff_count, { label: 'Staff count', max: MAX_STAFF, integer: true, min: 0 }, errors);
  const event_name = readText(raw.event_name, 'Event name', MAX_EVENT_NAME, errors);
  const notes = readText(raw.notes, 'Notes', MAX_NOTES, errors);

  if (errors.length === 0 && attendance === null && capacity === null && gross_sales === null && staff_count === null) {
    errors.push('Enter at least one of attendance, capacity, gross sales or staff count');
  }

  if (errors.length > 0 || !event_date) return { ok: false, error: errors.join('; ') };
  return {
    ok: true,
    value: { event_date, event_name, attendance, capacity, gross_sales, staff_count, notes },
  };
}

// Same identity the database enforces with its unique index.
export function entryKey(venueId: string, eventDate: string, eventName: string | null): string {
  return `${venueId}|${eventDate}|${(eventName ?? '').trim().toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Dashboard aggregation
// ---------------------------------------------------------------------------

export type DashboardEntry = {
  id: string;
  venue_id: string;
  venue_name: string;
  city: string | null;
  state: string | null;
  event_date: string;
  event_name: string | null;
  attendance: number | null;
  capacity: number | null;
  gross_sales: number | null;
  staff_count: number | null;
  created_at: string;
};

export type Metrics = {
  events: number;
  attendance: number;
  grossSales: number;
  /** Gross sales per attendee, over events that reported both. */
  perCap: number | null;
  /** Attendance divided by capacity (1 = full), over events that reported both. */
  occupancy: number | null;
  /** Gross sales per staff member, over events that reported both. */
  salesPerStaff: number | null;
  /** Average staff count, over events that reported it. */
  avgStaff: number | null;
};

export type MonthBucket = {
  month: string; // YYYY-MM
  events: number;
  attendance: number;
  grossSales: number;
};

export type VenueBreakdownRow = Metrics & {
  venueId: string;
  venueName: string;
  city: string | null;
  state: string | null;
  lastEventDate: string;
};

export type VenueDashboardData = {
  totals: Metrics;
  venuesReporting: number;
  firstEventDate: string | null;
  lastEventDate: string | null;
  monthly: MonthBucket[];
  byVenue: VenueBreakdownRow[];
  recent: DashboardEntry[];
};

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

// Sums are kept in integer cents so long lists of 2-decimal amounts do not drift.
class Accumulator {
  events = 0;
  attendance = 0;
  grossCents = 0;
  perCapCents = 0;
  perCapAttendance = 0;
  occupancyAttendance = 0;
  occupancyCapacity = 0;
  staffSalesCents = 0;
  staffForSales = 0;
  staffTotal = 0;
  staffReports = 0;

  add(e: DashboardEntry) {
    this.events += 1;
    const cents = e.gross_sales === null ? null : Math.round(e.gross_sales * 100);
    if (e.attendance !== null) this.attendance += e.attendance;
    if (cents !== null) this.grossCents += cents;
    if (cents !== null && e.attendance !== null && e.attendance > 0) {
      this.perCapCents += cents;
      this.perCapAttendance += e.attendance;
    }
    if (e.attendance !== null && e.capacity !== null && e.capacity > 0) {
      this.occupancyAttendance += e.attendance;
      this.occupancyCapacity += e.capacity;
    }
    if (e.staff_count !== null) {
      this.staffTotal += e.staff_count;
      this.staffReports += 1;
    }
    if (cents !== null && e.staff_count !== null && e.staff_count > 0) {
      this.staffSalesCents += cents;
      this.staffForSales += e.staff_count;
    }
  }

  metrics(): Metrics {
    const perCap = ratio(this.perCapCents / 100, this.perCapAttendance);
    const salesPerStaff = ratio(this.staffSalesCents / 100, this.staffForSales);
    return {
      events: this.events,
      attendance: this.attendance,
      grossSales: this.grossCents / 100,
      perCap: perCap === null ? null : Math.round(perCap * 100) / 100,
      occupancy: ratio(this.occupancyAttendance, this.occupancyCapacity),
      salesPerStaff: salesPerStaff === null ? null : Math.round(salesPerStaff * 100) / 100,
      avgStaff: ratio(this.staffTotal, this.staffReports),
    };
  }
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`;
}

export function buildVenueDashboard(entries: DashboardEntry[]): VenueDashboardData {
  const totals = new Accumulator();
  const months = new Map<string, Accumulator>();
  const venues = new Map<string, { acc: Accumulator; entry: DashboardEntry; last: string }>();
  let first: string | null = null;
  let last: string | null = null;

  for (const e of entries) {
    totals.add(e);

    const month = e.event_date.slice(0, 7);
    let monthAcc = months.get(month);
    if (!monthAcc) {
      monthAcc = new Accumulator();
      months.set(month, monthAcc);
    }
    monthAcc.add(e);

    let venue = venues.get(e.venue_id);
    if (!venue) {
      venue = { acc: new Accumulator(), entry: e, last: e.event_date };
      venues.set(e.venue_id, venue);
    }
    venue.acc.add(e);
    if (e.event_date > venue.last) venue.last = e.event_date;

    if (first === null || e.event_date < first) first = e.event_date;
    if (last === null || e.event_date > last) last = e.event_date;
  }

  // Continuous month axis from the first to the last month that has data. Months in
  // between with no reports show as 0; months outside the data are not invented.
  const monthly: MonthBucket[] = [];
  if (first && last) {
    const lastMonth = last.slice(0, 7);
    let cursor = first.slice(0, 7);
    while (cursor <= lastMonth && monthly.length < 240) {
      const m = months.get(cursor)?.metrics();
      monthly.push({
        month: cursor,
        events: m?.events ?? 0,
        attendance: m?.attendance ?? 0,
        grossSales: m?.grossSales ?? 0,
      });
      cursor = nextMonth(cursor);
    }
  }

  const byVenue: VenueBreakdownRow[] = Array.from(venues.entries())
    .map(([venueId, v]) => ({
      venueId,
      venueName: v.entry.venue_name,
      city: v.entry.city,
      state: v.entry.state,
      lastEventDate: v.last,
      ...v.acc.metrics(),
    }))
    .sort(
      (a, b) =>
        b.grossSales - a.grossSales ||
        b.attendance - a.attendance ||
        a.venueName.localeCompare(b.venueName)
    );

  const recent = [...entries]
    .sort(
      (a, b) =>
        b.event_date.localeCompare(a.event_date) || b.created_at.localeCompare(a.created_at)
    )
    .slice(0, 10);

  return {
    totals: totals.metrics(),
    venuesReporting: venues.size,
    firstEventDate: first,
    lastEventDate: last,
    monthly,
    byVenue,
    recent,
  };
}
