"use client";

import { createContext, Fragment, useContext, useMemo, useState, type ReactNode } from "react";
import {
  isPayrollFieldEdited,
  parsePayrollNumber,
  payrollRowName,
  payrollRowPersonKey,
  type PayrollRowIssue,
  type PayrollUploadFieldKey,
  type PayrollUploadRow,
} from "@/lib/payroll-upload";

// Uploaded payroll laid out exactly like the system payroll on the HR
// dashboard Payroll tab: View by Vendor (one card per employee, one row per
// event), View by Event (one card per venue, each event with its employees)
// and View by Venue (one card per venue, one row per employee). Only figures
// the uploaded files don't have (event sales) show a dash.
//
// Used read-only on the Payroll tab, and with `editing` in the Upload Payroll
// panel, where values are click-to-edit like the tab's Reimbursement and
// Other cells, lines that need a look carry a red badge, and edited values
// are highlighted.

type GroupBy = "venue" | "vendor" | "venueSummary";

export type PayrollViewEditing = {
  readOnly: boolean;
  onCommit: (rowIds: string[], changes: Partial<Record<PayrollUploadFieldKey, string | number | null>>) => void;
  onDelete: (rowId: string) => void;
  onUseSum: (rowId: string) => void;
  issuesFor: (row: PayrollUploadRow) => PayrollRowIssue[];
};

type Props = {
  rows: PayrollUploadRow[];
  groupBy: GroupBy;
  editing?: PayrollViewEditing;
};

const EditCtx = createContext<PayrollViewEditing | null>(null);

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
// Same formatting as the system views: two decimals, no thousands separator.
const moneyText = (v: number) => (Number.isFinite(v) ? v : 0).toFixed(2);
const hoursText = (v: number) => (Math.round((num(v) + 1e-9) * 100) / 100).toFixed(2);

const DAY_SUFFIX = /\s+-\s+(\d{4}-\d{2}-\d{2})\s*$/;
const PAY_KEYS = [
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
] as const;

const isHourlyLine = (r: PayrollUploadRow) =>
  /hourly/i.test(r.category || "") || num(r.regular_pay) + num(r.overtime_pay) + num(r.doubletime_pay) > 0 || num(r.regular_hours) > 0;
const isCommissionLine = (r: PayrollUploadRow) =>
  !isHourlyLine(r) &&
  (/commission/i.test(r.category || "") || num(r.commission_pay) !== 0 || num(r.variable_incentive) !== 0 || num(r.rest_break) !== 0 || num(r.tips) !== 0);
// A sick leave line carries sick hours in its Hours column and no other pay.
const isSickOnly = (r: PayrollUploadRow) => num(r.sick_pay) > 0 && PAY_KEYS.every((k) => num(r[k]) === 0);

type Totals = {
  hours: number;
  sickHours: number;
  regularHours: number;
  regularPay: number;
  overtimeHours: number;
  overtimePay: number;
  doubletimeHours: number;
  doubletimePay: number;
  commission: number;
  variableIncentive: number;
  tips: number;
  restBreak: number;
  mileage: number;
  travel: number;
  reimbursement: number;
  other: number;
  bonus: number;
  sickPay: number;
  gross: number;
};

const emptyTotals = (): Totals => ({
  hours: 0,
  sickHours: 0,
  regularHours: 0,
  regularPay: 0,
  overtimeHours: 0,
  overtimePay: 0,
  doubletimeHours: 0,
  doubletimePay: 0,
  commission: 0,
  variableIncentive: 0,
  tips: 0,
  restBreak: 0,
  mileage: 0,
  travel: 0,
  reimbursement: 0,
  other: 0,
  bonus: 0,
  sickPay: 0,
  gross: 0,
});

const addLine = (t: Totals, r: PayrollUploadRow) => {
  if (isSickOnly(r)) t.sickHours += num(r.hours);
  else t.hours += num(r.hours);
  t.regularHours += num(r.regular_hours);
  t.regularPay += num(r.regular_pay);
  t.overtimeHours += num(r.overtime_hours);
  t.overtimePay += num(r.overtime_pay);
  t.doubletimeHours += num(r.doubletime_hours);
  t.doubletimePay += num(r.doubletime_pay);
  t.commission += num(r.commission_pay);
  t.variableIncentive += num(r.variable_incentive);
  t.tips += num(r.tips);
  t.restBreak += num(r.rest_break);
  t.mileage += num(r.mileage_pay);
  t.travel += num(r.travel_pay);
  t.reimbursement += num(r.reimbursement);
  t.other += num(r.other);
  t.bonus += num(r.bonus);
  t.sickPay += num(r.sick_pay);
  t.gross += num(r.total_gross_pay);
};
const sumLines = (lines: PayrollUploadRow[]) => {
  const t = emptyTotals();
  lines.forEach((l) => addLine(t, l));
  return t;
};
const addTotals = (a: Totals, b: Totals) => {
  (Object.keys(a) as Array<keyof Totals>).forEach((k) => {
    a[k] += b[k];
  });
};

// One employee at one event. Multi-day timesheets ("Event - 2026-09-14" on
// each day) become one entry with a daily breakdown, like the system view.
type Entry = {
  key: string;
  personKey: string;
  firstName: string;
  lastName: string;
  email: string;
  eventName: string;
  multiDay: boolean;
  venue: string;
  city: string;
  state: string;
  date: string;
  hourly: boolean;
  commission: boolean;
  regRate: number | null;
  rateInEffect: number | null;
  lines: PayrollUploadRow[];
  totals: Totals;
};

const eventKeyOf = (r: PayrollUploadRow) => {
  const name = r.event_name || "";
  const multiDay = DAY_SUFFIX.test(name);
  const base = name.replace(DAY_SUFFIX, "").trim();
  const venue = (r.venue || "").trim().toLowerCase();
  return `${venue}|${base.toLowerCase()}|${multiDay ? "multi" : r.event_date || ""}`;
};

function buildEntries(rows: PayrollUploadRow[]): Entry[] {
  const map = new Map<string, Entry>();
  rows.forEach((r) => {
    const personKey = payrollRowPersonKey(r);
    const key = `${personKey}#${eventKeyOf(r)}`;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        key,
        personKey,
        firstName: r.first_name || "",
        lastName: r.last_name || "",
        email: r.email || "",
        eventName: (r.event_name || "").replace(DAY_SUFFIX, "").trim() || "(no event)",
        multiDay: DAY_SUFFIX.test(r.event_name || ""),
        venue: (r.venue || "").trim(),
        city: r.city || "",
        state: r.state || "",
        date: r.event_date || "",
        hourly: false,
        commission: false,
        regRate: null,
        rateInEffect: null,
        lines: [],
        totals: emptyTotals(),
      };
      map.set(key, entry);
    }
    entry.lines.push(r);
    addLine(entry.totals, r);
    if (isHourlyLine(r)) entry.hourly = true;
    if (isCommissionLine(r)) entry.commission = true;
    if (entry.regRate === null && typeof r.reg_rate === "number") entry.regRate = r.reg_rate;
    if (entry.rateInEffect === null && typeof r.rate_in_effect === "number") entry.rateInEffect = r.rate_in_effect;
    if (r.event_date && (!entry.date || r.event_date < entry.date)) entry.date = r.event_date;
    if (!entry.email && r.email) entry.email = r.email;
  });
  return Array.from(map.values());
}

