"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { money } from "./reimbursements-export";

// Equipment reimbursement queue for the HR dashboard Payroll tab.
// Equipment reimbursement is paid once a month as an off-cycle payment to
// active vendors and employees. HR adds people to a month's queue one at a
// time, adjusts amounts, exports the list for the off-cycle run, and marks rows
// paid. Data lives in
// equipment_reimbursement_queue via /api/hr/equipment-reimbursements.

type PersonType = "vendor" | "employee" | "exec" | "other";

type Person = {
  user_id: string;
  name: string;
  email: string;
  role: string;
  type: PersonType;
  state: string;
  is_active: boolean;
};

type QueueRow = Person & {
  id: string;
  pay_month: string;
  amount: number;
  description: string | null;
  notes: string | null;
  status: "queued" | "paid";
  paid_date: string | null;
  paid_by_name: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

const API = "/api/hr/equipment-reimbursements";

const TYPE_LABELS: Record<PersonType, string> = {
  vendor: "Vendor",
  employee: "Employee",
  exec: "Exec",
  other: "Other",
};

const TYPE_STYLES: Record<PersonType, string> = {
  vendor: "bg-blue-50 text-blue-700 border-blue-200",
  employee: "bg-purple-50 text-purple-700 border-purple-200",
  exec: "bg-gray-100 text-gray-700 border-gray-200",
  other: "bg-gray-50 text-gray-500 border-gray-200",
};

const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const currentMonth = () => todayIso().slice(0, 7);

const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

const monthLabel = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const parseMoney = (value: string): number | null => {
  const n = Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
};

async function callApi(method: string, body?: unknown, query = ""): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${API}${query}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

export default function EquipmentReimbursementsPanel() {
  const [month, setMonth] = useState(currentMonth);
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Add one person
  const [personSearch, setPersonSearch] = useState("");
  const [pickedPerson, setPickedPerson] = useState<Person | null>(null);
  const [singleAmount, setSingleAmount] = useState("");
  const [singleDescription, setSingleDescription] = useState("Equipment reimbursement");

  // Table
  const [statusFilter, setStatusFilter] = useState<"all" | "queued" | "paid">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | PersonType>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paidDate, setPaidDate] = useState(todayIso);
  const [selectedAmount, setSelectedAmount] = useState("");
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async (targetMonth: string) => {
    setLoading(true);
    setError("");
    try {
      const json = await callApi("GET", undefined, `?month=${encodeURIComponent(targetMonth)}`);
      setRows(Array.isArray(json.rows) ? json.rows : []);
      setPeople(Array.isArray(json.people) ? json.people : []);
      setSelected(new Set());
      setAmountDrafts({});
    } catch (err: any) {
      setError(err?.message || "Failed to load the equipment reimbursement queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (/^\d{4}-\d{2}$/.test(month)) void load(month);
  }, [month, load]);

  const run = async (action: () => Promise<string | void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const message = await action();
      if (message) setNotice(message);
      await load(month);
    } catch (err: any) {
      setError(err?.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const queuedUserIds = useMemo(() => new Set(rows.map((r) => r.user_id)), [rows]);

  const notQueuedByType = useMemo(() => {
    const out: Record<PersonType, Person[]> = { vendor: [], employee: [], exec: [], other: [] };
    for (const p of people) if (!queuedUserIds.has(p.user_id)) out[p.type].push(p);
    return out;
  }, [people, queuedUserIds]);

  const activeCountByType = useMemo(() => {
    const out: Record<PersonType, number> = { vendor: 0, employee: 0, exec: 0, other: 0 };
    for (const p of people) out[p.type] += 1;
    return out;
  }, [people]);

  const summary = useMemo(() => {
    const out = { queued: { count: 0, amount: 0 }, paid: { count: 0, amount: 0 }, inactive: 0 };
    for (const r of rows) {
      out[r.status].count += 1;
      out[r.status].amount += r.amount;
      if (!r.is_active && r.status === "queued") out.inactive += 1;
    }
    return out;
  }, [rows]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (q && !`${r.name} ${r.email} ${r.state} ${r.description || ""} ${r.notes || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, statusFilter, typeFilter, search]);

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const selectedQueued = selectedRows.filter((r) => r.status === "queued");
  const selectedPaid = selectedRows.filter((r) => r.status === "paid");
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.id));

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleRows.forEach((r) => next.delete(r.id));
      else visibleRows.forEach((r) => next.add(r.id));
      return next;
    });

  const personMatches = useMemo(() => {
    const q = personSearch.trim().toLowerCase();
    if (!q || pickedPerson) return [];
    return people.filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(q)).slice(0, 8);
  }, [people, personSearch, pickedPerson]);

  const addOne = () => {
    if (!pickedPerson) {
      setError("Pick a person to add.");
      return;
    }
    const amount = parseMoney(singleAmount);
    if (amount == null) {
      setError("Enter an amount for this person.");
      return;
    }
    if (queuedUserIds.has(pickedPerson.user_id)) {
      const ok = window.confirm(`${pickedPerson.name} is already in the ${monthLabel(month)} queue. Add another line for them?`);
      if (!ok) return;
    }
    const person = pickedPerson;
    void run(async () => {
      await callApi("POST", {
        month,
        skip_existing: false,
        entries: [{ user_id: person.user_id, amount, description: singleDescription }],
      });
      setPickedPerson(null);
      setPersonSearch("");
      setSingleAmount("");
      return `Added ${person.name} for ${money(amount)}.`;
    });
  };

  const markPaid = (ids: string[]) => {
    if (ids.length === 0) return;
    void run(async () => {
      const json = await callApi("PATCH", { ids, status: "paid", paid_date: paidDate });
      return `Marked ${json.updated} paid on ${formatDate(paidDate)}.`;
    });
  };

  const moveBackToQueue = (ids: string[]) => {
    if (ids.length === 0) return;
    void run(async () => {
      const json = await callApi("PATCH", { ids, status: "queued" });
      return `Moved ${json.updated} back to the queue.`;
    });
  };

  const removeRows = (ids: string[], label: string) => {
    if (ids.length === 0) return;
    if (!window.confirm(`Remove ${label} from the ${monthLabel(month)} queue?`)) return;
    void run(async () => {
      const json = await callApi("DELETE", { ids });
      return `Removed ${json.removed} from the queue.`;
    });
  };

  const setAmountForSelected = () => {
    const amount = parseMoney(selectedAmount);
    if (amount == null) {
      setError("Enter a valid amount for the selected rows.");
      return;
    }
    const ids = selectedQueued.map((r) => r.id);
    if (ids.length === 0) return;
    void run(async () => {
      const json = await callApi("PATCH", { ids, amount });
      setSelectedAmount("");
      return `Set ${json.updated} amounts to ${money(amount)}.`;
    });
  };

  const saveAmount = (row: QueueRow) => {
    const draft = amountDrafts[row.id];
    if (draft === undefined) return;
    const amount = parseMoney(draft);
    if (amount == null) {
      setError(`Enter a valid amount for ${row.name}.`);
      return;
    }
    if (Math.abs(amount - row.amount) < 0.005) {
      setAmountDrafts((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      return;
    }
    void run(async () => {
      await callApi("PATCH", { ids: [row.id], amount });
    });
  };

  const exportToExcel = () => {
    const exportRows = visibleRows;
    if (exportRows.length === 0) return;
    const headers = ["Name", "Email", "Type", "Role", "State", "Pay Month", "Description", "Amount", "Status", "Paid Date", "Notes"];
    const data = exportRows.map((r) => ({
      Name: r.name,
      Email: r.email,
      Type: TYPE_LABELS[r.type],
      Role: r.role,
      State: r.state,
      "Pay Month": monthLabel(month),
      Description: r.description || "",
      Amount: r.amount,
      Status: r.status === "paid" ? "Paid" : "Queued",
      "Paid Date": r.paid_date || "",
      Notes: [r.notes || "", r.is_active ? "" : "No longer active"].filter(Boolean).join(" · "),
    }));
    const total = exportRows.reduce((sum, r) => sum + r.amount, 0);
    data.push({
      Name: "Total",
      Email: "",
      Type: "",
      Role: "",
      State: "",
      "Pay Month": "",
      Description: `${exportRows.length} people`,
      Amount: Math.round(total * 100) / 100,
      Status: "",
      "Paid Date": "",
      Notes: "",
    });
    const ws = XLSX.utils.json_to_sheet(data, { header: headers });
    const amountCol = headers.indexOf("Amount");
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    for (let r = 1; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: amountCol })];
      if (cell && typeof cell.v === "number") cell.z = '"$"#,##0.00';
    }
    ws["!cols"] = headers.map((h) => ({ wch: h === "Email" || h === "Description" || h === "Notes" ? 30 : h === "Name" ? 26 : 12 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Equipment Reimbursement");
    XLSX.writeFile(wb, `equipment_reimbursement_${month}.xlsx`);
  };

  const disabled = loading || busy;

  return (
    <div className="apple-card mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-semibold">Equipment Reimbursement</h2>
          <p className="text-sm text-gray-500">
            Monthly off-cycle payment for active vendors and employees. Queue people for the month, export the list for the off-cycle run, then mark them paid.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={exportToExcel}
            disabled={disabled || visibleRows.length === 0}
            className={`apple-button ${disabled || visibleRows.length === 0 ? "apple-button-disabled" : "apple-button-primary"}`}
            title="Download the rows shown below as an Excel file."
          >
            Export to Excel ({visibleRows.length})
          </button>
          <button onClick={() => void load(month)} disabled={disabled} className="apple-button apple-button-secondary">
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Month */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="apple-label" htmlFor="equip-month">Pay month</label>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} disabled={disabled} className="apple-button apple-button-secondary" aria-label="Previous month">
              ‹
            </button>
            <input
              id="equip-month"
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="apple-select"
            />
            <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} disabled={disabled} className="apple-button apple-button-secondary" aria-label="Next month">
              ›
            </button>
          </div>
        </div>
        <div className="pb-2 text-sm text-gray-500">
          {people.length} active · {activeCountByType.vendor} vendors · {activeCountByType.employee} employees · {activeCountByType.exec} execs
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</div>}

      {/* Summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === "queued" ? "all" : "queued")}
          className={`text-left rounded-xl border border-gray-200 border-l-4 border-l-amber-400 px-4 py-3 transition ${statusFilter === "queued" ? "bg-gray-50 ring-2 ring-blue-200" : "bg-white hover:bg-gray-50"}`}
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Queued</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900 tabular-nums">{money(summary.queued.amount)}</div>
          <div className="text-xs text-gray-400">{summary.queued.count} {summary.queued.count === 1 ? "person" : "people"}</div>
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === "paid" ? "all" : "paid")}
          className={`text-left rounded-xl border border-gray-200 border-l-4 border-l-green-500 px-4 py-3 transition ${statusFilter === "paid" ? "bg-gray-50 ring-2 ring-blue-200" : "bg-white hover:bg-gray-50"}`}
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Paid</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900 tabular-nums">{money(summary.paid.amount)}</div>
          <div className="text-xs text-gray-400">{summary.paid.count} {summary.paid.count === 1 ? "person" : "people"}</div>
        </button>
        <div className="rounded-xl border border-gray-200 border-l-4 border-l-blue-400 px-4 py-3 bg-white">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{monthLabel(month)} total</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900 tabular-nums">{money(summary.queued.amount + summary.paid.amount)}</div>
          <div className="text-xs text-gray-400">{rows.length} lines</div>
        </div>
        <div className="rounded-xl border border-gray-200 border-l-4 border-l-gray-300 px-4 py-3 bg-white">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Active, not queued</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900 tabular-nums">
            {notQueuedByType.vendor.length + notQueuedByType.employee.length}
          </div>
          <div className="text-xs text-gray-400">
            {notQueuedByType.vendor.length} vendors · {notQueuedByType.employee.length} employees
          </div>
        </div>
      </div>

      {summary.inactive > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>
            {summary.inactive} queued {summary.inactive === 1 ? "person is" : "people are"} no longer active. Equipment reimbursement is only for active vendors and employees.
          </span>
          <button
            onClick={() => removeRows(rows.filter((r) => !r.is_active && r.status === "queued").map((r) => r.id), `${summary.inactive} inactive ${summary.inactive === 1 ? "person" : "people"}`)}
            disabled={disabled}
            className="apple-button apple-button-secondary"
          >
            Remove inactive from queue
          </button>
        </div>
      )}

      {/* Add to queue */}
      <div className="mb-6">
        <div className="rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 uppercase mb-3">Add one person</h3>
          <div className="relative mb-3">
            <label className="apple-label" htmlFor="equip-person">Active vendor or employee</label>
            {pickedPerson ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium text-gray-900">{pickedPerson.name}</span>
                  <span className="text-gray-400"> · {TYPE_LABELS[pickedPerson.type]}{pickedPerson.state ? ` · ${pickedPerson.state}` : ""}</span>
                  {queuedUserIds.has(pickedPerson.user_id) && <span className="ml-2 text-xs text-amber-700">already queued this month</span>}
                </span>
                <button type="button" onClick={() => { setPickedPerson(null); setPersonSearch(""); }} className="text-xs text-blue-600 hover:text-blue-800">
                  Change
                </button>
              </div>
            ) : (
              <input
                id="equip-person"
                type="search"
                value={personSearch}
                onChange={(e) => setPersonSearch(e.target.value)}
                placeholder="Search by name or email…"
                className="apple-select w-full"
                autoComplete="off"
              />
            )}
            {personMatches.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
                {personMatches.map((p) => (
                  <button
                    key={p.user_id}
                    type="button"
                    onClick={() => { setPickedPerson(p); setPersonSearch(""); }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    <span>
                      <span className="text-gray-900">{p.name}</span>
                      <span className="text-xs text-gray-400"> {p.email}</span>
                    </span>
                    <span className="text-xs text-gray-500">
                      {TYPE_LABELS[p.type]}{queuedUserIds.has(p.user_id) ? " · queued" : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="apple-label" htmlFor="equip-single-amount">Amount</label>
              <input
                id="equip-single-amount"
                inputMode="decimal"
                value={singleAmount}
                onChange={(e) => setSingleAmount(e.target.value)}
                placeholder="0.00"
                className="apple-select w-28"
              />
            </div>
            <div className="flex-1 min-w-[10rem]">
              <label className="apple-label" htmlFor="equip-single-desc">Description</label>
              <input
                id="equip-single-desc"
                value={singleDescription}
                onChange={(e) => setSingleDescription(e.target.value)}
                className="apple-select w-full"
              />
            </div>
            <button
              onClick={addOne}
              disabled={disabled || !pickedPerson}
              className={`apple-button ${disabled || !pickedPerson ? "apple-button-disabled" : "apple-button-primary"}`}
            >
              Add to queue
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div>
          <label className="apple-label" htmlFor="equip-status">Status</label>
          <select id="equip-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="apple-select">
            <option value="all">All</option>
            <option value="queued">Queued</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        <div>
          <label className="apple-label" htmlFor="equip-type">Type</label>
          <select id="equip-type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)} className="apple-select">
            <option value="all">All</option>
            <option value="vendor">Vendors</option>
            <option value="employee">Employees</option>
            <option value="exec">Execs</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="flex-1 min-w-[12rem]">
          <label className="apple-label" htmlFor="equip-search">Search</label>
          <input
            id="equip-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, email, state, description…"
            className="apple-select w-full"
          />
        </div>
      </div>

      {/* Bulk actions for selected rows */}
      <div className="flex flex-wrap items-end gap-3 mb-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
        <span className="pb-2 text-sm text-gray-600">{selected.size} selected</span>
        <div>
          <label className="apple-label" htmlFor="equip-paid-date">Paid date</label>
          <input id="equip-paid-date" type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className="apple-select" />
        </div>
        <button
          onClick={() => markPaid(selectedQueued.map((r) => r.id))}
          disabled={disabled || selectedQueued.length === 0 || !paidDate}
          className={`apple-button ${disabled || selectedQueued.length === 0 || !paidDate ? "apple-button-disabled" : "apple-button-primary"}`}
        >
          Mark {selectedQueued.length} paid
        </button>
        <button
          onClick={() => moveBackToQueue(selectedPaid.map((r) => r.id))}
          disabled={disabled || selectedPaid.length === 0}
          className={`apple-button ${disabled || selectedPaid.length === 0 ? "apple-button-disabled" : "apple-button-secondary"}`}
        >
          Back to queue ({selectedPaid.length})
        </button>
        <div className="flex items-end gap-2">
          <div>
            <label className="apple-label" htmlFor="equip-selected-amount">New amount</label>
            <input
              id="equip-selected-amount"
              inputMode="decimal"
              value={selectedAmount}
              onChange={(e) => setSelectedAmount(e.target.value)}
              placeholder="0.00"
              className="apple-select w-24"
            />
          </div>
          <button
            onClick={setAmountForSelected}
            disabled={disabled || selectedQueued.length === 0 || !selectedAmount}
            className={`apple-button ${disabled || selectedQueued.length === 0 || !selectedAmount ? "apple-button-disabled" : "apple-button-secondary"}`}
          >
            Set for {selectedQueued.length} queued
          </button>
        </div>
        <button
          onClick={() => removeRows(selectedQueued.map((r) => r.id), `${selectedQueued.length} ${selectedQueued.length === 1 ? "person" : "people"}`)}
          disabled={disabled || selectedQueued.length === 0}
          className={`apple-button ${disabled || selectedQueued.length === 0 ? "apple-button-disabled" : "apple-button-secondary"}`}
        >
          Remove {selectedQueued.length} queued
        </button>
      </div>

      {/* Queue table */}
      <div className="overflow-x-auto">
        {loading && rows.length === 0 ? (
          <div className="text-center py-6 text-sm text-gray-400">Loading the equipment reimbursement queue…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-6 text-sm text-gray-400">
            Nobody is queued for {monthLabel(month)} yet. Add people above.
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="text-center py-6 text-sm text-gray-400">No rows match these filters.</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Select all shown rows" />
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">State</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleRows.map((r) => (
                <tr key={r.id} className={`align-top ${selected.has(r.id) ? "bg-blue-50/40" : "hover:bg-gray-50"}`}>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleRow(r.id)} aria-label={`Select ${r.name}`} />
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-900">
                    <div className="font-medium">{r.name}</div>
                    {r.email && <div className="text-xs text-gray-400">{r.email}</div>}
                  </td>
                  <td className="px-3 py-2 text-sm whitespace-nowrap">
                    <span className={`px-2 py-0.5 text-xs font-semibold border rounded-full ${TYPE_STYLES[r.type]}`}>{TYPE_LABELS[r.type]}</span>
                    {!r.is_active && (
                      <div className="mt-1">
                        <span className="px-2 py-0.5 text-xs font-semibold border rounded-full bg-red-50 text-red-700 border-red-200">Inactive</span>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-700">{r.state || "—"}</td>
                  <td className="px-3 py-2 text-sm text-gray-700 max-w-xs">
                    <div className="line-clamp-2" title={r.description || ""}>{r.description || "—"}</div>
                    {r.notes && <div className="text-xs text-gray-400 line-clamp-1" title={r.notes}>Note: {r.notes}</div>}
                  </td>
                  <td className="px-3 py-2 text-sm text-right whitespace-nowrap">
                    {r.status === "queued" ? (
                      <input
                        inputMode="decimal"
                        value={amountDrafts[r.id] ?? r.amount.toFixed(2)}
                        onChange={(e) => setAmountDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                        onBlur={() => saveAmount(r)}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        disabled={disabled}
                        className="apple-select w-24 text-right tabular-nums"
                        aria-label={`Amount for ${r.name}`}
                      />
                    ) : (
                      <span className="font-semibold text-gray-900 tabular-nums">{money(r.amount)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm whitespace-nowrap">
                    {r.status === "paid" ? (
                      <>
                        <span className="px-2 py-0.5 text-xs font-semibold border rounded-full bg-green-100 text-green-700 border-green-200">Paid</span>
                        <div className="mt-1 text-xs text-gray-400">
                          {formatDate(r.paid_date)}{r.paid_by_name ? ` · ${r.paid_by_name}` : ""}
                        </div>
                      </>
                    ) : (
                      <span className="px-2 py-0.5 text-xs font-semibold border rounded-full bg-amber-100 text-amber-800 border-amber-200">Queued</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm text-right whitespace-nowrap">
                    {r.status === "queued" ? (
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => markPaid([r.id])}
                          disabled={disabled || !paidDate}
                          className="text-blue-600 hover:text-blue-800 font-medium"
                          title={paidDate ? `Uses the paid date above (${formatDate(paidDate)}).` : "Set a paid date above first."}
                        >
                          Mark paid
                        </button>
                        <button onClick={() => removeRows([r.id], r.name)} disabled={disabled} className="text-red-600 hover:text-red-800">
                          Remove
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => moveBackToQueue([r.id])} disabled={disabled} className="text-gray-600 hover:text-gray-800">
                        Back to queue
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
