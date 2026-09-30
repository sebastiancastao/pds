"use client";

import { Fragment, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  COMPARE_AMOUNT_KEYS,
  COMPARE_AMOUNT_LABELS,
  COMPARE_STATUS_ORDER,
  amountOf,
  comparePayroll,
  type CompareAmountKey,
  type CompareAmounts,
  type ComparePair,
  type CompareStatus,
  type SystemCompareLine,
  type SystemCompareVendor,
} from "@/lib/payroll-compare";
import { roundMoney, type PayrollUploadRow } from "@/lib/payroll-upload";

// System payroll (calculated from events) next to the uploaded payroll for the
// same period, by vendor or by event, on the HR dashboard Payroll tab.

type Props = {
  systemLines: SystemCompareLine[];
  systemVendors: SystemCompareVendor[];
  uploadRows: PayrollUploadRow[];
  groupBy: "vendor" | "event";
  uploadLabel: string;
  periodStart: string;
  periodEnd: string;
};

const STATUS_LABEL: Record<CompareStatus, string> = {
  match: "Match",
  different: "Different",
  systemOnly: "Missing from upload",
  uploadOnly: "Only in upload",
};
const STATUS_STYLE: Record<CompareStatus, string> = {
  match: "border-green-200 bg-green-100 text-green-700",
  different: "border-red-200 bg-red-100 text-red-700",
  systemOnly: "border-gray-200 bg-gray-100 text-gray-700",
  uploadOnly: "border-amber-200 bg-amber-100 text-amber-800",
};
const BREAKDOWN_KEYS = COMPARE_AMOUNT_KEYS.filter((k) => k !== "hours" && k !== "total_gross_pay");

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hoursText = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const side = (a: CompareAmounts | null, key: CompareAmountKey, isMoney: boolean) => {
  if (!a || a[key] === null) return <span className="text-gray-300">—</span>;
  return isMoney ? money(roundMoney(Number(a[key]))) : hoursText(roundMoney(Number(a[key])));
};
const diffCell = (diff: number, isMoney: boolean, tolerance: number) => {
  if (Math.abs(diff) <= tolerance) return <span className="text-green-600">{isMoney ? money(0) : hoursText(0)}</span>;
  const text = isMoney ? money(Math.abs(diff)) : hoursText(Math.abs(diff));
  return (
    <span className="font-semibold text-red-600" title={diff > 0 ? "Upload is higher" : "Upload is lower"}>
      {diff > 0 ? "+" : "−"}
      {text}
    </span>
  );
};