const byLastName = (a: { firstName: string; lastName: string }, b: { firstName: string; lastName: string }) =>
  a.lastName.toLowerCase().localeCompare(b.lastName.toLowerCase()) || a.firstName.toLowerCase().localeCompare(b.firstName.toLowerCase());

// A row on screen: a whole entry, or (while editing) one day of a multi-day entry.
type RowModel = {
  key: string;
  entry: Entry;
  lines: PayrollUploadRow[];
  totals: Totals;
  hourly: boolean;
  commission: boolean;
  day: string | null; // set on the per-day rows of a multi-day entry
};

const entryRow = (e: Entry): RowModel => ({ key: e.key, entry: e, lines: e.lines, totals: e.totals, hourly: e.hourly, commission: e.commission, day: null });
const dayRows = (e: Entry): RowModel[] =>
  [...e.lines]
    .sort((a, b) => String(a.event_date || "").localeCompare(String(b.event_date || "")))
    .map((line) => ({
      key: line.id,
      entry: e,
      lines: [line],
      totals: sumLines([line]),
      hourly: isHourlyLine(line),
      commission: isCommissionLine(line),
      day: line.event_date || "—",
    }));

// ---------- editing helpers ----------

type FieldSpec = { key: PayrollUploadFieldKey; label: string };

const fieldValueText = (v: unknown) => (v === null || v === undefined ? "" : String(v));

