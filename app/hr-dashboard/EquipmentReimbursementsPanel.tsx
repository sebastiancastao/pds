"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { money } from "./reimbursements-export";
import { downloadExcelSheets, roundCents } from "./equipment-reimbursement-export";
import {
  EARLIEST_EQUIPMENT_PAY_DATE,
  EQUIPMENT_REIMBURSEMENT_AMOUNT,
  formatPayDate,
  formatPayMonth,
  payPeriodForPayDate,
  type EquipmentPayPeriod,
} from "@/lib/equipment-reimbursement";

// Equipment reimbursement for the HR dashboard Payroll tab: type or pick a pay
// date (any date, nothing preselected), then check the onboarded accounts who
// get the $20 monthly equipment reimbursement on it. Worker accounts are listed;
// staff accounts (exec, manager, supervisor...) only show when they are checked
// this month (the "Show staff accounts" switch was removed at the user's request
// on 2026-10-23). Many staff have a company account and a personal worker
// account, so a row notes when the same person is checked on two accounts
// (paid twice). Each account can be checked for only one pay date per month
// (the month the pay date falls in). The list can be filtered and grouped by
// region (the profile's region). Data: equipment_reimbursement_queue via
// /api/hr/equipment-reimbursements.

type Person = {
  user_id: string;
  name: string;
  email: string;
  role: string;
  state: string;
  region_id: string;
  region_name: string;
  eligible: boolean;
  ineligible_reason?: "" | "inactive";
  staff?: boolean;
};

type MonthRow = {
  id: string;
  user_id: string;
  pay_date: string;
  pay_period_start: string;
  pay_period_end: string;
  amount: number;
};

type ShowFilter = "all" | "checked" | "unchecked";
type ViewMode = "region" | "list";

type RegionSummary = { key: string; label: string; total: number; checked: number };

const API = "/api/hr/equipment-reimbursements";
const ALL_REGIONS = "all";
const VIEW_STORAGE_KEY = "hr-equipment-reimbursement-view";

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

// The profile state, or "" when it is missing or the "XX" placeholder.
const stateOf = (p: { state?: string | null }) => {
  const s = String(p.state || "").trim().toUpperCase();
  return STATE_NAMES[s] ? s : "";
};

const roleLabel = (role: string) => {
  const r = role.trim().toLowerCase();
  if (!r || r === "worker" || r === "vendor") return "Vendor";
  return r.charAt(0).toUpperCase() + r.slice(1);
};

// Group by the profile region; people with no region are grouped by their
// state instead (user 2026-10-23: no "No region" group). People with neither
// have no group ("" key): they are left out of the cards and the grouped view
// (user 2026-10-23: no "State not set" group) and show in One list view.
const regionKeyOf = (p: Person) => p.region_id || (stateOf(p) ? `state:${stateOf(p)}` : "");
const regionLabelOf = (p: Person) => p.region_name || STATE_NAMES[stateOf(p)] || "";
const hasPlace = (p: Person) => regionKeyOf(p) !== "";

// Regions by name, then state groups by name, then people with neither.
const groupRank = (key: string) => (!key ? 2 : key.startsWith("state:") ? 1 : 0);
const compareRegions = (a: { key: string; label: string }, b: { key: string; label: string }) =>
  groupRank(a.key) - groupRank(b.key) || a.label.localeCompare(b.label);

// Region order, then name, for the Excel sheets.
const compareByRegionThenName = (a: Person, b: Person) =>
  compareRegions({ key: regionKeyOf(a), label: regionLabelOf(a) }, { key: regionKeyOf(b), label: regionLabelOf(b) }) ||
  a.name.localeCompare(b.name);

const INELIGIBLE_TEXT = "No longer active or onboarded";

// "Staff (Supervisor)" for staff accounts, "Worker" otherwise.
const accountLabel = (p: Person) => (p.staff ? `Staff (${roleLabel(p.role)})` : "Worker");

// Same person on two accounts (company staff account + personal worker account):
// names compared without case, spaces or punctuation.
const personKey = (p: Person) => p.name.toLowerCase().replace(/[^a-z]/g, "");

