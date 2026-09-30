// Side-by-side comparison of the system payroll (calculated from events on the
// HR dashboard Payroll tab) with an uploaded payroll spreadsheet, by vendor and
// by event. Pure functions: the page builds the system side with its own
// display helpers, so both sides show the same numbers HR sees on screen.

import { payrollRowName, roundMoney, type PayrollUploadRow } from "./payroll-upload";

export const COMPARE_AMOUNT_KEYS = [
  "hours",
  "regular_pay",
  "overtime_pay",
  "doubletime_pay",
  "commission_pay",
  "variable_incentive",
  "tips",
  "rest_break",
  "mileage_pay",
  "travel_pay",
  "reimbursement",
  "other",
  "bonus",
  "sick_pay",
  "total_gross_pay",
] as const;
export type CompareAmountKey = (typeof COMPARE_AMOUNT_KEYS)[number];
// null = this side has no such figure (the system has no Travel Pay or Bonus column).
export type CompareAmounts = Record<CompareAmountKey, number | null>;

export const COMPARE_AMOUNT_LABELS: Record<CompareAmountKey, string> = {
  hours: "Hours",
  regular_pay: "Regular Pay",
  overtime_pay: "Overtime Pay",
  doubletime_pay: "Double Time Pay",
  commission_pay: "Commission Pay",
  variable_incentive: "Variable Incentive",
  tips: "Tips",
  rest_break: "Rest Break",
  mileage_pay: "Mileage Pay",
  travel_pay: "Travel Pay",
  reimbursement: "Reimbursement",
  other: "Other",
  bonus: "Bonus",
  sick_pay: "Sick Pay",
  total_gross_pay: "Total Gross Pay",
};

export type SystemCompareLine = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  eventId: string;
  eventName: string;
  eventDate: string;
  venue: string;
  city: string;
  state: string;
  amounts: CompareAmounts;
};

export type SystemCompareVendor = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  amounts: CompareAmounts;
};

export type CompareStatus = "match" | "different" | "systemOnly" | "uploadOnly";

export type ComparePair = {
  key: string;
  name: string;
  email: string;
  system: CompareAmounts | null;
  upload: CompareAmounts | null;
  uploadLines: number;
  hoursDiff: number;
  grossDiff: number;
  status: CompareStatus;
};

export type VendorComparison = ComparePair & {
  sortName: string;
  // The vendor's events, system next to upload.
  events: Array<ComparePair & { eventLabel: string; venue: string; eventDate: string }>;
};

export type EventComparison = {
  key: string;
  eventName: string;
  venue: string;
  city: string;
  state: string;
  eventDate: string;
  inSystem: boolean;
  system: CompareAmounts | null;
  upload: CompareAmounts | null;
  hoursDiff: number;
  grossDiff: number;
  status: CompareStatus;
  employees: ComparePair[];
};

export type PayrollComparison = {
  vendors: VendorComparison[];
  events: EventComparison[];
  totals: { system: CompareAmounts; upload: CompareAmounts; grossDiff: number; hoursDiff: number };
  vendorCounts: Record<CompareStatus, number>;
  eventCounts: Record<CompareStatus, number>;
};

// Per line: the uploaded file rounds to cents and hours to 2 decimals.
const GROSS_TOLERANCE_PER_LINE = 0.05;
const HOURS_TOLERANCE_PER_LINE = 0.05;

const emptyAmounts = (): CompareAmounts =>
  Object.fromEntries(COMPARE_AMOUNT_KEYS.map((k) => [k, null])) as CompareAmounts;

const addAmounts = (target: CompareAmounts, source: CompareAmounts) => {
  COMPARE_AMOUNT_KEYS.forEach((k) => {
    const v = source[k];
    if (v === null || v === undefined) return;
    target[k] = (target[k] ?? 0) + Number(v);
  });
};

export const uploadRowAmounts = (row: PayrollUploadRow): CompareAmounts => ({
  hours: row.hours,
  regular_pay: row.regular_pay,
  overtime_pay: row.overtime_pay,
  doubletime_pay: row.doubletime_pay,
  commission_pay: row.commission_pay,
  variable_incentive: row.variable_incentive,
  tips: row.tips,
  rest_break: row.rest_break,
  mileage_pay: row.mileage_pay,
  travel_pay: row.travel_pay,
  reimbursement: row.reimbursement,
  other: row.other,
  bonus: row.bonus,
  sick_pay: row.sick_pay,
  total_gross_pay: row.total_gross_pay,
});