// Shows the value like the system view; while editing, a click opens inputs
// with Save / Cancel (the same pattern as the tab's Reimbursement and Other cells).
function Editable({
  lines,
  fields,
  children,
  align = "right",
  applyToAll = false,
}: {
  lines: PayrollUploadRow[];
  fields: FieldSpec[];
  children: ReactNode;
  align?: "left" | "right";
  applyToAll?: boolean;
}) {
  const ctx = useContext(EditCtx);
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [bad, setBad] = useState<string | null>(null);
  if (!ctx) return <>{children}</>;

  const edited = lines.some((l) => fields.some((f) => isPayrollFieldEdited(l, f.key)));
  const canEdit = !ctx.readOnly && lines.length > 0 && (applyToAll || lines.length === 1);
  const uploadedText =
    edited && lines.length === 1 && lines[0].original
      ? `Uploaded: ${fields.map((f) => `${f.label} ${fieldValueText(lines[0].original?.[f.key]) || "(blank)"}`).join(", ")}`
      : undefined;
  const highlight = edited ? "rounded bg-amber-50 px-1 ring-1 ring-amber-200" : "";

  if (!canEdit) {
    return (
      <span className={highlight} title={uploadedText}>
        {children}
      </span>
    );
  }

  const start = () => {
    setDrafts(Object.fromEntries(fields.map((f) => [f.key, fieldValueText(lines[0][f.key])])));
    setBad(null);
    setOpen(true);
  };
  const save = () => {
    const changes: Partial<Record<PayrollUploadFieldKey, string | number | null>> = {};
    for (const f of fields) {
      const raw = drafts[f.key] ?? "";
      const numeric = f.key !== "first_name" && f.key !== "last_name" && f.key !== "email" && f.key !== "event_name" && f.key !== "event_date" && f.key !== "venue" && f.key !== "city" && f.key !== "state";
      if (numeric) {
        const parsed = parsePayrollNumber(raw, f.key.endsWith("hours"));
        if (parsed === undefined) {
          setBad(f.key);
          return;
        }
        changes[f.key] = parsed;
      } else {
        const text = raw.replace(/\s+/g, " ").trim();
        changes[f.key] = text === "" ? null : f.key === "email" ? text.toLowerCase() : text;
      }
    }
    ctx.onCommit(
      lines.map((l) => l.id),
      changes
    );
    setOpen(false);
  };

  if (open) {
    return (
      <div className={`flex flex-col gap-1 ${align === "right" ? "items-end" : "items-start"}`}>
        {fields.map((f, i) => (
          <input
            key={f.key}
            autoFocus={i === 0}
            value={drafts[f.key] ?? ""}
            placeholder={f.label}
            aria-label={f.label}
            title={f.label}
            onChange={(e) => setDrafts((d) => ({ ...d, [f.key]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setOpen(false);
            }}
            className={`w-28 rounded border px-2 py-1 text-sm ${align === "right" ? "text-right" : ""} ${bad === f.key ? "border-red-400 bg-red-50" : "border-gray-300"}`}
          />
        ))}
        <div className="flex items-center gap-2">
          <button type="button" onClick={save} className="text-xs font-medium text-green-600 hover:text-green-700">
            Save
          </button>
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-500 hover:text-gray-600">
            Cancel
          </button>
        </div>
        {bad && <span className="text-[10px] text-red-600">Not a number</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      className={`${align === "right" ? "text-right" : "text-left"} decoration-dotted hover:underline ${highlight}`}
      title={uploadedText ? `${uploadedText}. Click to edit.` : "Click to edit"}
    >
      {children}
    </button>
  );
}

// Red badge with the problems found on these lines (hover to read), and a
// "New" tag on lines typed in during review.
function LineFlags({ lines }: { lines: PayrollUploadRow[] }) {
  const ctx = useContext(EditCtx);
  if (!ctx) return null;
  const messages = Array.from(new Set(lines.flatMap((l) => ctx.issuesFor(l).map((i) => i.message))));
  const isNew = lines.length === 1 && lines[0].original === null;
  if (messages.length === 0 && !isNew) return null;
  return (
    <span className="ml-1 inline-flex items-center gap-1 align-middle">
      {messages.length > 0 && (
        <span
          className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
          title={messages.map((m) => `• ${m}`).join("\n")}
        >
          {messages.length}
        </span>
      )}
      {isNew && <span className="rounded bg-blue-100 px-1 text-[10px] font-semibold text-blue-700">New</span>}
    </span>
  );
}

// Remove / "Use sum" for one line while editing.
function LineActions({ row, cellClass }: { row: RowModel; cellClass: string }) {
  const ctx = useContext(EditCtx);
  if (!ctx || ctx.readOnly) return null;
  if (row.lines.length !== 1) return <td className={cellClass} />;
  const line = row.lines[0];
  const mismatch = ctx.issuesFor(line).some((i) => i.code === "total-mismatch");
  return (
    <td className={`${cellClass} whitespace-nowrap text-right`}>
      {mismatch && (
        <button
          type="button"
          onClick={() => ctx.onUseSum(line.id)}
          className="mr-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
          title="Set Total Gross Pay to the sum of the pay columns"
        >
          Use sum
        </button>
      )}
      <button
        type="button"
        onClick={() => ctx.onDelete(line.id)}
        className="rounded px-1.5 py-0.5 text-sm text-gray-400 hover:bg-red-50 hover:text-red-600"
        title="Remove this line"
        aria-label="Remove this line"
      >
        ×
      </button>
    </td>
  );
}

function CombinedHours({ worked, sick, align }: { worked: number; sick: number; align: "left" | "right" }) {
  if (!(sick > 0)) return <>{hoursText(worked)}</>;
  return (
    <div className={`flex flex-col ${align === "right" ? "items-end" : "items-start"}`}>
      <span>{hoursText(worked + sick)}</span>
      <span className="text-[10px] text-teal-600">
        {hoursText(worked)} worked + {hoursText(sick)} sick
      </span>
    </div>
  );
}

// "Other" includes bonuses, labelled underneath like the system's adjustment type.
function OtherValue({ t }: { t: Totals }) {
  const v = t.other + t.bonus;
  if (v === 0) return <span className="text-gray-400">—</span>;
  return (
    <div className="text-right">
      <div className={v >= 0 ? "text-green-600" : "text-red-600"}>${moneyText(v)}</div>
      {t.bonus !== 0 && <div className="text-[10px] text-gray-400">{t.other !== 0 ? "Includes bonus" : "Bonus"}</div>}
    </div>
  );
}

function DailyBreakdown({ entry, colSpan }: { entry: Entry; colSpan: number }) {
  if (entry.lines.length < 2) return null;
  const days = [...entry.lines].sort((a, b) => String(a.event_date || "").localeCompare(String(b.event_date || "")));
  return (
    <tr className="bg-gray-50/60">
      <td colSpan={colSpan} className="px-4 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="mr-1 font-medium text-gray-500">Daily breakdown:</span>
          {days.map((day) => (
            <span key={day.id} className="inline-flex items-center gap-1.5 rounded border border-gray-200 bg-white px-2 py-1">
              <span className="text-gray-500">{day.event_date || "—"}</span>
              <span className="font-medium text-gray-900">{hoursText(num(day.hours))}h</span>
              <span className="text-gray-400">/</span>
              <span className="text-gray-900">${moneyText(num(day.regular_pay) || num(day.total_gross_pay))}</span>
              {num(day.overtime_hours) > 0 && (
                <span className="text-orange-600">
                  +{hoursText(num(day.overtime_hours))}h OT (${moneyText(num(day.overtime_pay))})
                </span>
              )}
              {num(day.doubletime_hours) > 0 && (
                <span className="text-rose-600">
                  +{hoursText(num(day.doubletime_hours))}h DT (${moneyText(num(day.doubletime_pay))})
                </span>
              )}
            </span>
          ))}
        </div>
      </td>
    </tr>
  );
}

const dash = <span className="text-gray-400">—</span>;
const hourlyText = (h: number, pay: number) => `${hoursText(h)}h / $${moneyText(pay)}`;

const F = {
  name: [
    { key: "first_name", label: "First name" },
    { key: "last_name", label: "Last name" },
    { key: "email", label: "Email" },
  ] as FieldSpec[],
  event: [{ key: "event_name", label: "Event" }] as FieldSpec[],
  eventAndDate: [
    { key: "event_name", label: "Event" },
    { key: "event_date", label: "Date" },
  ] as FieldSpec[],
  venue: [
    { key: "venue", label: "Venue" },
    { key: "city", label: "City" },
    { key: "state", label: "State" },
  ] as FieldSpec[],
  date: [{ key: "event_date", label: "Date" }] as FieldSpec[],
  hours: [{ key: "hours", label: "Hours" }] as FieldSpec[],
  regular: [
    { key: "regular_hours", label: "Regular hours" },
    { key: "regular_pay", label: "Regular pay" },
  ] as FieldSpec[],
  overtime: [
    { key: "overtime_hours", label: "Overtime hours" },
    { key: "overtime_pay", label: "Overtime pay" },
  ] as FieldSpec[],
  doubletime: [
    { key: "doubletime_hours", label: "Double time hours" },
    { key: "doubletime_pay", label: "Double time pay" },
  ] as FieldSpec[],
  commission: [{ key: "commission_pay", label: "Commission pay" }] as FieldSpec[],
  incentive: [{ key: "variable_incentive", label: "Variable incentive" }] as FieldSpec[],
  commissionAndIncentive: [
    { key: "commission_pay", label: "Commission pay" },
    { key: "variable_incentive", label: "Variable incentive" },
  ] as FieldSpec[],
  tips: [{ key: "tips", label: "Tips" }] as FieldSpec[],
  rest: [{ key: "rest_break", label: "Rest break" }] as FieldSpec[],
  mileage: [
    { key: "mileage_pay", label: "Mileage pay" },
    { key: "mileage_miles", label: "Miles" },
  ] as FieldSpec[],
  travel: [{ key: "travel_pay", label: "Travel pay" }] as FieldSpec[],
  reimbursement: [{ key: "reimbursement", label: "Reimbursement" }] as FieldSpec[],
  other: [
    { key: "other", label: "Other" },
    { key: "bonus", label: "Bonus" },
  ] as FieldSpec[],
  sick: [{ key: "sick_pay", label: "Sick leave pay" }] as FieldSpec[],
  gross: [{ key: "total_gross_pay", label: "Total gross pay" }] as FieldSpec[],
  regRate: [{ key: "reg_rate", label: "Reg rate" }] as FieldSpec[],
  rateInEffect: [{ key: "rate_in_effect", label: "Rate in effect" }] as FieldSpec[],
};

export default function UploadedPayrollView({ rows, groupBy, editing }: Props) {
  return (
    <EditCtx.Provider value={editing ?? null}>
      <PayrollViews rows={rows} groupBy={groupBy} editingOn={Boolean(editing)} showActions={Boolean(editing && !editing.readOnly)} />
    </EditCtx.Provider>
  );
}

function PayrollViews({ rows, groupBy, editingOn, showActions }: { rows: PayrollUploadRow[]; groupBy: GroupBy; editingOn: boolean; showActions: boolean }) {
  const entries = useMemo(() => buildEntries(rows), [rows]);
  const showTravel = useMemo(() => rows.some((r) => num(r.travel_pay) !== 0), [rows]);
  // While editing, a multi-day entry also lists its days so each can be changed.
  const rowsFor = (e: Entry): RowModel[] => (editingOn && e.lines.length > 1 ? [entryRow(e), ...dayRows(e)] : [entryRow(e)]);

  // ---------- View by Vendor ----------
  const vendors = useMemo(() => {
    const map = new Map<string, { key: string; firstName: string; lastName: string; email: string; entries: Entry[]; totals: Totals }>();
    entries.forEach((e) => {
      const v = map.get(e.personKey) || { key: e.personKey, firstName: e.firstName, lastName: e.lastName, email: e.email, entries: [], totals: emptyTotals() };
      v.entries.push(e);
      addTotals(v.totals, e.totals);
      if (!v.email && e.email) v.email = e.email;
      map.set(e.personKey, v);
    });
    const list = Array.from(map.values());
    list.forEach((v) => v.entries.sort((a, b) => a.date.localeCompare(b.date) || a.eventName.localeCompare(b.eventName)));
    return list.sort(byLastName);
  }, [entries]);

  // ---------- View by Event: venue -> events -> employees ----------
  const venues = useMemo(() => {
    type EventGroup = { key: string; name: string; multiDay: boolean; date: string; state: string; entries: Entry[]; totals: Totals };
    const map = new Map<string, { venue: string; city: string; state: string; events: Map<string, EventGroup>; totals: Totals; lines: PayrollUploadRow[] }>();
    entries.forEach((e) => {
      const venueKey = e.venue.toLowerCase();
      const venue = map.get(venueKey) || { venue: e.venue || "(no venue)", city: e.city, state: e.state, events: new Map<string, EventGroup>(), totals: emptyTotals(), lines: [] as PayrollUploadRow[] };
      const eventKey = eventKeyOf(e.lines[0]);
      const ev = venue.events.get(eventKey) || { key: eventKey, name: e.eventName, multiDay: e.multiDay, date: e.date, state: e.state, entries: [] as Entry[], totals: emptyTotals() };
      ev.entries.push(e);
      addTotals(ev.totals, e.totals);
      if (e.date && (!ev.date || e.date < ev.date)) ev.date = e.date;
      venue.events.set(eventKey, ev);
      addTotals(venue.totals, e.totals);
      venue.lines.push(...e.lines);
      if (!venue.city && e.city) venue.city = e.city;
      if (!venue.state && e.state) venue.state = e.state;
      map.set(venueKey, venue);
    });
    return Array.from(map.values())
      .map((v) => ({
        ...v,
        eventList: Array.from(v.events.values())
          .map((ev) => ({ ...ev, entries: [...ev.entries].sort(byLastName), lines: ev.entries.flatMap((x) => x.lines) }))
          .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.venue.localeCompare(b.venue));
  }, [entries]);

  // ---------- View by Venue: venue -> employees ----------
  const venueSummaries = useMemo(
    () =>
      venues.map((v) => {
        const people = new Map<string, { key: string; firstName: string; lastName: string; email: string; events: number; totals: Totals; lines: PayrollUploadRow[] }>();
        v.eventList.forEach((ev) =>
          ev.entries.forEach((e) => {
            const p = people.get(e.personKey) || { key: e.personKey, firstName: e.firstName, lastName: e.lastName, email: e.email, events: 0, totals: emptyTotals(), lines: [] };
            p.events += 1;
            addTotals(p.totals, e.totals);
            p.lines.push(...e.lines);
            people.set(e.personKey, p);
          })
        );
        return { ...v, employees: Array.from(people.values()).sort(byLastName) };
      }),
    [venues]
  );

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <div className="apple-empty-state">
          <p className="text-gray-500">No lines to show.</p>
        </div>
      </div>
    );
  }

  if (groupBy === "vendor") {
    return (
      <div className="space-y-4">
        {vendors.map((vendor) => {
          const t = vendor.totals;
          const vendorLines = vendor.entries.flatMap((e) => e.lines);
          const showHourly = vendor.entries.some((e) => e.hourly);
          const showCommission = vendor.entries.some((e) => e.commission);
          const showRest = showCommission;
          const colSpan =
            4 + (showHourly ? 3 : 0) + (showCommission ? 2 : 0) + 1 + (showRest ? 1 : 0) + 1 + (showTravel ? 1 : 0) + 4 + (showActions ? 1 : 0);
          const cell = "px-4 py-2";
          return (
            <div key={vendor.key} className="apple-card">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    <Editable lines={vendorLines} fields={F.name} align="left" applyToAll>
                      {vendor.firstName || vendor.lastName ? `${vendor.firstName} ${vendor.lastName}` : "(no name)"}
                    </Editable>
                    <LineFlags lines={vendorLines} />
                  </h3>
                  <p className="text-sm text-gray-500">{vendor.email || (editingOn ? "No email" : "")}</p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-gray-900">${moneyText(t.gross)}</div>
                  <div className="text-sm text-gray-500">{hoursText(t.hours + t.sickHours)} hrs</div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Event</th>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Venue</th>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Date</th>
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Hours</th>
                      {showHourly && (
                        <>
                          <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Regular Time</th>
                          <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Overtime</th>
                          <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Double Time</th>
                        </>
                      )}
                      {showCommission && (
                        <>
                          <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Commission Pay</th>
                          <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Variable Incentive</th>
                        </>
                      )}
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Tips</th>
                      {showRest && <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Rest Break</th>}
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Mileage Pay</th>
                      {showTravel && <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Travel Pay</th>}
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Reimbursement</th>
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Other</th>
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Sick Leave</th>
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Total Gross Pay</th>
                      {showActions && <th className="px-2 py-2" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {vendor.entries.map((e) => (
                      <Fragment key={e.key}>
                        {rowsFor(e).map((row) => {
                          const rt = row.totals;
                          const isDay = row.day !== null;
                          const isAggregate = !isDay && e.lines.length > 1 && editingOn;
                          const L = isAggregate ? [] : row.lines;
                          return (
                            <tr key={row.key} className={isDay ? "bg-gray-50/60 text-xs" : "hover:bg-gray-50"}>
                              <td className={`${cell} text-sm text-gray-900`}>
                                {isDay ? (
                                  <span className="pl-3 text-gray-500">↳ {row.day}</span>
                                ) : (
                                  <Editable lines={e.multiDay ? [] : row.lines} fields={F.event} align="left" applyToAll>
                                    {e.eventName}
                                  </Editable>
                                )}
                                <LineFlags lines={isAggregate ? [] : row.lines} />
                              </td>
                              <td className={`${cell} text-sm text-gray-700`}>
                                {isDay ? null : (
                                  <Editable lines={row.lines} fields={F.venue} align="left" applyToAll>
                                    {e.venue || "—"}
                                    <span className="ml-1 text-gray-400">
                                      {e.city ? `· ${e.city}` : ""}
                                      {e.state ? `, ${e.state}` : ""}
                                    </span>
                                  </Editable>
                                )}
                              </td>
                              <td className={`${cell} text-sm text-gray-500`}>
                                {isDay ? null : (
                                  <Editable lines={row.lines.length === 1 ? row.lines : []} fields={F.date} align="left">
                                    {e.date || "—"}
                                  </Editable>
                                )}
                              </td>
                              <td className={`${cell} text-right text-sm`}>
                                <Editable lines={L} fields={F.hours}>
                                  <CombinedHours worked={rt.hours} sick={rt.sickHours} align="right" />
                                </Editable>
                              </td>
                              {showHourly && (
                                <>
                                  <td className={`${cell} text-right text-sm text-gray-900`}>
                                    {row.hourly ? (
                                      <Editable lines={L} fields={F.regular}>
                                        {hourlyText(rt.regularHours, rt.regularPay)}
                                      </Editable>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                  <td className={`${cell} text-right text-sm text-orange-600`}>
                                    {row.hourly ? (
                                      <Editable lines={L} fields={F.overtime}>
                                        {hourlyText(rt.overtimeHours, rt.overtimePay)}
                                      </Editable>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                  <td className={`${cell} text-right text-sm text-rose-600`}>
                                    {row.hourly ? (
                                      <Editable lines={L} fields={F.doubletime}>
                                        {hourlyText(rt.doubletimeHours, rt.doubletimePay)}
                                      </Editable>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                </>
                              )}
                              {showCommission && (
                                <>
                                  <td className={`${cell} text-right text-sm text-blue-600`}>
                                    {row.hourly ? (
                                      "—"
                                    ) : (
                                      <Editable lines={L} fields={F.commission}>
                                        ${moneyText(rt.commission)}
                                      </Editable>
                                    )}
                                  </td>
                                  <td className={`${cell} text-right text-sm`}>
                                    <Editable lines={L} fields={F.incentive}>
                                      {rt.variableIncentive !== 0 ? <span className="text-purple-700">${moneyText(rt.variableIncentive)}</span> : dash}
                                    </Editable>
                                  </td>
                                </>
                              )}
                              <td className={`${cell} text-right text-sm text-orange-600`}>
                                <Editable lines={L} fields={F.tips}>
                                  ${moneyText(rt.tips)}
                                </Editable>
                              </td>
                              {showRest && (
                                <td className={`${cell} text-right text-sm text-green-600`}>
                                  {row.hourly ? (
                                    "—"
                                  ) : (
                                    <Editable lines={L} fields={F.rest}>
                                      ${moneyText(rt.restBreak)}
                                    </Editable>
                                  )}
                                </td>
                              )}
                              <td className={`${cell} text-right text-sm text-blue-600`}>
                                <Editable lines={L} fields={F.mileage}>
                                  {rt.mileage !== 0 ? `$${moneyText(rt.mileage)}` : "—"}
                                </Editable>
                              </td>
                              {showTravel && (
                                <td className={`${cell} text-right text-sm text-blue-600`}>
                                  <Editable lines={L} fields={F.travel}>
                                    {rt.travel !== 0 ? `$${moneyText(rt.travel)}` : "—"}
                                  </Editable>
                                </td>
                              )}
                              <td className={`${cell} text-right text-sm`}>
                                <Editable lines={L} fields={F.reimbursement}>
                                  {rt.reimbursement !== 0 ? (
                                    <span className={rt.reimbursement >= 0 ? "text-green-600" : "text-red-600"}>${moneyText(rt.reimbursement)}</span>
                                  ) : (
                                    dash
                                  )}
                                </Editable>
                              </td>
                              <td className={`${cell} text-right text-sm`}>
                                <Editable lines={L} fields={F.other}>
                                  <OtherValue t={rt} />
                                </Editable>
                              </td>
                              <td className={`${cell} text-right text-sm text-teal-600`}>
                                <Editable lines={L} fields={F.sick}>
                                  {rt.sickPay > 0 ? (
                                    <div className="flex flex-col items-end">
                                      <span>${moneyText(rt.sickPay)}</span>
                                      {rt.sickHours > 0 && <span className="text-[10px] text-gray-400">{hoursText(rt.sickHours)}h</span>}
                                    </div>
                                  ) : (
                                    "—"
                                  )}
                                </Editable>
                              </td>
                              <td className={`${cell} text-right text-sm font-semibold`}>
                                <Editable lines={L} fields={F.gross}>
                                  ${moneyText(rt.gross)}
                                </Editable>
                              </td>
                              {showActions && <LineActions row={isAggregate ? { ...row, lines: [] } : row} cellClass="px-2 py-2" />}
                            </tr>
                          );
                        })}
                        {!editingOn && <DailyBreakdown entry={e} colSpan={colSpan} />}
                      </Fragment>
                    ))}
                    {showCommission && (
                      <tr style={{ backgroundColor: "#f3e8ff" }} className="border-t border-purple-200 text-sm font-medium">
                        <td className="px-4 py-2 uppercase tracking-wide text-purple-700" colSpan={3}>
                          Variable Incentive
                        </td>
                        <td className="px-4 py-2" />
                        {showHourly && (
                          <>
                            <td className="px-4 py-2" />
                            <td className="px-4 py-2" />
                            <td className="px-4 py-2" />
                          </>
                        )}
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2 text-right text-purple-700">${moneyText(t.variableIncentive)}</td>
                        <td className="px-4 py-2" />
                        {showRest && <td className="px-4 py-2" />}
                        <td className="px-4 py-2" />
                        {showTravel && <td className="px-4 py-2" />}
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2" />
                        {showActions && <td className="px-2 py-2" />}
                      </tr>
                    )}
                    <tr style={{ backgroundColor: "#e5e7eb" }} className="border-t-2 border-gray-400 text-sm font-semibold">
                      <td className="px-4 py-2 uppercase tracking-wide" colSpan={3}>
                        Total
                      </td>
                      <td className="px-4 py-2 text-right">
                        <CombinedHours worked={t.hours} sick={t.sickHours} align="right" />
                      </td>
                      {showHourly && (
                        <>
                          <td className="px-4 py-2 text-right text-gray-900">
                            {t.regularHours > 0 || t.regularPay > 0 ? hourlyText(t.regularHours, t.regularPay) : "—"}
                          </td>
                          <td className="px-4 py-2 text-right text-orange-600">
                            {t.overtimeHours > 0 || t.overtimePay > 0 ? hourlyText(t.overtimeHours, t.overtimePay) : "—"}
                          </td>
                          <td className="px-4 py-2 text-right text-rose-600">
                            {t.doubletimeHours > 0 || t.doubletimePay > 0 ? hourlyText(t.doubletimeHours, t.doubletimePay) : "—"}
                          </td>
                        </>
                      )}
                      {showCommission && (
                        <>
                          <td className="px-4 py-2 text-right text-blue-600">${moneyText(t.commission)}</td>
                          <td className="px-4 py-2 text-right text-gray-400">—</td>
                        </>
                      )}
                      <td className="px-4 py-2 text-right text-orange-600">${moneyText(t.tips)}</td>
                      {showRest && <td className="px-4 py-2 text-right text-green-600">${moneyText(t.restBreak)}</td>}
                      <td className="px-4 py-2 text-right text-blue-600">${moneyText(t.mileage)}</td>
                      {showTravel && <td className="px-4 py-2 text-right text-blue-600">${moneyText(t.travel)}</td>}
                      <td className="px-4 py-2 text-right">${moneyText(t.reimbursement)}</td>
                      <td className="px-4 py-2 text-right">${moneyText(t.other + t.bonus)}</td>
                      <td className="px-4 py-2 text-right text-teal-600">${moneyText(t.sickPay)}</td>
                      <td className="px-4 py-2 text-right">${moneyText(t.gross)}</td>
                      {showActions && <td className="px-2 py-2" />}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (groupBy === "venueSummary") {
    return (
      <div className="space-y-4">
        {venueSummaries.map((vs) => {
          const t = vs.totals;
          return (
            <div key={vs.venue} className="apple-card">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    <Editable lines={vs.lines} fields={F.venue} align="left" applyToAll>
                      {vs.venue}
                    </Editable>
                  </h3>
                  <p className="text-sm text-gray-500">
                    {vs.city || "—"}
                    {vs.state ? `, ${vs.state}` : ""}
                    <span className="text-gray-400">
                      {" "}
                      · {vs.eventList.length} {vs.eventList.length === 1 ? "event" : "events"} · {vs.employees.length}{" "}
                      {vs.employees.length === 1 ? "employee" : "employees"}
                    </span>
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-gray-900">${moneyText(t.gross)}</div>
                  <div className="text-sm text-gray-500">{hoursText(t.hours + t.sickHours)} hrs</div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Employee</th>
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Events</th>
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Hours</th>
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Wages / Commission</th>
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Tips</th>
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Rest Break</th>
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Mileage Pay</th>
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Reimbursement</th>
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Other</th>
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Sick Leave</th>
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Total Gross Pay</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {vs.employees.map((emp) => {
                      const et = emp.totals;
                      const wages = et.regularPay + et.overtimePay + et.doubletimePay + et.commission + et.variableIncentive;
                      return (
                        <tr key={emp.key} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-sm">
                            <div className="font-medium text-gray-900">
                              <Editable lines={emp.lines} fields={F.name} align="left" applyToAll>
                                {emp.firstName || emp.lastName ? `${emp.firstName} ${emp.lastName}` : "(no name)"}
                              </Editable>
                              <LineFlags lines={emp.lines} />
                            </div>
                            <div className="text-xs text-gray-500">{emp.email}</div>
                          </td>
                          <td className="px-4 py-2 text-right text-sm text-gray-700">{emp.events}</td>
                          <td className="px-4 py-2 text-right text-sm">
                            <CombinedHours worked={et.hours} sick={et.sickHours} align="right" />
                          </td>
                          <td className="px-4 py-2 text-right text-sm text-gray-900">${moneyText(wages)}</td>
                          <td className="px-4 py-2 text-right text-sm text-orange-600">${moneyText(et.tips)}</td>
                          <td className="px-4 py-2 text-right text-sm text-green-600">${moneyText(et.restBreak)}</td>
                          <td className="px-4 py-2 text-right text-sm text-blue-600">${moneyText(et.mileage + et.travel)}</td>
                          <td className="px-4 py-2 text-right text-sm">${moneyText(et.reimbursement)}</td>
                          <td className="px-4 py-2 text-right text-sm">${moneyText(et.other + et.bonus)}</td>
                          <td className="px-4 py-2 text-right text-sm text-teal-600">${moneyText(et.sickPay)}</td>
                          <td className="px-4 py-2 text-right text-sm font-medium text-gray-900">${moneyText(et.gross)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 text-sm font-semibold">
                      <td className="px-4 py-2 text-gray-900">Venue Total</td>
                      <td className="px-4 py-2 text-right text-gray-700">{vs.eventList.length}</td>
                      <td className="px-4 py-2 text-right">
                        <CombinedHours worked={t.hours} sick={t.sickHours} align="right" />
                      </td>
                      <td className="px-4 py-2 text-right text-gray-900">
                        ${moneyText(t.regularPay + t.overtimePay + t.doubletimePay + t.commission + t.variableIncentive)}
                      </td>
                      <td className="px-4 py-2 text-right text-orange-600">${moneyText(t.tips)}</td>
                      <td className="px-4 py-2 text-right text-green-600">${moneyText(t.restBreak)}</td>
                      <td className="px-4 py-2 text-right text-blue-600">${moneyText(t.mileage + t.travel)}</td>
                      <td className="px-4 py-2 text-right">${moneyText(t.reimbursement)}</td>
                      <td className="px-4 py-2 text-right">${moneyText(t.other + t.bonus)}</td>
                      <td className="px-4 py-2 text-right text-teal-600">${moneyText(t.sickPay)}</td>
                      <td className="px-4 py-2 text-right text-gray-900">${moneyText(t.gross)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ---------- View by Event ----------
  const notInFile = "Not in the uploaded files";
  return (
    <div className="space-y-4">
      {venues.map((v) => (
        <div key={v.venue} className="apple-card">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                <Editable lines={v.lines} fields={F.venue} align="left" applyToAll>
                  {v.venue}
                </Editable>
              </h3>
              <p className="text-sm text-gray-500">
                {v.city || "—"}, {v.state || ""}
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-gray-900">${moneyText(v.totals.gross)}</div>
              <div className="text-sm text-gray-500">{hoursText(v.totals.hours + v.totals.sickHours)} hrs</div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Event</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Date</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Hours</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Adjusted Gross Amount</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Total Commission</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Commission per Vendor</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Total Tips</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Total Rest Break</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Total Other</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {v.eventList.map((ev) => {
                  const et = ev.totals;
                  const withCommission = ev.entries.filter((e) => e.totals.commission > 0);
                  const showHourly = ev.entries.some((e) => e.hourly);
                  const showCommission = ev.entries.some((e) => e.commission);
                  const hideRest = !showCommission;
                  const subColSpan =
                    3 +
                    (showCommission ? 1 : 0) +
                    (showHourly ? 3 : 0) +
                    (showCommission ? 1 : 0) +
                    1 +
                    (hideRest ? 0 : 1) +
                    1 +
                    (showTravel ? 1 : 0) +
                    4 +
                    (showActions ? 1 : 0);
                  return (
                    <Fragment key={ev.key}>
                      <tr className="bg-white">
                        <td className="px-4 py-2 text-sm text-gray-900">
                          <div className="text-[10px] uppercase tracking-wider text-gray-400">Event</div>
                          <div>
                            <Editable lines={ev.multiDay ? [] : ev.lines} fields={F.eventAndDate} align="left" applyToAll>
                              {ev.name}
                            </Editable>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500">
                          <div className="text-[10px] uppercase tracking-wider text-gray-400">Date</div>
                          <div>{ev.date || "—"}</div>
                        </td>
                        <td className="px-4 py-2 text-right text-sm text-gray-900">
                          <div className="text-[10px] uppercase tracking-wider text-gray-400">Hours</div>
                          <div>{hoursText(et.hours + et.sickHours)}</div>
                          {et.sickHours > 0 && (
                            <div className="text-[10px] text-teal-600">
                              {hoursText(et.hours)} worked + {hoursText(et.sickHours)} sick
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right text-sm text-gray-900" title={notInFile}>
                          <div className="text-[10px] uppercase tracking-wider text-gray-400">Adjusted Gross Amount</div>
                          <div className="text-gray-400">—</div>
                        </td>
                        <td className="px-4 py-2 text-right text-sm text-gray-900" title="Sum of the commission pay in the uploaded files">
                          <div className="text-[10px] uppercase tracking-wider text-gray-400">Total Commission</div>
                          <div>${moneyText(et.commission)}</div>
                        </td>
                        <td className="px-4 py-2 text-right text-sm text-gray-900" title="Average commission pay of the vendors paid commission">
                          <div className="text-[10px] uppercase tracking-wider text-gray-400">Commission per Vendor</div>
                          <div>${moneyText(withCommission.length > 0 ? et.commission / withCommission.length : 0)}</div>
                          <div className="text-[10px] text-gray-400">{withCommission.length} vendors w/ hours</div>
                        </td>
                        <td className="px-4 py-2 text-right text-sm text-gray-900">
                          <div className="text-[10px] uppercase tracking-wider text-gray-400">Total Tips</div>
                          <div>${moneyText(et.tips)}</div>
                        </td>
                        <td className="px-4 py-2 text-right text-sm text-gray-900">
                          <div className="text-[10px] uppercase tracking-wider text-gray-400">Total Rest Break</div>
                          <div>${moneyText(et.restBreak)}</div>
                        </td>
                        <td className="px-4 py-2 text-right text-sm text-gray-900">
                          <div className="text-[10px] uppercase tracking-wider text-gray-400">Total Other</div>
                          <div>${moneyText(et.other + et.bonus)}</div>
                        </td>
                        <td className="px-4 py-2 text-right text-sm text-gray-900">
                          <div className="text-[10px] uppercase tracking-wider text-gray-400">Total</div>
                          <div>${moneyText(et.gross)}</div>
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={10} className="px-4 py-2">
                          <div className="overflow-x-auto rounded border">
                            <table className="min-w-full">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="p-2 text-left text-xs font-medium uppercase text-gray-500">Employee</th>
                                  <th className="p-2 text-left text-xs font-medium uppercase text-gray-500">Reg Rate</th>
                                  {showCommission && <th className="p-2 text-left text-xs font-medium uppercase text-gray-500">Rate in Effect</th>}
                                  <th className="p-2 text-left text-xs font-medium uppercase text-gray-500">Hours</th>
                                  {showHourly && (
                                    <>
                                      <th className="p-2 text-left text-xs font-medium uppercase text-gray-500">Regular Time</th>
                                      <th className="p-2 text-left text-xs font-medium uppercase text-gray-500">Overtime</th>
                                      <th className="p-2 text-left text-xs font-medium uppercase text-gray-500">Double Time</th>
                                    </>
                                  )}
                                  {showCommission && <th className="p-2 text-left text-xs font-medium uppercase text-gray-500">Commission Pay</th>}
                                  <th className="p-2 text-left text-xs font-medium uppercase text-gray-500">Tips</th>
                                  {!hideRest && <th className="p-2 text-left text-xs font-medium uppercase text-gray-500">Rest Break</th>}
                                  <th className="p-2 text-left text-xs font-medium uppercase text-gray-500">Mileage Pay</th>
                                  {showTravel && <th className="p-2 text-left text-xs font-medium uppercase text-gray-500">Travel Pay</th>}
                                  <th className="p-2 text-right text-xs font-medium uppercase text-gray-500">Reimbursement</th>
                                  <th className="p-2 text-right text-xs font-medium uppercase text-gray-500">Other</th>
                                  <th className="p-2 text-right text-xs font-medium uppercase text-gray-500">Sick Leave</th>
                                  <th className="p-2 text-right text-xs font-medium uppercase text-gray-500">Total Gross Pay</th>
                                  {showActions && <th className="p-2" />}
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {ev.entries.map((e) => (
                                  <Fragment key={e.key}>
                                    {rowsFor(e).map((row) => {
                                      const pt = row.totals;
                                      const isDay = row.day !== null;
                                      const isAggregate = !isDay && e.lines.length > 1 && editingOn;
                                      const L = isAggregate ? [] : row.lines;
                                      return (
                                        <tr key={row.key} className={isDay ? "bg-gray-50/60 text-xs" : "hover:bg-gray-50"}>
                                          <td className="p-2">
                                            {isDay ? (
                                              <span className="pl-3 text-xs text-gray-500">↳ {row.day}</span>
                                            ) : (
                                              <>
                                                <div className="text-sm font-medium text-gray-900">
                                                  <Editable lines={row.lines} fields={F.name} align="left" applyToAll>
                                                    {e.firstName || e.lastName ? `${e.firstName} ${e.lastName}` : payrollRowName(e.lines[0]) || "(no name)"}
                                                  </Editable>
                                                  <LineFlags lines={L} />
                                                </div>
                                                <div className="text-xs text-gray-500">{e.email}</div>
                                              </>
                                            )}
                                            {isDay && <LineFlags lines={row.lines} />}
                                          </td>
                                          <td className="p-2 text-sm">
                                            <Editable lines={L} fields={F.regRate} align="left">
                                              {(isDay ? row.lines[0].reg_rate : e.regRate) !== null && (isDay ? row.lines[0].reg_rate : e.regRate) !== undefined
                                                ? `$${moneyText(num(isDay ? row.lines[0].reg_rate : e.regRate))}/hr`
                                                : "—"}
                                            </Editable>
                                          </td>
                                          {showCommission && (
                                            <td className="p-2 text-sm">
                                              {row.hourly ? (
                                                "—"
                                              ) : (
                                                <Editable lines={L} fields={F.rateInEffect} align="left">
                                                  {(isDay ? row.lines[0].rate_in_effect : e.rateInEffect) !== null &&
                                                  (isDay ? row.lines[0].rate_in_effect : e.rateInEffect) !== undefined
                                                    ? `$${moneyText(num(isDay ? row.lines[0].rate_in_effect : e.rateInEffect))}/hr`
                                                    : "—"}
                                                </Editable>
                                              )}
                                            </td>
                                          )}
                                          <td className="p-2 text-sm">
                                            <Editable lines={L} fields={F.hours} align="left">
                                              <CombinedHours worked={pt.hours} sick={pt.sickHours} align="left" />
                                            </Editable>
                                          </td>
                                          {showHourly &&
                                            (row.hourly ? (
                                              <>
                                                <td className="p-2 text-sm text-gray-900">
                                                  <Editable lines={L} fields={F.regular} align="left">
                                                    {hourlyText(pt.regularHours, pt.regularPay)}
                                                  </Editable>
                                                </td>
                                                <td className="p-2 text-sm text-orange-600">
                                                  <Editable lines={L} fields={F.overtime} align="left">
                                                    {hourlyText(pt.overtimeHours, pt.overtimePay)}
                                                  </Editable>
                                                </td>
                                                <td className="p-2 text-sm text-rose-600">
                                                  <Editable lines={L} fields={F.doubletime} align="left">
                                                    {hourlyText(pt.doubletimeHours, pt.doubletimePay)}
                                                  </Editable>
                                                </td>
                                              </>
                                            ) : (
                                              <>
                                                <td className="p-2 text-sm text-gray-400">{"—"}</td>
                                                <td className="p-2 text-sm text-gray-400">{"—"}</td>
                                                <td className="p-2 text-sm text-gray-400">{"—"}</td>
                                              </>
                                            ))}
                                          {showCommission &&
                                            (row.hourly ? (
                                              <td className="p-2 text-sm text-gray-400">{"—"}</td>
                                            ) : (
                                              <td className="p-2 text-sm text-blue-600">
                                                <Editable lines={L} fields={F.commissionAndIncentive} align="left">
                                                  <div>${moneyText(pt.commission + pt.variableIncentive)}</div>
                                                  {pt.variableIncentive !== 0 && (
                                                    <div className="text-[10px] font-normal normal-case text-gray-400">
                                                      Commission ${moneyText(pt.commission)} + incentive ${moneyText(pt.variableIncentive)}
                                                    </div>
                                                  )}
                                                </Editable>
                                              </td>
                                            ))}
                                          <td className="p-2 text-sm text-orange-600">
                                            <Editable lines={L} fields={F.tips} align="left">
                                              ${moneyText(pt.tips)}
                                            </Editable>
                                          </td>
                                          {!hideRest &&
                                            (row.hourly ? (
                                              <td className="p-2 text-sm text-gray-400">{"—"}</td>
                                            ) : (
                                              <td className="p-2 text-sm text-green-600">
                                                <Editable lines={L} fields={F.rest} align="left">
                                                  ${moneyText(pt.restBreak)}
                                                </Editable>
                                              </td>
                                            ))}
                                          <td className="p-2 text-sm text-blue-600">
                                            <Editable lines={L} fields={F.mileage} align="left">
                                              {pt.mileage !== 0 ? `$${moneyText(pt.mileage)}` : "—"}
                                            </Editable>
                                          </td>
                                          {showTravel && (
                                            <td className="p-2 text-sm text-blue-600">
                                              <Editable lines={L} fields={F.travel} align="left">
                                                {pt.travel !== 0 ? `$${moneyText(pt.travel)}` : "—"}
                                              </Editable>
                                            </td>
                                          )}
                                          <td className="p-2 text-right text-sm">
                                            <Editable lines={L} fields={F.reimbursement}>
                                              {pt.reimbursement !== 0 ? (
                                                <span className={pt.reimbursement >= 0 ? "text-green-600" : "text-red-600"}>${moneyText(pt.reimbursement)}</span>
                                              ) : (
                                                dash
                                              )}
                                            </Editable>
                                          </td>
                                          <td className="p-2 text-right text-sm">
                                            <Editable lines={L} fields={F.other}>
                                              <OtherValue t={pt} />
                                            </Editable>
                                          </td>
                                          <td className="p-2 text-right text-sm text-teal-600">
                                            <Editable lines={L} fields={F.sick}>
                                              {pt.sickPay > 0 ? (
                                                <div className="flex flex-col items-end">
                                                  <span>${moneyText(pt.sickPay)}</span>
                                                  {pt.sickHours > 0 && <span className="text-[10px] text-gray-400">{hoursText(pt.sickHours)}h</span>}
                                                </div>
                                              ) : (
                                                "—"
                                              )}
                                            </Editable>
                                          </td>
                                          <td className="p-2 text-right text-sm font-semibold">
                                            <Editable lines={L} fields={F.gross}>
                                              ${moneyText(pt.gross)}
                                            </Editable>
                                          </td>
                                          {showActions && <LineActions row={isAggregate ? { ...row, lines: [] } : row} cellClass="p-2" />}
                                        </tr>
                                      );
                                    })}
                                    {!editingOn && <DailyBreakdown entry={e} colSpan={subColSpan} />}
                                  </Fragment>
                                ))}
                                <tr style={{ backgroundColor: "#e5e7eb" }} className="border-t-2 border-gray-400 text-sm font-semibold">
                                  <td className="p-2 uppercase tracking-wide">Total</td>
                                  <td className="p-2" />
                                  {showCommission && <td className="p-2" />}
                                  <td className="p-2">
                                    <CombinedHours worked={et.hours} sick={et.sickHours} align="left" />
                                  </td>
                                  {showHourly && (
                                    <>
                                      <td className="p-2 text-gray-900">{hourlyText(et.regularHours, et.regularPay)}</td>
                                      <td className="p-2 text-orange-600">{hourlyText(et.overtimeHours, et.overtimePay)}</td>
                                      <td className="p-2 text-rose-600">{hourlyText(et.doubletimeHours, et.doubletimePay)}</td>
                                    </>
                                  )}
                                  {showCommission && <td className="p-2 text-green-600">${moneyText(et.commission + et.variableIncentive)}</td>}
                                  <td className="p-2 text-orange-600">${moneyText(et.tips)}</td>
                                  {!hideRest && <td className="p-2 text-green-600">${moneyText(et.restBreak)}</td>}
                                  <td className="p-2 text-blue-600">${moneyText(et.mileage)}</td>
                                  {showTravel && <td className="p-2 text-blue-600">${moneyText(et.travel)}</td>}
                                  <td className="p-2 text-right">${moneyText(et.reimbursement)}</td>
                                  <td className="p-2 text-right">${moneyText(et.other + et.bonus)}</td>
                                  <td className="p-2 text-right text-teal-600">${moneyText(et.sickPay)}</td>
                                  <td className="p-2 text-right">${moneyText(et.gross)}</td>
                                  {showActions && <td className="p-2" />}
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
                <tr style={{ backgroundColor: "#e5e7eb" }} className="border-t-2 border-gray-400 text-sm font-semibold">
                  <td className="px-4 py-2 uppercase tracking-wide text-gray-900">Total</td>
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2 text-right text-gray-900">{hoursText(v.totals.hours + v.totals.sickHours)}</td>
                  <td className="px-4 py-2 text-right text-gray-400" title={notInFile}>
                    —
                  </td>
                  <td className="px-4 py-2 text-right text-gray-900">${moneyText(v.totals.commission)}</td>
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2 text-right text-gray-900">${moneyText(v.totals.tips)}</td>
                  <td className="px-4 py-2 text-right text-gray-900">${moneyText(v.totals.restBreak)}</td>
                  <td className="px-4 py-2 text-right text-gray-900">${moneyText(v.totals.other + v.totals.bonus)}</td>
                  <td className="px-4 py-2 text-right text-gray-900">${moneyText(v.totals.gross)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