function readStoredView(): ViewMode {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === "list" ? "list" : "region";
  } catch {
    return "region";
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

// onSaved is an optional callback run after a save (the Payroll tab no longer uses it).
export default function EquipmentReimbursementsPanel({ onSaved }: { onSaved?: () => void } = {}) {
  // dateInput is what the date field shows; payDate is the date the list is loaded for.
  const [dateInput, setDateInput] = useState("");
  const [payDate, setPayDate] = useState("");

  const [period, setPeriod] = useState<EquipmentPayPeriod | null>(null);
  const [loadedPeople, setPeople] = useState<Person[]>([]);
  const [monthRows, setMonthRows] = useState<MonthRow[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Changing a saved pay date (accounting may pay on another day).
  const [moving, setMoving] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<ShowFilter>("all");
  const [regionFilter, setRegionFilter] = useState<string>(ALL_REGIONS);
  const [view, setView] = useState<ViewMode>("region");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const requestRef = useRef(0);

  useEffect(() => {
    setView(readStoredView());
  }, []);

  const changeView = (next: ViewMode) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // storage blocked: the choice just isn't remembered
    }
  };

  const load = useCallback(async (date: string) => {
    const requestId = ++requestRef.current;
    setError("");
    if (!date) {
      setPeriod(null);
      setPeople([]);
      setMonthRows([]);
      setChecked(new Set());
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API}?pay_date=${encodeURIComponent(date)}`, { headers: await authHeaders(), cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to load equipment reimbursements");
      if (requestId !== requestRef.current) return; // a newer date was picked meanwhile
      const rows: MonthRow[] = Array.isArray(json.month_rows) ? json.month_rows : [];
      setPeriod(json.period || null);
      setPeople(Array.isArray(json.people) ? json.people : []);
      setMonthRows(rows);
      setChecked(new Set(rows.filter((r) => r.pay_date === date).map((r) => r.user_id)));
    } catch (err: any) {
      if (requestId === requestRef.current) setError(err?.message || "Failed to load equipment reimbursements");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(payDate);
  }, [payDate, load]);

  // Saved state for the selected pay date, and who is already checked for
  // another pay date of the same month.
  const saved = useMemo(
    () => new Set(monthRows.filter((r) => r.pay_date === payDate).map((r) => r.user_id)),
    [monthRows, payDate],
  );
  const otherPayDateByUser = useMemo(() => {
    const map = new Map<string, MonthRow>();
    for (const r of monthRows) if (r.pay_date !== payDate) map.set(r.user_id, r);
    return map;
  }, [monthRows, payDate]);

  const toAdd = useMemo(() => Array.from(checked).filter((id) => !saved.has(id)), [checked, saved]);
  const toRemove = useMemo(() => Array.from(saved).filter((id) => !checked.has(id)), [checked, saved]);
  const dirty = toAdd.length + toRemove.length > 0;

  const canCheck = (p: Person) => p.eligible && !otherPayDateByUser.has(p.user_id);
  const grouped = view === "region";

  // Company staff accounts usually have no region and the "XX" state; they take
  // the region and state of the same person's other account (matched by name),
  // so they sit next to it.
  const people = useMemo(() => {
    const placeByName = new Map<string, Person>();
    for (const p of loadedPeople) {
      const key = personKey(p);
      if (key && hasPlace(p) && !placeByName.has(key)) placeByName.set(key, p);
    }
    return loadedPeople.map((p) => {
      if (hasPlace(p)) return p;
      const twin = placeByName.get(personKey(p));
      return twin ? { ...p, region_id: twin.region_id, region_name: twin.region_name, state: twin.state } : p;
    });
  }, [loadedPeople]);

  // Worker accounts, plus staff accounts when shown or when checked this month.
  const listedPeople = useMemo(
    () =>
      people.filter(
        (p) => !p.staff || checked.has(p.user_id) || saved.has(p.user_id) || otherPayDateByUser.has(p.user_id),
      ),
    [people, checked, saved, otherPayDateByUser],
  );

  // People checked this month (this pay date as it stands, or another one) on
  // more than one account: they would be paid twice.
  const otherCheckedAccounts = useMemo(() => {
    const byKey = new Map<string, Person[]>();
    for (const p of people) {
      if (!checked.has(p.user_id) && !otherPayDateByUser.has(p.user_id)) continue;
      const key = personKey(p);
      if (!key) continue;
      byKey.set(key, [...(byKey.get(key) || []), p]);
    }
    const others = new Map<string, Person[]>();
    byKey.forEach((list) => {
      if (list.length < 2) return;
      for (const p of list) others.set(p.user_id, list.filter((o) => o.user_id !== p.user_id));
    });
    return others;
  }, [people, checked, otherPayDateByUser]);

  // One card per region over the whole list (search and Show don't change it),
  // with what is checked right now, saved or not.
  const regionSummaries = useMemo(() => {
    const map = new Map<string, RegionSummary>();
    for (const p of listedPeople) {
      if (!hasPlace(p)) continue;
      const key = regionKeyOf(p);
      let s = map.get(key);
      if (!s) {
        s = { key, label: regionLabelOf(p), total: 0, checked: 0 };
        map.set(key, s);
      }
      s.total += 1;
      if (checked.has(p.user_id)) s.checked += 1;
    }
    return Array.from(map.values()).sort(compareRegions);
  }, [listedPeople, checked]);

  // A region picked for another pay date may have nobody in this list.
  const activeRegion = regionSummaries.some((s) => s.key === regionFilter) ? regionFilter : ALL_REGIONS;

  const visiblePeople = useMemo(() => {
    const q = search.trim().toLowerCase();
    return listedPeople.filter((p) => {
      if (activeRegion !== ALL_REGIONS && regionKeyOf(p) !== activeRegion) return false;
      if (show === "checked" && !checked.has(p.user_id)) return false;
      if (show === "unchecked" && checked.has(p.user_id)) return false;
      if (q && !`${p.name} ${p.email} ${stateOf(p)} ${STATE_NAMES[stateOf(p)] || ""} ${regionLabelOf(p)} ${accountLabel(p)}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [listedPeople, search, show, checked, activeRegion]);

  const visibleGroups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; people: Person[] }>();
    for (const p of visiblePeople) {
      if (!hasPlace(p)) continue;
      const key = regionKeyOf(p);
      if (!map.has(key)) map.set(key, { key, label: regionLabelOf(p), people: [] });
      map.get(key)!.people.push(p);
    }
    return Array.from(map.values()).sort(compareRegions);
  }, [visiblePeople]);

  const workerCount = useMemo(() => people.filter((p) => p.eligible && !p.staff).length, [people]);
  const selectableOf = (list: Person[]) => list.filter((p) => canCheck(p) || checked.has(p.user_id));
  const allCheckedOf = (list: Person[]) => {
    const selectable = selectableOf(list);
    return selectable.length > 0 && selectable.every((p) => checked.has(p.user_id));
  };
  // The rows on screen: the grouped view leaves out people with no region or state.
  const shownPeople = useMemo(() => (grouped ? visiblePeople.filter(hasPlace) : visiblePeople), [grouped, visiblePeople]);
  const unplacedHidden = grouped ? visiblePeople.filter((p) => !hasPlace(p)) : [];
  const unplacedHiddenChecked = unplacedHidden.filter((p) => checked.has(p.user_id)).length;
  const shownSelectable = selectableOf(shownPeople);
  const allShownChecked = allCheckedOf(shownPeople);

  // Checked people who can't be paid: no longer active or onboarded.
  const blockedChecked = useMemo(() => people.filter((p) => !p.eligible && checked.has(p.user_id)), [people, checked]);

  // The loaded data matches the date in the field.
  const ready = Boolean(payDate && period && period.payDate === payDate);

  // Pay dates of this month that already have people saved, plus the selected one.
  const monthPayDates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of monthRows) counts.set(r.pay_date, (counts.get(r.pay_date) || 0) + 1);
    if (payDate && !counts.has(payDate)) counts.set(payDate, 0);
    return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [monthRows, payDate]);

  const changePayDate = (date: string) => {
    if (date === payDate) {
      setDateInput(date);
      return;
    }
    if (dirty && !window.confirm("You have unsaved changes for this pay date. Discard them?")) {
      setDateInput(payDate);
      return;
    }
    setNotice("");
    setMoveOpen(false);
    setMoveTo("");
    setDateInput(date);
    setPayDate(date);
  };

  // The date field reports partial or out-of-range dates while someone types;
  // only a full date from the first pay period on loads the list.
  const onDateInput = (value: string) => {
    setDateInput(value);
    if (value && payPeriodForPayDate(value)) changePayDate(value);
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

  // Check (only people who can be checked) or uncheck everyone in `list`.
  const setListChecked = (list: Person[], on: boolean) => {
    setNotice("");
    setChecked((prev) => {
      const next = new Set(prev);
      for (const p of list) {
        if (on && canCheck(p)) next.add(p.user_id);
        if (!on) next.delete(p.user_id);
      }
      return next;
    });
  };

  const toggleCollapsed = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Move everyone saved for `from` to `to`. The pay date is provisional (HR
  // 2026-10-23: accounting may not pay on that day), so a saved list can move.
  const movePayDate = async (from: string, to: string) => {
    const target = payPeriodForPayDate(to);
    if (!target || from === to) return;
    const count = monthRows.filter((r) => r.pay_date === from).length;
    const fromMonth = formatPayMonth(from.slice(0, 7));
    const toMonth = formatPayMonth(target.month);
    const lines = [`Move ${count} ${count === 1 ? "person" : "people"} from ${formatPayDate(from, { weekday: true })} to ${formatPayDate(to, { weekday: true })}?`];
    if (from.slice(0, 7) !== target.month) {
      lines.push(
        `${formatPayDate(to)} is in ${toMonth}, so this becomes their ${toMonth} equipment reimbursement and they get none in ${fromMonth}. Anyone already paid in ${toMonth} stays on ${formatPayDate(from)}.`,
      );
    }
    if (dirty) lines.push("Your unsaved changes on this pay date will be discarded.");
    if (!window.confirm(lines.join("\n\n"))) return;

    setMoving(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(API, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ from_pay_date: from, to_pay_date: to }),
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to change the pay date");
      const moved = Number(json.moved || 0);
      const skipped: string[] = Array.isArray(json.skipped_already_paid_that_month) ? json.skipped_already_paid_that_month : [];
      const parts = [`Moved ${moved} ${moved === 1 ? "person" : "people"} from ${formatPayDate(from)} to ${formatPayDate(to)}.`];
      if (skipped.length) parts.push(`Kept ${skipped.length} on ${formatPayDate(from)} because they are already paid in ${toMonth}: ${skipped.join(", ")}.`);
      setMoveOpen(false);
      setMoveTo("");
      onSaved?.();
      setDateInput(to);
      if (payDate === to) await load(to);
      else setPayDate(to);
      setNotice(parts.join(" "));
    } catch (err: any) {
      setError(err?.message || "Failed to change the pay date");
      await load(payDate);
    } finally {
      setMoving(false);
    }
  };

  const save = async () => {
    if (!ready) return;
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

  // Three sheets from the saved data, all regions, sorted by region then name:
  // who is paid on this pay date, every worker in the list with the pay date
  // they are checked for this month, and a count and total per region.
  const exportToExcel = () => {
    if (!ready || !period) return;
    if (dirty && !window.confirm("You have unsaved changes. The Excel file only has the saved list. Download it anyway?")) return;
    const thisDate = formatPayDate(period.payDate);
    const rowByUser = new Map(monthRows.map((r) => [r.user_id, r] as const));
    // Worker accounts, plus staff accounts that are checked this month.
    const sorted = people.filter((p) => !p.staff || rowByUser.has(p.user_id)).sort(compareByRegionThenName);
    // Same person saved on another account this month (paid twice).
    const savedByKey = new Map<string, Person[]>();
    for (const p of sorted) {
      if (!rowByUser.has(p.user_id) || !personKey(p)) continue;
      savedByKey.set(personKey(p), [...(savedByKey.get(personKey(p)) || []), p]);
    }
    const alsoSavedAs = (p: Person) =>
      (savedByKey.get(personKey(p)) || []).filter((o) => o.user_id !== p.user_id).map((o) => o.email).join(", ");

    const paidHere = sorted
      .filter((p) => rowByUser.get(p.user_id)?.pay_date === period.payDate)
      .map((p) => ({ person: p, row: rowByUser.get(p.user_id)! }));
    const payDateRows: Array<Record<string, string | number>> = paidHere.map(({ person, row }) => ({
      Name: person.name,
      Email: person.email,
      Account: accountLabel(person),
      Region: person.region_name || "",
      State: stateOf(person),
      "Pay Date": thisDate,
      Amount: roundCents(row.amount),
      Warning: alsoSavedAs(person) ? `Also checked as ${alsoSavedAs(person)}` : "",
    }));
    payDateRows.push({
      Name: "Total",
      Email: `${paidHere.length} ${paidHere.length === 1 ? "account" : "accounts"}`,
      Account: "",
      Region: "",
      State: "",
      "Pay Date": "",
      Amount: roundCents(paidHere.reduce((s, { row }) => s + row.amount, 0)),
      Warning: "",
    });

    const monthLabel = formatPayMonth(period.month);
    let monthCount = 0;
    let monthTotal = 0;
    const vendorRows: Array<Record<string, string | number>> = sorted.map((p) => {
      const row = rowByUser.get(p.user_id);
      if (row) {
        monthCount += 1;
        monthTotal += row.amount;
      }
      return {
        Name: p.name,
        Email: p.email,
        Account: accountLabel(p),
        Region: p.region_name || "",
        State: stateOf(p),
        Status: row ? (p.eligible ? "Checked" : `Checked, ${INELIGIBLE_TEXT.toLowerCase()}`) : p.eligible ? "Not checked" : INELIGIBLE_TEXT,
        "Pay Date": row ? formatPayDate(row.pay_date) : "",
        Amount: row ? roundCents(row.amount) : "",
        Warning: row && alsoSavedAs(p) ? `Also checked as ${alsoSavedAs(p)}` : "",
      };
    });
    vendorRows.push({
      Name: "Total",
      Email: `${monthCount} checked in ${monthLabel}`,
      Account: "",
      Region: "",
      State: "",
      Status: "",
      "Pay Date": "",
      Amount: roundCents(monthTotal),
      Warning: "",
    });

    const regionTotals = new Map<string, { key: string; label: string; workers: number; paidHere: number; paidHereAmount: number; month: number; monthAmount: number }>();
    for (const p of sorted) {
      const key = regionKeyOf(p);
      if (!regionTotals.has(key)) regionTotals.set(key, { key, label: regionLabelOf(p) || "—", workers: 0, paidHere: 0, paidHereAmount: 0, month: 0, monthAmount: 0 });
      const t = regionTotals.get(key)!;
      if (p.eligible && !p.staff) t.workers += 1;
      const row = rowByUser.get(p.user_id);
      if (row) {
        t.month += 1;
        t.monthAmount += row.amount;
        if (row.pay_date === period.payDate) {
          t.paidHere += 1;
          t.paidHereAmount += row.amount;
        }
      }
    }
    const regionList = Array.from(regionTotals.values()).sort(compareRegions);
    const paidHereHeader = `Paid ${formatPayDate(period.payDate, { year: false })}`;
    const paidHereAmountHeader = `Amount ${formatPayDate(period.payDate, { year: false })}`;
    const monthHeader = `Checked in ${monthLabel}`;
    const monthAmountHeader = `Amount ${monthLabel}`;
    const regionRows: Array<Record<string, string | number>> = regionList.map((t) => ({
      Region: t.label,
      "Worker Accounts": t.workers,
      [paidHereHeader]: t.paidHere,
      [paidHereAmountHeader]: roundCents(t.paidHereAmount),
      [monthHeader]: t.month,
      [monthAmountHeader]: roundCents(t.monthAmount),
    }));
    regionRows.push({
      Region: "Total",
      "Worker Accounts": regionList.reduce((s, t) => s + t.workers, 0),
      [paidHereHeader]: regionList.reduce((s, t) => s + t.paidHere, 0),
      [paidHereAmountHeader]: roundCents(regionList.reduce((s, t) => s + t.paidHereAmount, 0)),
      [monthHeader]: regionList.reduce((s, t) => s + t.month, 0),
      [monthAmountHeader]: roundCents(regionList.reduce((s, t) => s + t.monthAmount, 0)),
    });

    const widths = { Name: 26, Email: 32, Account: 20, Region: 18, State: 8, Status: 34, "Pay Date": 14, Amount: 12, Warning: 44 };
    downloadExcelSheets(`equipment_reimbursement_paid_${period.payDate}.xlsx`, [
      { name: `Paid ${formatPayDate(period.payDate)}`.replace(/,/g, ""), headers: ["Name", "Email", "Account", "Region", "State", "Pay Date", "Amount", "Warning"], rows: payDateRows, widths },
      { name: `All Vendors ${monthLabel}`, headers: ["Name", "Email", "Account", "Region", "State", "Status", "Pay Date", "Amount", "Warning"], rows: vendorRows, widths },
      {
        name: "By Region",
        headers: ["Region", "Worker Accounts", paidHereHeader, paidHereAmountHeader, monthHeader, monthAmountHeader],
        rows: regionRows,
        widths: { Region: 20, "Worker Accounts": 16, [paidHereHeader]: 14, [paidHereAmountHeader]: 16, [monthHeader]: 22, [monthAmountHeader]: 22 },
        moneyHeaders: [paidHereAmountHeader, monthAmountHeader],
      },
    ]);
  };

  const busy = loading || saving || moving;
  // Other pay dates of this month with people saved, shown when nobody is saved
  // on the selected date yet: those people are locked here (once a month).
  const otherSavedDates = ready && saved.size === 0 ? monthPayDates.filter(([date, count]) => date !== payDate && count > 0) : [];
  const savedCount = saved.size;

  const renderPersonRow = (p: Person) => {
    const isChecked = checked.has(p.user_id);
    const other = otherPayDateByUser.get(p.user_id);
    const disabled = busy || (!isChecked && !canCheck(p));
    let note: { text: string; className: string } | null = null;
    if (other) note = { text: `Checked for ${formatPayDate(other.pay_date, { year: false })}`, className: "text-gray-500" };
    else if (!isChecked && saved.has(p.user_id)) note = { text: "Will be unchecked", className: "text-red-600" };
    else if (!p.eligible) note = { text: INELIGIBLE_TEXT, className: "text-red-600" };
    else if (isChecked && !saved.has(p.user_id)) note = { text: "Not saved yet", className: "text-green-700" };
    const twins = otherCheckedAccounts.get(p.user_id);
    const twinText = twins?.length && (isChecked || other) ? `Paid twice: also checked as ${twins.map((t) => t.email).join(", ")}` : "";
    return (
      <tr
        key={p.user_id}
        className={`${isChecked ? "bg-blue-50/50" : "hover:bg-gray-50"} ${disabled ? "" : "cursor-pointer"}`}
        onClick={() => { if (!disabled) toggle(p); }}
      >
        <td className={`py-2 ${grouped ? "pl-6 pr-3" : "px-3"}`}>
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
          <div className="font-medium">
            {p.name}
            {p.staff && (
              <span className="ml-2 rounded bg-purple-50 px-1.5 py-0.5 text-xs font-normal text-purple-700" title="Staff account, not a worker account">
                Staff · {roleLabel(p.role)}
              </span>
            )}
          </div>
          {p.email && <div className="text-xs text-gray-400">{p.email}</div>}
        </td>
        {!grouped && <td className="px-3 py-2 text-sm text-gray-700">{p.region_name || "—"}</td>}
        <td className="px-3 py-2 text-sm text-gray-700">{stateOf(p) || "—"}</td>
        <td className="px-3 py-2 text-sm text-right tabular-nums text-gray-900">
          {isChecked ? money(EQUIPMENT_REIMBURSEMENT_AMOUNT) : <span className="text-gray-300">—</span>}
        </td>
        <td className="px-3 py-2 text-xs">
          {note && <div className={note.className}>{note.text}</div>}
          {twinText && <div className="font-medium text-amber-700">{twinText}</div>}
        </td>
      </tr>
    );
  };

  const allSummary: RegionSummary = {
    key: ALL_REGIONS,
    label: "All regions",
    total: listedPeople.length,
    checked: checked.size,
  };

  return (
    <div className="apple-card mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-semibold">Equipment Reimbursement</h2>
          <p className="text-sm text-gray-500">
            {money(EQUIPMENT_REIMBURSEMENT_AMOUNT)} a month for each checked account, paid on the pay date you choose.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={exportToExcel}
            disabled={busy || !ready}
            className={`apple-button ${busy || !ready ? "apple-button-disabled" : "apple-button-secondary"}`}
            title={ready ? "Download the saved list for this pay date, every worker with the pay date they are checked for this month, and a total per region. Always includes all regions." : "Choose a pay date first."}
          >
            Export to Excel{ready ? ` (${savedCount})` : ""}
          </button>
          <button onClick={() => void load(payDate)} disabled={busy || !payDate} className="apple-button apple-button-secondary">
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Pay date */}
      <div className="flex flex-wrap items-end gap-4 mb-4">
        <div>
          <label className="apple-label" htmlFor="equip-pay-date">Pay date</label>
          <input
            id="equip-pay-date"
            type="date"
            value={dateInput}
            min={EARLIEST_EQUIPMENT_PAY_DATE}
            onChange={(e) => onDateInput(e.target.value)}
            disabled={saving || moving}
            className="apple-select"
          />
        </div>
        {ready && period ? (
          <div className="pb-2 text-sm text-gray-600">
            <span className="font-medium text-gray-900">{formatPayMonth(period.month)}</span> pay dates:{" "}
            {monthPayDates.map(([date, count], i) => (
              <span key={date}>
                {i > 0 && " · "}
                {date === payDate ? (
                  <span className="font-medium text-gray-900">{formatPayDate(date, { year: false, weekday: true })} (this one, {count} saved)</span>
                ) : (
                  <button type="button" onClick={() => changePayDate(date)} className="text-blue-600 hover:text-blue-800">
                    {formatPayDate(date, { year: false, weekday: true })} ({count} saved)
                  </button>
                )}
              </span>
            ))}
          </div>
        ) : (
          <div className="pb-2 text-sm text-gray-500">Any date. Each account can be paid once per month.</div>
        )}
        {/* Change a saved pay date (accounting may pay on another day) */}
        {ready && saved.size > 0 &&
          (moveOpen ? (
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="apple-label" htmlFor="equip-move-to">New pay date</label>
                <input
                  id="equip-move-to"
                  type="date"
                  value={moveTo}
                  min={EARLIEST_EQUIPMENT_PAY_DATE}
                  onChange={(e) => setMoveTo(e.target.value)}
                  disabled={busy}
                  className="apple-select"
                />
              </div>
              <button
                type="button"
                onClick={() => void movePayDate(payDate, moveTo)}
                disabled={busy || !payPeriodForPayDate(moveTo) || moveTo === payDate}
                className={`apple-button ${busy || !payPeriodForPayDate(moveTo) || moveTo === payDate ? "apple-button-disabled" : "apple-button-primary"}`}
              >
                {moving ? "Moving…" : `Move ${saved.size} to this date`}
              </button>
              <button
                type="button"
                onClick={() => { setMoveOpen(false); setMoveTo(""); }}
                disabled={moving}
                className="apple-button apple-button-secondary"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setMoveOpen(true)}
              disabled={busy}
              className="apple-button apple-button-secondary"
              title="Accounting paying on another day? Move everyone saved for this pay date to the new date."
            >
              Change pay date
            </button>
          ))}
      </div>

      {/* People saved for another date this month are locked on this one; offer to move them here */}
      {otherSavedDates.map(([date, count]) => (
        <div
          key={date}
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900"
        >
          <span>
            {count} {count === 1 ? "person is" : "people are"} saved for {formatPayDate(date, { weekday: true })}, so they can&apos;t be
            checked on this date. If the payment moved, move them here.
          </span>
          <button
            type="button"
            onClick={() => void movePayDate(date, payDate)}
            disabled={busy}
            className="apple-button apple-button-secondary"
          >
            {moving ? "Moving…" : `Move them to ${formatPayDate(payDate, { year: false, weekday: true })}`}
          </button>
        </div>
      ))}

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</div>}

      {!payDate ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-8 text-center text-sm text-gray-500">
          Choose a pay date to see the onboarded worker accounts.
        </div>
      ) : (
        <>
          {/* Checked people who can't be paid (no longer active or onboarded) */}
          {ready && blockedChecked.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span>
                {blockedChecked.length} checked {blockedChecked.length === 1 ? "account is" : "accounts are"} no longer active or onboarded and
                can't get the equipment reimbursement. Uncheck them, then Save.
              </span>
              <button
                type="button"
                onClick={() => setListChecked(blockedChecked, false)}
                disabled={busy}
                className="apple-button apple-button-secondary"
              >
                Uncheck {blockedChecked.length === 1 ? "it" : `these ${blockedChecked.length}`}
              </button>
            </div>
          )}

          {/* By region */}
          {ready && people.length > 0 && (
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase text-gray-500">By region</span>
                {activeRegion !== ALL_REGIONS && (
                  <button type="button" onClick={() => setRegionFilter(ALL_REGIONS)} className="text-xs text-blue-600 hover:text-blue-800">
                    Show all regions
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {[allSummary, ...regionSummaries].map((s) => {
                  const selected = s.key === activeRegion;
                  const pct = s.total > 0 ? Math.min(100, Math.round((s.checked / s.total) * 100)) : 0;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setRegionFilter(selected ? ALL_REGIONS : s.key)}
                      title={s.key === ALL_REGIONS ? "Show every region" : `Show only ${s.label}`}
                      className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                        selected ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500" : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      <div className="truncate text-sm font-medium text-gray-900">{s.label}</div>
                      <div className="text-xs tabular-nums text-gray-600">
                        {s.checked} of {s.total} checked
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-200">
                        <div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-1 text-xs font-medium tabular-nums text-gray-900">
                        {money(s.checked * EQUIPMENT_REIMBURSEMENT_AMOUNT)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Filters + totals + actions */}
          <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[14rem]">
                <label className="apple-label" htmlFor="equip-search">Search</label>
                <input
                  id="equip-search"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, email, region, state…"
                  className="apple-select w-full"
                />
              </div>
              <div>
                <label className="apple-label" htmlFor="equip-region">Region</label>
                <select id="equip-region" value={activeRegion} onChange={(e) => setRegionFilter(e.target.value)} className="apple-select">
                  <option value={ALL_REGIONS}>All regions</option>
                  {regionSummaries.map((s) => (
                    <option key={s.key} value={s.key}>{s.label} ({s.total})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="apple-label" htmlFor="equip-show">Show</label>
                <select id="equip-show" value={show} onChange={(e) => setShow(e.target.value as ShowFilter)} className="apple-select">
                  <option value="all">All</option>
                  <option value="checked">Checked</option>
                  <option value="unchecked">Not checked</option>
                </select>
              </div>
              <div>
                <label className="apple-label" htmlFor="equip-view">View</label>
                <select id="equip-view" value={view} onChange={(e) => changeView(e.target.value as ViewMode)} className="apple-select">
                  <option value="region">Grouped by region</option>
                  <option value="list">One list</option>
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
                disabled={busy || !dirty || !ready}
                className={`apple-button ${busy || !dirty || !ready ? "apple-button-disabled" : "apple-button-primary"}`}
              >
                {saving ? "Saving…" : dirty ? `Save (${toAdd.length} checked, ${toRemove.length} unchecked)` : "Saved"}
              </button>
            </div>
          </div>

          {/* Worker list */}
          <div className="max-h-[36rem] overflow-y-auto rounded-xl border border-gray-200">
            {loading && !ready ? (
              <div className="text-center py-6 text-sm text-gray-400">Loading onboarded worker accounts…</div>
            ) : shownPeople.length === 0 ? (
              <div className="text-center py-6 text-sm text-gray-400">No workers match these filters.</div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2 text-left w-10">
                      <input
                        type="checkbox"
                        checked={allShownChecked}
                        onChange={() => setListChecked(shownPeople, !allShownChecked)}
                        disabled={busy || shownSelectable.length === 0}
                        aria-label="Check or uncheck everyone shown"
                      />
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Worker</th>
                    {!grouped && <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Region</th>}
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">State</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {grouped
                    ? visibleGroups.map((group) => {
                        const isCollapsed = collapsed.has(group.key);
                        const groupChecked = group.people.filter((p) => checked.has(p.user_id)).length;
                        const groupSelectable = selectableOf(group.people);
                        const groupAllChecked = allCheckedOf(group.people);
                        return (
                          <Fragment key={group.key}>
                            <tr className="bg-gray-100">
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={groupAllChecked}
                                  onChange={() => setListChecked(group.people, !groupAllChecked)}
                                  disabled={busy || groupSelectable.length === 0}
                                  aria-label={`Check or uncheck everyone shown in ${group.label}`}
                                />
                              </td>
                              <td colSpan={2} className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => toggleCollapsed(group.key)}
                                  aria-expanded={!isCollapsed}
                                  className="flex items-center gap-2 text-left text-sm font-semibold text-gray-900"
                                >
                                  <span className="inline-block w-3 text-gray-500">{isCollapsed ? "▸" : "▾"}</span>
                                  {group.label}
                                  <span className="font-normal text-gray-500 tabular-nums">
                                    {groupChecked} of {group.people.length} checked
                                  </span>
                                </button>
                              </td>
                              <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums text-gray-900">
                                {money(groupChecked * EQUIPMENT_REIMBURSEMENT_AMOUNT)}
                              </td>
                              <td className="px-3 py-2" />
                            </tr>
                            {!isCollapsed && group.people.map(renderPersonRow)}
                          </Fragment>
                        );
                      })
                    : visiblePeople.map(renderPersonRow)}
                </tbody>
              </table>
            )}
          </div>
          <div className="mt-2 text-xs text-gray-500">
            {workerCount} onboarded worker accounts · showing {shownPeople.length}
            {grouped && visibleGroups.length > 0 ? ` in ${visibleGroups.length} ${visibleGroups.length === 1 ? "region" : "regions"}` : ""}
          </div>
          {unplacedHidden.length > 0 && (
            <div className="mt-1 text-xs text-gray-500">
              {unplacedHidden.length} {unplacedHidden.length === 1 ? "account has" : "accounts have"} no region or state in their profile
              {unplacedHiddenChecked > 0 ? ` (${unplacedHiddenChecked} checked)` : ""} and only {unplacedHidden.length === 1 ? "shows" : "show"} in{" "}
              <button type="button" onClick={() => changeView("list")} className="text-blue-600 hover:text-blue-800">
                One list
              </button>{" "}
              view.
            </div>
          )}
        </>
      )}
    </div>
  );
}