function StatusBadge({ status }: { status: CompareStatus }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

// Component-by-component table: Regular Pay, Commission, Tips … system next to upload.
function Breakdown({ system, upload }: { system: CompareAmounts | null; upload: CompareAmounts | null }) {
  const keys = BREAKDOWN_KEYS.filter((k) => Math.abs(amountOf(system, k)) > 0.004 || Math.abs(amountOf(upload, k)) > 0.004);
  return (
    <table className="min-w-full text-xs">
      <thead>
        <tr className="text-gray-500">
          <th className="px-2 py-1 text-left font-medium uppercase">Pay breakdown</th>
          <th className="px-2 py-1 text-right font-medium uppercase">System</th>
          <th className="px-2 py-1 text-right font-medium uppercase">Upload</th>
          <th className="px-2 py-1 text-right font-medium uppercase">Difference</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {keys.length === 0 && (
          <tr>
            <td colSpan={4} className="px-2 py-2 text-gray-400">
              No pay amounts.
            </td>
          </tr>
        )}
        {keys.map((k) => (
          <tr key={k}>
            <td className="px-2 py-1 text-gray-700">{COMPARE_AMOUNT_LABELS[k]}</td>
            <td className="px-2 py-1 text-right tabular-nums">{side(system, k, true)}</td>
            <td className="px-2 py-1 text-right tabular-nums">{side(upload, k, true)}</td>
            <td className="px-2 py-1 text-right tabular-nums">{diffCell(roundMoney(amountOf(upload, k) - amountOf(system, k)), true, 0.05)}</td>
          </tr>
        ))}
        <tr className="font-semibold">
          <td className="px-2 py-1 text-gray-900">Total Gross Pay</td>
          <td className="px-2 py-1 text-right tabular-nums">{side(system, "total_gross_pay", true)}</td>
          <td className="px-2 py-1 text-right tabular-nums">{side(upload, "total_gross_pay", true)}</td>
          <td className="px-2 py-1 text-right tabular-nums">
            {diffCell(roundMoney(amountOf(upload, "total_gross_pay") - amountOf(system, "total_gross_pay")), true, 0.05)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// The shared "Hours: System | Upload | Diff  ·  Gross: System | Upload | Diff" header cells.
function PairHeader({ first }: { first: string }) {
  return (
    <>
      <tr>
        <th rowSpan={2} className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
          {first}
        </th>
        <th colSpan={3} className="border-l border-gray-200 px-3 pt-2 text-center text-xs font-medium uppercase text-gray-500">
          Hours
        </th>
        <th colSpan={3} className="border-l border-gray-200 px-3 pt-2 text-center text-xs font-medium uppercase text-gray-500">
          Total Gross Pay
        </th>
        <th rowSpan={2} className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
          Status
        </th>
      </tr>
      <tr>
        {["System", "Upload", "Diff", "System", "Upload", "Diff"].map((h, i) => (
          <th
            key={i}
            className={`px-3 pb-2 text-right text-[11px] font-medium uppercase ${h === "Upload" ? "text-blue-600" : "text-gray-500"} ${i % 3 === 0 ? "border-l border-gray-200" : ""}`}
          >
            {h}
          </th>
        ))}
      </tr>
    </>
  );
}

function PairCells({ pair }: { pair: ComparePair }) {
  const lines = Math.max(1, pair.uploadLines);
  return (
    <>
      <td className="border-l border-gray-100 px-3 py-2 text-right tabular-nums">{side(pair.system, "hours", false)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-blue-900">{side(pair.upload, "hours", false)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{pair.system && pair.upload ? diffCell(pair.hoursDiff, false, 0.05 * lines) : "—"}</td>
      <td className="border-l border-gray-100 px-3 py-2 text-right tabular-nums">{side(pair.system, "total_gross_pay", true)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-blue-900">{side(pair.upload, "total_gross_pay", true)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{pair.system && pair.upload ? diffCell(pair.grossDiff, true, 0.05 * lines) : "—"}</td>
      <td className="px-3 py-2">
        <StatusBadge status={pair.status} />
      </td>
    </>
  );
}

export default function PayrollCompareView({ systemLines, systemVendors, uploadRows, groupBy, uploadLabel, periodStart, periodEnd }: Props) {
  const [search, setSearch] = useState("");
  const [onlyDifferences, setOnlyDifferences] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const comparison = useMemo(() => comparePayroll(systemLines, systemVendors, uploadRows), [systemLines, systemVendors, uploadRows]);

  const q = search.trim().toLowerCase();
  const matchesSearch = (...values: Array<string | null | undefined>) => !q || values.some((v) => (v || "").toLowerCase().includes(q));

  const vendors = useMemo(
    () =>
      comparison.vendors
        .filter((v) => (!onlyDifferences || v.status !== "match") && matchesSearch(v.name, v.email, ...v.events.map((e) => e.eventLabel)))
        .sort((a, b) => (onlyDifferences ? COMPARE_STATUS_ORDER[a.status] - COMPARE_STATUS_ORDER[b.status] || Math.abs(b.grossDiff) - Math.abs(a.grossDiff) : 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comparison, onlyDifferences, q]
  );
  const events = useMemo(
    () =>
      comparison.events
        .filter(
          (e) =>
            (!onlyDifferences || e.status !== "match") &&
            matchesSearch(e.eventName, e.venue, e.eventDate, ...e.employees.map((x) => x.name), ...e.employees.map((x) => x.email))
        )
        .sort((a, b) => (onlyDifferences ? COMPARE_STATUS_ORDER[a.status] - COMPARE_STATUS_ORDER[b.status] || Math.abs(b.grossDiff) - Math.abs(a.grossDiff) : 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comparison, onlyDifferences, q]
  );

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const counts = groupBy === "vendor" ? comparison.vendorCounts : comparison.eventCounts;
  const systemGross = amountOf(comparison.totals.system, "total_gross_pay");
  const uploadGross = amountOf(comparison.totals.upload, "total_gross_pay");

  const downloadComparison = () => {
    const numbers = (system: CompareAmounts | null, upload: CompareAmounts | null) => {
      const out: Record<string, number | string> = {
        "System Hours": system ? roundMoney(amountOf(system, "hours")) : "",
        "Upload Hours": upload ? roundMoney(amountOf(upload, "hours")) : "",
        "Hours Difference": roundMoney(amountOf(upload, "hours") - amountOf(system, "hours")),
        "System Gross": system ? roundMoney(amountOf(system, "total_gross_pay")) : "",
        "Upload Gross": upload ? roundMoney(amountOf(upload, "total_gross_pay")) : "",
        "Gross Difference": roundMoney(amountOf(upload, "total_gross_pay") - amountOf(system, "total_gross_pay")),
      };
      BREAKDOWN_KEYS.forEach((k) => {
        out[`System ${COMPARE_AMOUNT_LABELS[k]}`] = system && system[k] !== null ? roundMoney(amountOf(system, k)) : "";
        out[`Upload ${COMPARE_AMOUNT_LABELS[k]}`] = upload && upload[k] !== null ? roundMoney(amountOf(upload, k)) : "";
      });
      return out;
    };
    const vendorSheet = comparison.vendors.map((v) => ({ Employee: v.name, Email: v.email, Status: STATUS_LABEL[v.status], ...numbers(v.system, v.upload) }));
    const eventTotalsSheet = comparison.events.map((e) => ({
      Venue: e.venue,
      City: e.city,
      State: e.state,
      Event: e.eventName,
      "Event Date": e.eventDate,
      "In System Payroll": e.inSystem ? "Yes" : "No",
      Status: STATUS_LABEL[e.status],
      ...numbers(e.system, e.upload),
    }));
    const eventLinesSheet = comparison.events.flatMap((e) =>
      e.employees.map((x) => ({
        Venue: e.venue,
        Event: e.eventName,
        "Event Date": e.eventDate,
        Employee: x.name,
        Email: x.email,
        Status: STATUS_LABEL[x.status],
        ...numbers(x.system, x.upload),
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vendorSheet), "By Vendor");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(eventTotalsSheet), "By Event");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(eventLinesSheet), "By Event - Employees");
    XLSX.writeFile(wb, `payroll_system_vs_upload_${periodStart || "start"}_to_${periodEnd || "end"}.xlsx`);
  };

  return (
    <div className="space-y-4">
      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="apple-card p-4">
          <div className="text-xs font-medium uppercase text-gray-500">System payroll</div>
          <div className="text-2xl font-bold tabular-nums text-gray-900">{money(roundMoney(systemGross))}</div>
          <div className="text-xs text-gray-500">{hoursText(roundMoney(amountOf(comparison.totals.system, "hours")))} hrs · calculated from events</div>
        </div>
        <div className="apple-card border-blue-200 p-4">
          <div className="text-xs font-medium uppercase text-blue-600">Uploaded payroll</div>
          <div className="text-2xl font-bold tabular-nums text-blue-900">{money(roundMoney(uploadGross))}</div>
          <div className="truncate text-xs text-gray-500" title={uploadLabel}>
            {hoursText(roundMoney(amountOf(comparison.totals.upload, "hours")))} hrs · {uploadLabel}
          </div>
        </div>
        <div className="apple-card p-4">
          <div className="text-xs font-medium uppercase text-gray-500">Difference (upload − system)</div>
          <div className={`text-2xl font-bold tabular-nums ${Math.abs(comparison.totals.grossDiff) > 0.05 ? "text-red-600" : "text-green-600"}`}>
            {comparison.totals.grossDiff > 0 ? "+" : comparison.totals.grossDiff < 0 ? "−" : ""}
            {money(Math.abs(comparison.totals.grossDiff))}
          </div>
          <div className="text-xs text-gray-500">
            {comparison.totals.hoursDiff > 0 ? "+" : comparison.totals.hoursDiff < 0 ? "−" : ""}
            {hoursText(Math.abs(comparison.totals.hoursDiff))} hrs
          </div>
        </div>
        <div className="apple-card p-4">
          <div className="text-xs font-medium uppercase text-gray-500">{groupBy === "vendor" ? "Employees" : "Events"}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {(["match", "different", "systemOnly", "uploadOnly"] as CompareStatus[]).map((s) => (
              <span key={s} className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[s]}`}>
                {counts[s]} {STATUS_LABEL[s].toLowerCase()}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={groupBy === "vendor" ? "Search employee, email or event" : "Search event, venue or employee"}
          className="apple-select w-72"
          aria-label="Search comparison"
        />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={onlyDifferences} onChange={(e) => setOnlyDifferences(e.target.checked)} />
          Only show differences
        </label>
        <span className="text-xs text-gray-500">Click a row to see the pay breakdown side by side.</span>
        <button type="button" onClick={downloadComparison} className="apple-button apple-button-secondary ml-auto">
          Download Comparison
        </button>
      </div>

      {groupBy === "vendor" ? (
        <div className="apple-card overflow-x-auto p-0">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <PairHeader first="Employee" />
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {vendors.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-green-700">
                    {onlyDifferences && !q ? "Every employee matches." : "No employees match your search."}
                  </td>
                </tr>
              )}
              {vendors.map((v) => {
                const open = expanded.has(`v:${v.key}`);
                return (
                  <Fragment key={v.key}>
                    <tr className="cursor-pointer hover:bg-gray-50" onClick={() => toggle(`v:${v.key}`)} aria-expanded={open}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="w-3 text-gray-400">{open ? "▾" : "▸"}</span>
                          <div>
                            <div className="font-medium text-gray-900">{v.name}</div>
                            {v.email && <div className="text-xs text-gray-500">{v.email}</div>}
                          </div>
                        </div>
                      </td>
                      <PairCells pair={v} />
                    </tr>
                    {open && (
                      <tr className="bg-gray-50/70">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div className="rounded-lg border border-gray-200 bg-white p-2">
                              <Breakdown system={v.system} upload={v.upload} />
                            </div>
                            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-2">
                              <table className="min-w-full text-xs">
                                <thead>
                                  <tr className="text-gray-500">
                                    <th className="px-2 py-1 text-left font-medium uppercase">Event</th>
                                    <th className="px-2 py-1 text-right font-medium uppercase">Sys hrs</th>
                                    <th className="px-2 py-1 text-right font-medium uppercase text-blue-600">Up hrs</th>
                                    <th className="px-2 py-1 text-right font-medium uppercase">Sys gross</th>
                                    <th className="px-2 py-1 text-right font-medium uppercase text-blue-600">Up gross</th>
                                    <th className="px-2 py-1 text-right font-medium uppercase">Diff</th>
                                    <th className="px-2 py-1" />
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {v.events.map((e) => (
                                    <tr key={e.key}>
                                      <td className="px-2 py-1">
                                        <div className="text-gray-900">{e.eventLabel}</div>
                                        <div className="text-gray-500">
                                          {[e.venue, e.eventDate].filter(Boolean).join(" · ")}
                                          {e.key.startsWith("x:") && " · not in system payroll"}
                                        </div>
                                      </td>
                                      <td className="px-2 py-1 text-right tabular-nums">{side(e.system, "hours", false)}</td>
                                      <td className="px-2 py-1 text-right tabular-nums text-blue-900">{side(e.upload, "hours", false)}</td>
                                      <td className="px-2 py-1 text-right tabular-nums">{side(e.system, "total_gross_pay", true)}</td>
                                      <td className="px-2 py-1 text-right tabular-nums text-blue-900">{side(e.upload, "total_gross_pay", true)}</td>
                                      <td className="px-2 py-1 text-right tabular-nums">
                                        {e.system && e.upload ? diffCell(e.grossDiff, true, 0.05 * Math.max(1, e.uploadLines)) : "—"}
                                      </td>
                                      <td className="px-2 py-1">
                                        <StatusBadge status={e.status} />
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : events.length === 0 ? (
        <div className="apple-empty-state">
          <p className="text-green-700">{onlyDifferences && !q ? "Every event matches." : "No events match your search."}</p>
        </div>
      ) : (
        events.map((ev) => {
          const employees = onlyDifferences && !q ? ev.employees.filter((x) => x.status !== "match") : ev.employees;
          return (
            <div key={ev.key} className="apple-card p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-gray-900">{ev.eventName || "(no event)"}</span>
                    <StatusBadge status={ev.status} />
                    {!ev.inSystem && (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">Not in system payroll</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500">
                    {[ev.venue, [ev.city, ev.state].filter(Boolean).join(", "), ev.eventDate].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="flex items-end gap-5 text-right">
                  <div>
                    <div className="text-[11px] font-medium uppercase text-gray-500">System</div>
                    <div className="font-semibold tabular-nums text-gray-900">{ev.system ? money(roundMoney(amountOf(ev.system, "total_gross_pay"))) : "—"}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-medium uppercase text-blue-600">Upload</div>
                    <div className="font-semibold tabular-nums text-blue-900">{ev.upload ? money(roundMoney(amountOf(ev.upload, "total_gross_pay"))) : "—"}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-medium uppercase text-gray-500">Diff</div>
                    <div className="tabular-nums">{ev.system && ev.upload ? diffCell(ev.grossDiff, true, 0.05 * Math.max(1, ev.employees.length)) : "—"}</div>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100 text-sm">
                  <thead className="bg-gray-50">
                    <PairHeader first="Employee" />
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {employees.map((x) => {
                      const open = expanded.has(`e:${ev.key}:${x.key}`);
                      return (
                        <Fragment key={x.key}>
                          <tr className="cursor-pointer hover:bg-gray-50" onClick={() => toggle(`e:${ev.key}:${x.key}`)} aria-expanded={open}>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="w-3 text-gray-400">{open ? "▾" : "▸"}</span>
                                <div>
                                  <div className="font-medium text-gray-900">{x.name}</div>
                                  {x.email && <div className="text-xs text-gray-500">{x.email}</div>}
                                </div>
                              </div>
                            </td>
                            <PairCells pair={x} />
                          </tr>
                          {open && (
                            <tr className="bg-gray-50/70">
                              <td colSpan={8} className="px-4 py-3">
                                <div className="max-w-xl rounded-lg border border-gray-200 bg-white p-2">
                                  <Breakdown system={x.system} upload={x.upload} />
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {employees.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-3 py-4 text-center text-sm text-gray-500">
                          Every employee at this event matches.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
