"use client";

import { Fragment, useMemo, useState } from "react";
import {
  PAYROLL_UPLOAD_NUMERIC_FIELDS,
  payrollRowName,
  payrollRowPersonKey,
  roundMoney,
  type PayrollUploadNumericKey,
  type PayrollUploadRow,
} from "@/lib/payroll-upload";

// Read-only payroll view for the HR dashboard Payroll tab when an uploaded
// spreadsheet is the payroll for the loaded period. Mirrors the tab's three
// views (by vendor, by event, by venue). Edits happen in the Upload Payroll panel.

type GroupBy = "venue" | "vendor" | "venueSummary";

type Props = {
  rows: PayrollUploadRow[];
  groupBy: GroupBy;
};

// Pay columns shown when any line has a value, in the tab's usual order.
const PAY_KEYS: PayrollUploadNumericKey[] = [
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
];
const LABELS = Object.fromEntries(PAYROLL_UPLOAD_NUMERIC_FIELDS.map((f) => [f.key, f.label])) as Record<PayrollUploadNumericKey, string>;

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hoursText = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

type Totals = { hours: number; gross: number; lines: number } & Record<PayrollUploadNumericKey, number>;

const emptyTotals = (): Totals => {
  const t: Record<string, number> = { hours: 0, gross: 0, lines: 0 };
  PAYROLL_UPLOAD_NUMERIC_FIELDS.forEach((f) => {
    t[f.key] = 0;
  });
  return t as Totals;
};

const addRow = (t: Totals, row: PayrollUploadRow) => {
  t.lines += 1;
  t.hours += Number(row.hours || 0);
  t.gross += Number(row.total_gross_pay || 0);
  PAY_KEYS.forEach((k) => {
    t[k] += Number(row[k] || 0);
  });
};

const eventKey = (row: PayrollUploadRow) =>
  `${(row.venue || "").toLowerCase()}|${(row.event_name || "").toLowerCase()}|${row.event_date || ""}`;

