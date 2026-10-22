"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { money } from "./reimbursements-export";
import {
  EQUIPMENT_REIMBURSEMENT_AMOUNT,
  formatPayMonth,
  formatPayPeriod,
  lastCompletedPayPeriod,
  listEquipmentPayPeriods,
  type EquipmentPayPeriod,
} from "@/lib/equipment-reimbursement";

// Equipment reimbursement for the HR dashboard Payroll tab: pick a bi-weekly pay
// period, then check the onboarded vendors who get the $20 monthly equipment
// reimbursement in it. Each person can be checked in only one pay period per
// month. Data: equipment_reimbursement_queue via /api/hr/equipment-reimbursements.

type Person = {
  user_id: string;
  name: string;
  email: string;
  role: string;
  state: string;
  eligible: boolean;
};

type MonthRow = {
  id: string;
  user_id: string;
  pay_period_start: string;
  pay_period_end: string;
  amount: number;
};

type ShowFilter = "all" | "checked" | "unchecked";

const API = "/api/hr/equipment-reimbursements";

const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const roleLabel = (role: string) => {
  const r = role.trim().toLowerCase();
  if (!r || r === "worker" || r === "vendor") return "Vendor";
  return r.charAt(0).toUpperCase() + r.slice(1);
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

// onSaved lets the Payroll tab refresh the equipment rows it shows for the loaded dates.
export default function EquipmentReimbursementsPanel({ onSaved }: { onSaved?: () => void } = {}) {
  const today = useMemo(todayIso, []);
  const periodOptions = useMemo(() => listEquipmentPayPeriods(today, 2), [today]);
  const [periodStart, setPeriodStart] = useState(() => lastCompletedPayPeriod(today).start);

  const [period, setPeriod] = useState<EquipmentPayPeriod | null>(null);
  const [monthPeriods, setMonthPeriods] = useState<EquipmentPayPeriod[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [monthRows, setMonthRows] = useState<MonthRow[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<ShowFilter>("all");

  const load = useCallback(async (start: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}?period_start=${encodeURIComponent(start)}`, { headers: await authHeaders(), cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to load equipment reimbursements");
      const rows: MonthRow[] = Array.isArray(json.month_rows) ? json.month_rows : [];
      setPeriod(json.period || null);
      setMonthPeriods(Array.isArray(json.month_periods) ? json.month_periods : []);
      setPeople(Array.isArray(json.people) ? json.people : []);
      setMonthRows(rows);
      setChecked(new Set(rows.filter((r) => r.pay_period_start === start).map((r) => r.user_id)));
    } catch (err: any) {
      setError(err?.message || "Failed to load equipment reimbursements");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(periodStart);
  }, [periodStart, load]);

  // Saved state for the selected pay period, and who is already checked in
  // another pay period of the same month.
  const saved = useMemo(
    () => new Set(monthRows.filter((r) => r.pay_period_start === periodStart).map((r) => r.user_id)),
    [monthRows, periodStart],
  );
  const otherPeriodByUser = useMemo(() => {
    const map = new Map<string, MonthRow>();
    for (const r of monthRows) if (r.pay_period_start !== periodStart) map.set(r.user_id, r);
    return map;
  }, [monthRows, periodStart]);

  const toAdd = useMemo(() => Array.from(checked).filter((id) => !saved.has(id)), [checked, saved]);
  const toRemove = useMemo(() => Array.from(saved).filter((id) => !checked.has(id)), [checked, saved]);
  const dirty = toAdd.length + toRemove.length > 0;

  const canCheck = (p: Person) => p.eligible && !otherPeriodByUser.has(p.user_id);

  const visiblePeople = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter((p) => {
      if (show === "checked" && !checked.has(p.user_id)) return false;
      if (show === "unchecked" && checked.has(p.user_id)) return false;
      if (q && !`${p.name} ${p.email} ${p.state} ${roleLabel(p.role)}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [people, search, show, checked]);

  const eligibleCount = useMemo(() => people.filter((p) => p.eligible).length, [people]);
  const shownSelectable = visiblePeople.filter((p) => canCheck(p) || checked.has(p.user_id));
  const allShownChecked = shownSelectable.length > 0 && shownSelectable.every((p) => checked.has(p.user_id));

  const changePeriod = (start: string) => {
    if (start === periodStart) return;
    if (dirty && !window.confirm("You have unsaved changes for this pay period. Discard them?")) return;
    setNotice("");
    setPeriodStart(start);
  };

  const toggle = (p: Person) => {
    setNotice("");
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(p.user_id)) next.delete(p.user_id);
      else if (canCheck(p)) next.add(p.user_id);
      return next;
    });
  };

  const setShown = (on: boolean) => {
    setNotice("");
    setChecked((prev) => {
      const next = new Set(prev);
      for (const p of visiblePeople) {
        if (on && canCheck(p)) next.add(p.user_id);
        if (!on) next.delete(p.user_id);
      }
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ period_start: periodStart, user_ids: Array.from(checked) }),
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to save");
      const parts = [`Saved. ${json.added} checked, ${json.removed} unchecked.`];
      const other: string[] = Array.isArray(json.skipped_other_period) ? json.skipped_other_period : [];
      const ineligible: string[] = Array.isArray(json.skipped_ineligible) ? json.skipped_ineligible : [];
      if (other.length) parts.push(`Skipped ${other.length} already checked in the other pay period this month: ${other.join(", ")}.`);
      if (ineligible.length) parts.push(`Skipped ${ineligible.length} no longer active or onboarded: ${ineligible.join(", ")}.`);
      setNotice(parts.join(" "));
      onSaved?.();
      await load(periodStart);
    } catch (err: any) {
      setError(err?.message || "Failed to save");
      await load(periodStart);
    } finally {
      setSaving(false);
    }
  };

  const exportToExcel = () => {
    if (!period) return;
    const byId = new Map(people.map((p) => [p.user_id, p] as const));
    const rows = monthRows
      .filter((r) => r.pay_period_start === periodStart)
      .map((r) => ({ row: r, person: byId.get(r.user_id) }))
      .sort((a, b) => (a.person?.name || "").localeCompare(b.person?.name || ""));
    if (rows.length === 0) return;
    const headers = ["Name", "Email", "State", "Role", "Pay Period", "Pay Date", "Amount"];
    const data: Record<string, string | number>[] = rows.map(({ row, person }) => ({
      Name: person?.name || "Unknown",
      Email: person?.email || "",
      State: person?.state || "",
      Role: roleLabel(person?.role || ""),
      "Pay Period": formatPayPeriod(period),
      "Pay Date": formatDate(period.payDate),
      Amount: row.amount,
    }));
    const total = rows.reduce((sum, { row }) => sum + row.amount, 0);
    data.push({ Name: "Total", Email: `${rows.length} people`, State: "", Role: "", "Pay Period": "", "Pay Date": "", Amount: Math.round(total * 100) / 100 });
    const ws = XLSX.utils.json_to_sheet(data, { header: headers });
    const amountCol = headers.indexOf("Amount");
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    for (let r = 1; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: amountCol })];
      if (cell && typeof cell.v === "number") cell.z = '"$"#,##0.00';
    }
    ws["!cols"] = headers.map((h) => ({ wch: h === "Email" ? 32 : h === "Name" ? 26 : h === "Pay Period" ? 24 : 12 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Equipment Reimbursement");
    XLSX.writeFile(wb, `equipment_reimbursement_${period.start}_to_${period.end}.xlsx`);
  };

  // Pay period dropdown grouped by month (the month each period ends in).
  const periodGroups = useMemo(() => {
    const groups: Array<{ month: string; periods: EquipmentPayPeriod[] }> = [];
    for (const p of periodOptions) {
      const last = groups[groups.length - 1];
      if (last && last.month === p.month) last.periods.push(p);
      else groups.push({ month: p.month, periods: [p] });
    }
    return groups;
  }, [periodOptions]);

  const busy = loading || saving;
  const savedCount = saved.size;

  return (
    <div className="apple-card mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-semibold">Equipment Reimbursement</h2>
          <p className="text-sm text-gray-500">
            {money(EQUIPMENT_REIMBURSEMENT_AMOUNT)} a month for each checked vendor, paid in one of the month&apos;s pay periods.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={exportToExcel}
            disabled={busy || dirty || savedCount === 0}
            className={`apple-button ${busy || dirty || savedCount === 0 ? "apple-button-disabled" : "apple-button-secondary"}`}
            title={dirty ? "Save your changes first." : "Download the saved list for this pay period as an Excel file."}
          >
            Export to Excel ({savedCount})
          </button>
          <button onClick={() => void load(periodStart)} disabled={busy} className="apple-button apple-button-secondary">
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Pay period */}
      <div className="flex flex-wrap items-end gap-4 mb-4">
        <div>
          <label className="apple-label" htmlFor="equip-period">Pay period</label>
          <select
            id="equip-period"
            value={periodStart}
            onChange={(e) => changePeriod(e.target.value)}
            disabled={saving}
            className="apple-select"
          >
            {periodGroups.map((g) => (
              <optgroup key={g.month} label={formatPayMonth(g.month)}>
                {g.periods.map((p) => (
                  <option key={p.start} value={p.start}>
                    {formatPayPeriod(p)} · paid {formatDate(p.payDate)}
                    {p.start <= today && today <= p.end ? " (current)" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {period && (
          <div className="pb-2 text-sm text-gray-600">
            <span className="font-medium text-gray-900">{formatPayMonth(period.month)}</span> pay periods:{" "}
            {monthPeriods.map((p, i) => {
              const count = monthRows.filter((r) => r.pay_period_start === p.start).length;
              const selected = p.start === periodStart;
              return (
                <span key={p.start}>
                  {i > 0 && " · "}
                  {selected ? (
                    <span className="font-medium text-gray-900">{formatPayPeriod(p, false)} (this one, {count} saved)</span>
                  ) : (
                    <button type="button" onClick={() => changePeriod(p.start)} className="text-blue-600 hover:text-blue-800">
                      {formatPayPeriod(p, false)} ({count} saved)
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</div>}

      {/* Totals + actions */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem]">
            <label className="apple-label" htmlFor="equip-search">Search</label>
            <input
              id="equip-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, email, state…"
              className="apple-select w-full"
            />
          </div>
          <div>
            <label className="apple-label" htmlFor="equip-show">Show</label>
            <select id="equip-show" value={show} onChange={(e) => setShow(e.target.value as ShowFilter)} className="apple-select">
              <option value="all">All</option>
              <option value="checked">Checked</option>
              <option value="unchecked">Not checked</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-700 tabular-nums">
            <span className="font-semibold">{checked.size}</span> checked · {money(checked.size * EQUIPMENT_REIMBURSEMENT_AMOUNT)}
          </span>
          {dirty && (
            <button onClick={() => { setChecked(new Set(saved)); setNotice(""); }} disabled={busy} className="apple-button apple-button-secondary">
              Undo changes
            </button>
          )}
          <button
            onClick={() => void save()}
            disabled={busy || !dirty}
            className={`apple-button ${busy || !dirty ? "apple-button-disabled" : "apple-button-primary"}`}
          >
            {saving ? "Saving…" : dirty ? `Save (${toAdd.length} checked, ${toRemove.length} unchecked)` : "Saved"}
          </button>
        </div>
      </div>

      {/* Vendor list */}
      <div className="max-h-[36rem] overflow-y-auto rounded-xl border border-gray-200">
        {loading && people.length === 0 ? (
          <div className="text-center py-6 text-sm text-gray-400">Loading onboarded vendors…</div>
        ) : visiblePeople.length === 0 ? (
          <div className="text-center py-6 text-sm text-gray-400">No vendors match these filters.</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left w-10">
                  <input
                    type="checkbox"
                    checked={allShownChecked}
                    onChange={() => setShown(!allShownChecked)}
                    disabled={busy || shownSelectable.length === 0}
                    aria-label="Check or uncheck everyone shown"
                  />
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Vendor</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">State</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visiblePeople.map((p) => {
                const isChecked = checked.has(p.user_id);
                const other = otherPeriodByUser.get(p.user_id);
                const disabled = busy || (!isChecked && !canCheck(p));
                let note: { text: string; className: string } | null = null;
                if (other) note = { text: `Checked in ${formatPayPeriod({ start: other.pay_period_start, end: other.pay_period_end }, false)}`, className: "text-gray-500" };
                else if (!p.eligible) note = { text: "No longer active or onboarded", className: "text-red-600" };
                else if (isChecked && !saved.has(p.user_id)) note = { text: "Not saved yet", className: "text-green-700" };
                else if (!isChecked && saved.has(p.user_id)) note = { text: "Will be unchecked", className: "text-red-600" };
                return (
                  <tr
                    key={p.user_id}
                    className={`${isChecked ? "bg-blue-50/50" : "hover:bg-gray-50"} ${disabled ? "" : "cursor-pointer"}`}
                    onClick={() => { if (!disabled) toggle(p); }}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={disabled}
                        onChange={() => toggle(p)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Equipment reimbursement for ${p.name}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-900">
                      <div className="font-medium">{p.name}</div>
                      {p.email && <div className="text-xs text-gray-400">{p.email}</div>}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-700">{p.state || "—"}</td>
                    <td className="px-3 py-2 text-sm text-gray-700">{roleLabel(p.role)}</td>
                    <td className="px-3 py-2 text-sm text-right tabular-nums text-gray-900">
                      {isChecked ? money(EQUIPMENT_REIMBURSEMENT_AMOUNT) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className={`px-3 py-2 text-xs ${note?.className || ""}`}>{note?.text || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="mt-2 text-xs text-gray-500">
        {eligibleCount} onboarded vendors · showing {visiblePeople.length}
      </div>
    </div>
  );
}
