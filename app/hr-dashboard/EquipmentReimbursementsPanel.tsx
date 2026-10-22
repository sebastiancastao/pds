"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { money } from "./reimbursements-export";
import { downloadExcelSheets, roundCents } from "./equipment-reimbursement-export";
import {
  EQUIPMENT_REIMBURSEMENT_AMOUNT,
  formatPayDate,
  formatPayMonth,
  lastCompletedPayPeriod,
  listEquipmentPayPeriods,
  payDateOf,
  type EquipmentPayPeriod,
} from "@/lib/equipment-reimbursement";

// Equipment reimbursement for the HR dashboard Payroll tab: pick a pay date,
// then check the onboarded vendors who get the $20 monthly equipment
// reimbursement on it. Each person can be checked for only one pay date per
// month (the month the pay date falls in). Data: equipment_reimbursement_queue
// via /api/hr/equipment-reimbursements.

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
  const payDateOptions = useMemo(() => listEquipmentPayPeriods(today, 2), [today]);
  const nextPayDate = useMemo(
    () => payDateOptions.filter((p) => p.payDate >= today).map((p) => p.payDate).sort()[0] || "",
    [payDateOptions, today],
  );
  const [payDate, setPayDate] = useState(() => lastCompletedPayPeriod(today).payDate);

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

  const load = useCallback(async (date: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}?pay_date=${encodeURIComponent(date)}`, { headers: await authHeaders(), cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to load equipment reimbursements");
      const rows: MonthRow[] = Array.isArray(json.month_rows) ? json.month_rows : [];
      setPeriod(json.period || null);
      setMonthPeriods(Array.isArray(json.month_periods) ? json.month_periods : []);
      setPeople(Array.isArray(json.people) ? json.people : []);
      setMonthRows(rows);
      setChecked(new Set(rows.filter((r) => payDateOf(r) === date).map((r) => r.user_id)));
    } catch (err: any) {
      setError(err?.message || "Failed to load equipment reimbursements");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(payDate);
  }, [payDate, load]);

  // Saved state for the selected pay date, and who is already checked for
  // another pay date of the same month.
  const saved = useMemo(
    () => new Set(monthRows.filter((r) => payDateOf(r) === payDate).map((r) => r.user_id)),
    [monthRows, payDate],
  );
  const otherPayDateByUser = useMemo(() => {
    const map = new Map<string, MonthRow>();
    for (const r of monthRows) if (payDateOf(r) !== payDate) map.set(r.user_id, r);
    return map;
  }, [monthRows, payDate]);

  const toAdd = useMemo(() => Array.from(checked).filter((id) => !saved.has(id)), [checked, saved]);
  const toRemove = useMemo(() => Array.from(saved).filter((id) => !checked.has(id)), [checked, saved]);
  const dirty = toAdd.length + toRemove.length > 0;

  const canCheck = (p: Person) => p.eligible && !otherPayDateByUser.has(p.user_id);

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

  const changePayDate = (date: string) => {
    if (date === payDate) return;
    if (dirty && !window.confirm("You have unsaved changes for this pay date. Discard them?")) return;
    setNotice("");
    setPayDate(date);
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
        body: JSON.stringify({ pay_date: payDate, user_ids: Array.from(checked) }),
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to save");
      const parts = [`Saved. ${json.added} checked, ${json.removed} unchecked.`];
      const other: string[] = Array.isArray(json.skipped_other_period) ? json.skipped_other_period : [];
      const ineligible: string[] = Array.isArray(json.skipped_ineligible) ? json.skipped_ineligible : [];
      if (other.length) parts.push(`Skipped ${other.length} already checked for another pay date this month: ${other.join(", ")}.`);
      if (ineligible.length) parts.push(`Skipped ${ineligible.length} no longer active or onboarded: ${ineligible.join(", ")}.`);
      setNotice(parts.join(" "));
      onSaved?.();
      await load(payDate);
    } catch (err: any) {
      setError(err?.message || "Failed to save");
      await load(payDate);
    } finally {
      setSaving(false);
    }
  };

  // Two sheets from the saved data: who is paid on this pay date, and every
  // vendor in the list with the pay date they are checked for this month.
  const exportToExcel = () => {
    if (!period) return;
    if (dirty && !window.confirm("You have unsaved changes. The Excel file only has the saved list. Download it anyway?")) return;
    const thisDate = formatPayDate(period.payDate);
    const rowByUser = new Map(monthRows.map((r) => [r.user_id, r] as const));

    const paidHere = people
      .filter((p) => rowByUser.get(p.user_id) && payDateOf(rowByUser.get(p.user_id)!) === period.payDate)
      .map((p) => ({ person: p, row: rowByUser.get(p.user_id)! }));
    const payDateRows: Array<Record<string, string | number>> = paidHere.map(({ person, row }) => ({
      Name: person.name,
      Email: person.email,
      State: person.state,
      Role: roleLabel(person.role),
      "Pay Date": thisDate,
      Amount: roundCents(row.amount),
    }));
    payDateRows.push({
      Name: "Total",
      Email: `${paidHere.length} ${paidHere.length === 1 ? "person" : "people"}`,
      State: "",
      Role: "",
      "Pay Date": "",
      Amount: roundCents(paidHere.reduce((s, { row }) => s + row.amount, 0)),
    });

    const monthLabel = formatPayMonth(period.month);
    let monthCount = 0;
    let monthTotal = 0;
    const vendorRows: Array<Record<string, string | number>> = people.map((p) => {
      const row = rowByUser.get(p.user_id);
      if (row) {
        monthCount += 1;
        monthTotal += row.amount;
      }
      return {
        Name: p.name,
        Email: p.email,
        State: p.state,
        Role: roleLabel(p.role),
        Status: row ? "Checked" : p.eligible ? "Not checked" : "No longer active or onboarded",
        "Pay Date": row ? formatPayDate(payDateOf(row)) : "",
        Amount: row ? roundCents(row.amount) : "",
      };
    });
    vendorRows.push({
      Name: "Total",
      Email: `${monthCount} checked in ${monthLabel}`,
      State: "",
      Role: "",
      Status: "",
      "Pay Date": "",
      Amount: roundCents(monthTotal),
    });

    const widths = { Name: 26, Email: 32, State: 8, Role: 12, Status: 28, "Pay Date": 14, Amount: 12 };
    downloadExcelSheets(`equipment_reimbursement_paid_${period.payDate}.xlsx`, [
      { name: `Paid ${formatPayDate(period.payDate)}`.replace(/,/g, ""), headers: ["Name", "Email", "State", "Role", "Pay Date", "Amount"], rows: payDateRows, widths },
      { name: `All Vendors ${monthLabel}`, headers: ["Name", "Email", "State", "Role", "Status", "Pay Date", "Amount"], rows: vendorRows, widths },
    ]);
  };

  // Pay date dropdown grouped by the month each pay date falls in.
  const payDateGroups = useMemo(() => {
    const groups: Array<{ month: string; periods: EquipmentPayPeriod[] }> = [];
    for (const p of payDateOptions) {
      const last = groups[groups.length - 1];
      if (last && last.month === p.month) last.periods.push(p);
      else groups.push({ month: p.month, periods: [p] });
    }
    return groups;
  }, [payDateOptions]);

  const busy = loading || saving;
  const savedCount = saved.size;

  return (
    <div className="apple-card mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-semibold">Equipment Reimbursement</h2>
          <p className="text-sm text-gray-500">
            {money(EQUIPMENT_REIMBURSEMENT_AMOUNT)} a month for each checked vendor, paid on one of the month&apos;s pay dates.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={exportToExcel}
            disabled={busy || !period}
            className={`apple-button ${busy || !period ? "apple-button-disabled" : "apple-button-secondary"}`}
            title="Download the saved list for this pay date, plus every vendor with the pay date they are checked for this month."
          >
            Export to Excel ({savedCount})
          </button>
          <button onClick={() => void load(payDate)} disabled={busy} className="apple-button apple-button-secondary">
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Pay date */}
      <div className="flex flex-wrap items-end gap-4 mb-4">
        <div>
          <label className="apple-label" htmlFor="equip-pay-date">Pay date</label>
          <select
            id="equip-pay-date"
            value={payDate}
            onChange={(e) => changePayDate(e.target.value)}
            disabled={saving}
            className="apple-select"
          >
            {payDateGroups.map((g) => (
              <optgroup key={g.month} label={formatPayMonth(g.month)}>
                {g.periods.map((p) => (
                  <option key={p.payDate} value={p.payDate}>
                    {formatPayDate(p.payDate, { weekday: true })}
                    {p.payDate === nextPayDate ? " (next pay date)" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {period && (
          <div className="pb-2 text-sm text-gray-600">
            <span className="font-medium text-gray-900">{formatPayMonth(period.month)}</span> pay dates:{" "}
            {monthPeriods.map((p, i) => {
              const count = monthRows.filter((r) => payDateOf(r) === p.payDate).length;
              const selected = p.payDate === payDate;
              return (
                <span key={p.payDate}>
                  {i > 0 && " · "}
                  {selected ? (
                    <span className="font-medium text-gray-900">{formatPayDate(p.payDate, { year: false })} (this one, {count} saved)</span>
                  ) : (
                    <button type="button" onClick={() => changePayDate(p.payDate)} className="text-blue-600 hover:text-blue-800">
                      {formatPayDate(p.payDate, { year: false })} ({count} saved)
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
                const other = otherPayDateByUser.get(p.user_id);
                const disabled = busy || (!isChecked && !canCheck(p));
                let note: { text: string; className: string } | null = null;
                if (other) note = { text: `Checked for ${formatPayDate(payDateOf(other), { year: false })}`, className: "text-gray-500" };
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