export default function UploadedPayrollView({ rows, groupBy }: Props) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.first_name, row.last_name, row.email, row.event_name, row.venue, row.category].some((v) => (v || "").toLowerCase().includes(q))
    );
  }, [rows, search]);

  const payKeys = useMemo(
    () => PAY_KEYS.filter((k) => rows.some((r) => r[k] !== null && r[k] !== undefined && Number(r[k]) !== 0)),
    [rows]
  );

  const byVendor = useMemo(() => {
    const map = new Map<string, { key: string; name: string; email: string; totals: Totals; lines: PayrollUploadRow[] }>();
    filtered.forEach((row) => {
      const key = payrollRowPersonKey(row);
      const entry = map.get(key) || { key, name: payrollRowName(row) || "(no name)", email: row.email || "", totals: emptyTotals(), lines: [] };
      addRow(entry.totals, row);
      entry.lines.push(row);
      map.set(key, entry);
    });
    return Array.from(map.values()).sort((a, b) => {
      const al = (a.lines[0]?.last_name || a.name).toLowerCase();
      const bl = (b.lines[0]?.last_name || b.name).toLowerCase();
      return al.localeCompare(bl) || a.name.localeCompare(b.name);
    });
  }, [filtered]);

  const byEvent = useMemo(() => {
    const map = new Map<string, { key: string; venue: string; city: string; state: string; event: string; date: string; totals: Totals; lines: PayrollUploadRow[] }>();
    filtered.forEach((row) => {
      const key = eventKey(row);
      const entry = map.get(key) || {
        key,
        venue: row.venue || "(no venue)",
        city: row.city || "",
        state: row.state || "",
        event: row.event_name || "(no event)",
        date: row.event_date || "",
        totals: emptyTotals(),
        lines: [],
      };
      addRow(entry.totals, row);
      entry.lines.push(row);
      map.set(key, entry);
    });
    return Array.from(map.values()).sort((a, b) => a.venue.localeCompare(b.venue) || a.date.localeCompare(b.date) || a.event.localeCompare(b.event));
  }, [filtered]);

  const byVenue = useMemo(() => {
    const map = new Map<string, { venue: string; city: string; state: string; totals: Totals; events: typeof byEvent; people: Set<string> }>();
    byEvent.forEach((ev) => {
      const key = ev.venue.toLowerCase();
      const entry = map.get(key) || { venue: ev.venue, city: ev.city, state: ev.state, totals: emptyTotals(), events: [], people: new Set<string>() };
      ev.lines.forEach((row) => {
        addRow(entry.totals, row);
        entry.people.add(payrollRowPersonKey(row));
      });
      entry.events.push(ev);
      map.set(key, entry);
    });
    return Array.from(map.values()).sort((a, b) => a.venue.localeCompare(b.venue));
  }, [byEvent]);

  const grand = useMemo(() => {
    const t = emptyTotals();
    filtered.forEach((row) => addRow(t, row));
    return t;
  }, [filtered]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const payHeaders = payKeys.map((k) => (
    <th key={k} className="whitespace-nowrap px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">
      {LABELS[k]}
    </th>
  ));
  const payCells = (t: Totals | PayrollUploadRow, bold = false) =>
    payKeys.map((k) => (
      <td key={k} className={`whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900 ${bold ? "font-semibold" : ""}`}>
        {money(roundMoney(Number((t as Record<string, unknown>)[k] || 0)))}
      </td>
    ));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, event or venue"
          className="apple-select w-72"
          aria-label="Search uploaded payroll"
        />
        <span className="text-sm text-gray-600">
          {groupBy === "vendor" ? `${byVendor.length} employees` : groupBy === "venue" ? `${byEvent.length} events` : `${byVenue.length} venues`} ·{" "}
          {grand.lines} lines · {hoursText(roundMoney(grand.hours))} hrs · <span className="font-semibold">{money(roundMoney(grand.gross))}</span>
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="apple-empty-state">
          <p className="text-gray-500">{rows.length === 0 ? "This upload has no lines." : "No lines match your search."}</p>
        </div>
      ) : groupBy === "vendor" ? (
        <div className="apple-card overflow-x-auto p-0">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Employee</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">Lines</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">Hours</th>
                {payHeaders}
                <th className="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">Total Gross Pay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {byVendor.map((v) => {
                const open = expanded.has(v.key);
                return (
                  <Fragment key={v.key}>
                    <tr className="cursor-pointer hover:bg-gray-50" onClick={() => toggle(v.key)} aria-expanded={open}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="w-3 text-gray-400">{open ? "▾" : "▸"}</span>
                          <div>
                            <div className="font-medium text-gray-900">{v.name}</div>
                            {v.email && <div className="text-xs text-gray-500">{v.email}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{v.totals.lines}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{hoursText(roundMoney(v.totals.hours))}</td>
                      {payCells(v.totals)}
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">{money(roundMoney(v.totals.gross))}</td>
                    </tr>
                    {open &&
                      v.lines.map((row) => (
                        <tr key={row.id} className="bg-gray-50/70 text-xs">
                          <td className="py-1.5 pl-10 pr-3 text-gray-700">
                            {row.event_name || "(no event)"}
                            <span className="text-gray-500">
                              {row.venue ? ` · ${row.venue}` : ""}
                              {row.event_date ? ` · ${row.event_date}` : ""}
                              {row.category ? ` · ${row.category}` : ""}
                            </span>
                          </td>
                          <td className="px-3 py-1.5" />
                          <td className="px-3 py-1.5 text-right tabular-nums">{hoursText(Number(row.hours || 0))}</td>
                          {payCells(row)}
                          <td className="px-3 py-1.5 text-right tabular-nums">{money(Number(row.total_gross_pay || 0))}</td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
              <tr className="bg-gray-50 font-semibold">
                <td className="px-3 py-2 text-gray-900">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{grand.lines}</td>
                <td className="px-3 py-2 text-right tabular-nums">{hoursText(roundMoney(grand.hours))}</td>
                {payCells(grand, true)}
                <td className="px-3 py-2 text-right tabular-nums text-gray-900">{money(roundMoney(grand.gross))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : groupBy === "venue" ? (
        byEvent.map((ev) => (
          <div key={ev.key} className="apple-card p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
              <div>
                <div className="font-semibold text-gray-900">{ev.event}</div>
                <div className="text-sm text-gray-500">
                  {ev.venue}
                  {ev.city || ev.state ? ` · ${[ev.city, ev.state].filter(Boolean).join(", ")}` : ""}
                  {ev.date ? ` · ${ev.date}` : ""}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-gray-900">{money(roundMoney(ev.totals.gross))}</div>
                <div className="text-xs text-gray-500">
                  {ev.lines.length} line{ev.lines.length === 1 ? "" : "s"} · {hoursText(roundMoney(ev.totals.hours))} hrs
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Employee</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Category</th>
                    <th className="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">Hours</th>
                    {payHeaders}
                    <th className="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">Total Gross Pay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {ev.lines.map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">{payrollRowName(row) || "(no name)"}</div>
                        {row.email && <div className="text-xs text-gray-500">{row.email}</div>}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{row.category || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{hoursText(Number(row.hours || 0))}</td>
                      {payCells(row)}
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">{money(Number(row.total_gross_pay || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      ) : (
        byVenue.map((v) => (
          <div key={v.venue} className="apple-card p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
              <div>
                <div className="font-semibold text-gray-900">{v.venue}</div>
                <div className="text-sm text-gray-500">
                  {[v.city, v.state].filter(Boolean).join(", ") || "—"} · {v.events.length} event{v.events.length === 1 ? "" : "s"} · {v.people.size} employee
                  {v.people.size === 1 ? "" : "s"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-gray-900">{money(roundMoney(v.totals.gross))}</div>
                <div className="text-xs text-gray-500">{hoursText(roundMoney(v.totals.hours))} hrs</div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Event</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Date</th>
                    <th className="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">Employees</th>
                    <th className="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">Hours</th>
                    {payHeaders}
                    <th className="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">Total Gross Pay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {v.events.map((ev) => (
                    <tr key={ev.key}>
                      <td className="px-3 py-2 font-medium text-gray-900">{ev.event}</td>
                      <td className="px-3 py-2 text-gray-600">{ev.date || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{new Set(ev.lines.map(payrollRowPersonKey)).size}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{hoursText(roundMoney(ev.totals.hours))}</td>
                      {payCells(ev.totals)}
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">{money(roundMoney(ev.totals.gross))}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-semibold">
                    <td className="px-3 py-2 text-gray-900" colSpan={2}>
                      Venue total
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{v.people.size}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{hoursText(roundMoney(v.totals.hours))}</td>
                    {payCells(v.totals, true)}
                    <td className="px-3 py-2 text-right tabular-nums text-gray-900">{money(roundMoney(v.totals.gross))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