export const amountOf = (a: CompareAmounts | null, key: CompareAmountKey): number => Number(a?.[key] ?? 0);

const normText = (value: string | null | undefined) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Multi-day export rows are named "Event - 2026-07-10"; match them on the base name.
const normEventName = (value: string | null | undefined) =>
  normText(String(value || "").replace(/\s+-\s+\d{4}-\d{2}-\d{2}\s*$/, ""));

const normName = (first: string | null | undefined, last: string | null | undefined) => normText(`${first || ""} ${last || ""}`);

const statusFor = (
  system: CompareAmounts | null,
  upload: CompareAmounts | null,
  lines: number
): { status: CompareStatus; hoursDiff: number; grossDiff: number } => {
  const hoursDiff = roundMoney(amountOf(upload, "hours") - amountOf(system, "hours"));
  const grossDiff = roundMoney(amountOf(upload, "total_gross_pay") - amountOf(system, "total_gross_pay"));
  if (!system) return { status: "uploadOnly", hoursDiff, grossDiff };
  if (!upload) return { status: "systemOnly", hoursDiff, grossDiff };
  const n = Math.max(1, lines);
  const different = Math.abs(grossDiff) > GROSS_TOLERANCE_PER_LINE * n || Math.abs(hoursDiff) > HOURS_TOLERANCE_PER_LINE * n;
  return { status: different ? "different" : "match", hoursDiff, grossDiff };
};

const countStatuses = (items: Array<{ status: CompareStatus }>): Record<CompareStatus, number> => {
  const counts: Record<CompareStatus, number> = { match: 0, different: 0, systemOnly: 0, uploadOnly: 0 };
  items.forEach((i) => {
    counts[i.status] += 1;
  });
  return counts;
};

const STATUS_ORDER: Record<CompareStatus, number> = { different: 0, uploadOnly: 1, systemOnly: 2, match: 3 };

// System lines with no hours and no pay aren't worth listing as "missing from upload".
const isEmptySystem = (a: CompareAmounts) => Math.abs(amountOf(a, "total_gross_pay")) < 0.005 && Math.abs(amountOf(a, "hours")) < 0.005;

export function comparePayroll(
  systemLines: SystemCompareLine[],
  systemVendors: SystemCompareVendor[],
  uploadRows: PayrollUploadRow[]
): PayrollComparison {
  // ---- people: map each upload line to a system employee when possible ----
  const personKeyOfSystem = (s: { userId: string; email: string; firstName: string; lastName: string }) =>
    s.userId ? `u:${s.userId}` : s.email ? `e:${s.email.toLowerCase()}` : `n:${normName(s.firstName, s.lastName)}`;

  const people = new Map<string, { name: string; email: string; sortName: string }>();
  const byUserId = new Map<string, string>();
  const byEmail = new Map<string, string>();
  const byNameCount = new Map<string, string[]>();
  const rememberSystemPerson = (s: { userId: string; email: string; firstName: string; lastName: string }) => {
    const key = personKeyOfSystem(s);
    if (!people.has(key)) {
      people.set(key, {
        name: `${s.firstName || ""} ${s.lastName || ""}`.replace(/\s+/g, " ").trim() || s.email || "(no name)",
        email: s.email,
        sortName: `${normText(s.lastName)} ${normText(s.firstName)}`,
      });
    }
    if (s.userId) byUserId.set(s.userId, key);
    if (s.email) byEmail.set(s.email.toLowerCase(), key);
    const n = normName(s.firstName, s.lastName);
    if (n) {
      const list = byNameCount.get(n) || [];
      if (!list.includes(key)) list.push(key);
      byNameCount.set(n, list);
    }
  };
  systemVendors.forEach(rememberSystemPerson);
  systemLines.forEach(rememberSystemPerson);

  const personKeyOfUpload = (row: PayrollUploadRow): string => {
    if (row.user_id && byUserId.has(row.user_id)) return byUserId.get(row.user_id)!;
    const email = (row.email || "").toLowerCase();
    if (email && byEmail.has(email)) return byEmail.get(email)!;
    const n = normName(row.first_name, row.last_name);
    const byName = n ? byNameCount.get(n) : undefined;
    if (byName && byName.length === 1) return byName[0];
    const key = email ? `ue:${email}` : `un:${n}`;
    if (!people.has(key)) {
      people.set(key, {
        name: payrollRowName(row) || email || "(no name)",
        email,
        sortName: `${normText(row.last_name)} ${normText(row.first_name)}`,
      });
    }
    return key;
  };

  // ---- events: map each upload line to a system event when possible ----
  type SysEvent = { eventId: string; eventName: string; venue: string; city: string; state: string; eventDate: string };
  const sysEvents = new Map<string, SysEvent>();
  systemLines.forEach((l) => {
    if (!sysEvents.has(l.eventId)) {
      sysEvents.set(l.eventId, { eventId: l.eventId, eventName: l.eventName, venue: l.venue, city: l.city, state: l.state, eventDate: l.eventDate });
    }
  });
  const byVenueNameDate = new Map<string, string[]>();
  const byNameDate = new Map<string, string[]>();
  const byVenueName = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, id: string) => {
    const list = map.get(key) || [];
    if (!list.includes(id)) list.push(id);
    map.set(key, list);
  };
  sysEvents.forEach((e) => {
    const name = normEventName(e.eventName);
    const venue = normText(e.venue);
    const date = (e.eventDate || "").slice(0, 10);
    push(byVenueNameDate, `${venue}|${name}|${date}`, e.eventId);
    push(byNameDate, `${name}|${date}`, e.eventId);
    push(byVenueName, `${venue}|${name}`, e.eventId);
  });

  const eventKeyOfUpload = (row: PayrollUploadRow): string => {
    const name = normEventName(row.event_name);
    const venue = normText(row.venue);
    const date = (row.event_date || "").slice(0, 10);
    const tries = [byVenueNameDate.get(`${venue}|${name}|${date}`), byNameDate.get(`${name}|${date}`), byVenueName.get(`${venue}|${name}`)];
    for (const hit of tries) {
      if (hit && hit.length === 1) return `s:${hit[0]}`;
    }
    return `x:${venue}|${name}|${date}`;
  };

  // ---- group both sides ----
  // person -> event -> amounts
  type Cell = { system: CompareAmounts | null; upload: CompareAmounts | null; uploadLines: number };
  const grid = new Map<string, Map<string, Cell>>();
  const cell = (person: string, ev: string): Cell => {
    let row = grid.get(person);
    if (!row) {
      row = new Map();
      grid.set(person, row);
    }
    let c = row.get(ev);
    if (!c) {
      c = { system: null, upload: null, uploadLines: 0 };
      row.set(ev, c);
    }
    return c;
  };

  const eventInfo = new Map<string, { eventName: string; venue: string; city: string; state: string; eventDate: string; inSystem: boolean }>();
  sysEvents.forEach((e) =>
    eventInfo.set(`s:${e.eventId}`, { eventName: e.eventName, venue: e.venue, city: e.city, state: e.state, eventDate: e.eventDate, inSystem: true })
  );

  systemLines.forEach((l) => {
    const c = cell(personKeyOfSystem(l), `s:${l.eventId}`);
    c.system = c.system || emptyAmounts();
    addAmounts(c.system, l.amounts);
  });
  uploadRows.forEach((row) => {
    const evKey = eventKeyOfUpload(row);
    if (!eventInfo.has(evKey)) {
      eventInfo.set(evKey, {
        eventName: String(row.event_name || "(no event)").replace(/\s+-\s+\d{4}-\d{2}-\d{2}\s*$/, ""),
        venue: row.venue || "",
        city: row.city || "",
        state: row.state || "",
        eventDate: row.event_date || "",
        inSystem: false,
      });
    }
    const c = cell(personKeyOfUpload(row), evKey);
    c.upload = c.upload || emptyAmounts();
    addAmounts(c.upload, uploadRowAmounts(row));
    c.uploadLines += 1;
  });

  const eventLabel = (evKey: string) => {
    const info = eventInfo.get(evKey);
    if (!info) return evKey;
    return info.eventName || "(no event)";
  };

  // ---- by vendor ----
  const vendorTotals = new Map<string, CompareAmounts>();
  systemVendors.forEach((v) => {
    const key = personKeyOfSystem(v);
    const t = vendorTotals.get(key) || emptyAmounts();
    addAmounts(t, v.amounts);
    vendorTotals.set(key, t);
  });

  const vendors: VendorComparison[] = [];
  grid.forEach((eventsMap, personKey) => {
    const person = people.get(personKey) || { name: "(no name)", email: "", sortName: "" };
    let upload = null as CompareAmounts | null;
    let fromLines = null as CompareAmounts | null;
    let uploadLines = 0;
    const events: VendorComparison["events"] = [];
    eventsMap.forEach((c, evKey) => {
      if (c.upload) {
        upload = upload || emptyAmounts();
        addAmounts(upload, c.upload);
        uploadLines += c.uploadLines;
      }
      if (c.system) {
        fromLines = fromLines || emptyAmounts();
        addAmounts(fromLines, c.system);
      }
      if (c.system && !c.upload && isEmptySystem(c.system)) return;
      const info = eventInfo.get(evKey);
      events.push({
        key: evKey,
        name: person.name,
        email: person.email,
        system: c.system,
        upload: c.upload,
        uploadLines: c.uploadLines,
        eventLabel: eventLabel(evKey),
        venue: info?.venue || "",
        eventDate: info?.eventDate || "",
        ...statusFor(c.system, c.upload, c.uploadLines),
      });
    });
    // Vendor totals come from the Vendor view (includes pay-period incentive), falling back to summed lines.
    const system = vendorTotals.get(personKey) || fromLines;
    if (system && !upload && isEmptySystem(system)) return;
    events.sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.eventLabel.localeCompare(b.eventLabel));
    vendors.push({
      key: personKey,
      name: person.name,
      email: person.email,
      sortName: person.sortName,
      system,
      upload,
      uploadLines,
      events,
      ...statusFor(system, upload, Math.max(uploadLines, events.length)),
    });
  });
  vendors.sort((a, b) => a.sortName.localeCompare(b.sortName) || a.name.localeCompare(b.name));

  // ---- by event ----
  const eventsOut = new Map<string, EventComparison>();
  grid.forEach((eventsMap, personKey) => {
    const person = people.get(personKey) || { name: "(no name)", email: "", sortName: "" };
    eventsMap.forEach((c, evKey) => {
      if (c.system && !c.upload && isEmptySystem(c.system)) return;
      const info = eventInfo.get(evKey) || { eventName: evKey, venue: "", city: "", state: "", eventDate: "", inSystem: false };
      let ev = eventsOut.get(evKey);
      if (!ev) {
        ev = {
          key: evKey,
          ...info,
          system: null,
          upload: null,
          hoursDiff: 0,
          grossDiff: 0,
          status: "match",
          employees: [],
        };
        eventsOut.set(evKey, ev);
      }
      if (c.system) {
        ev.system = ev.system || emptyAmounts();
        addAmounts(ev.system, c.system);
      }
      if (c.upload) {
        ev.upload = ev.upload || emptyAmounts();
        addAmounts(ev.upload, c.upload);
      }
      ev.employees.push({
        key: personKey,
        name: person.name,
        email: person.email,
        system: c.system,
        upload: c.upload,
        uploadLines: c.uploadLines,
        ...statusFor(c.system, c.upload, c.uploadLines),
      });
    });
  });
  const events = Array.from(eventsOut.values()).map((ev) => {
    const lines = ev.employees.reduce((s, e) => s + Math.max(1, e.uploadLines), 0);
    const st = statusFor(ev.system, ev.upload, lines);
    // An event whose totals agree can still hide swapped amounts between people.
    const status: CompareStatus = st.status === "match" && ev.employees.some((e) => e.status !== "match") ? "different" : st.status;
    ev.employees.sort(
      (a, b) =>
        (people.get(a.key)?.sortName || a.name).localeCompare(people.get(b.key)?.sortName || b.name) || a.name.localeCompare(b.name)
    );
    return { ...ev, ...st, status };
  });
  events.sort((a, b) => a.venue.localeCompare(b.venue) || a.eventDate.localeCompare(b.eventDate) || a.eventName.localeCompare(b.eventName));

  // ---- grand totals ----
  const totalSystem = emptyAmounts();
  const totalUpload = emptyAmounts();
  vendors.forEach((v) => {
    if (v.system) addAmounts(totalSystem, v.system);
    if (v.upload) addAmounts(totalUpload, v.upload);
  });

  return {
    vendors,
    events,
    totals: {
      system: totalSystem,
      upload: totalUpload,
      grossDiff: roundMoney(amountOf(totalUpload, "total_gross_pay") - amountOf(totalSystem, "total_gross_pay")),
      hoursDiff: roundMoney(amountOf(totalUpload, "hours") - amountOf(totalSystem, "hours")),
    },
    vendorCounts: countStatuses(vendors),
    eventCounts: countStatuses(events),
  };
}

export const COMPARE_STATUS_ORDER = STATUS_ORDER;
