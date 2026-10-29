"use client";

import { useState } from "react";

// HR flag on the Payroll tab: a vendor whose Commission Pay is under 50% of
// Commission Pay + Variable Incentive for the loaded pay period, i.e. most of
// what they were paid on commission events came from the variable incentive
// top-up rather than their commission. Used by the system payroll views and
// by the uploaded payroll views, always on the vendor's whole-period totals.

export const LOW_COMMISSION_SHARE_LIMIT = 0.5;

export type LowCommissionShare = {
  commission: number;
  variableIncentive: number;
  combined: number;
  // Commission Pay / (Commission Pay + Variable Incentive), 0..1.
  share: number;
};

// Compared in cents so float noise never flips a vendor sitting exactly on 50%.
export function getLowCommissionShare(commission: number, variableIncentive: number): LowCommissionShare | null {
  const commissionCents = Math.round((Number.isFinite(commission) ? commission : 0) * 100);
  const incentiveCents = Math.round((Number.isFinite(variableIncentive) ? variableIncentive : 0) * 100);
  const combinedCents = commissionCents + incentiveCents;
  if (combinedCents <= 0) return null;
  if (commissionCents >= combinedCents * LOW_COMMISSION_SHARE_LIMIT) return null;
  return {
    commission: commissionCents / 100,
    variableIncentive: incentiveCents / 100,
    combined: combinedCents / 100,
    share: commissionCents / combinedCents,
  };
}

const money = (v: number) => v.toFixed(2);
const percent = (share: number) => `${Math.floor(Math.max(0, share) * 100)}%`;

export const lowCommissionShareTitle = (flag: LowCommissionShare) =>
  `Commission Pay $${money(flag.commission)} is ${percent(flag.share)} of Commission Pay + Variable Incentive ($${money(flag.combined)}), under 50%. ` +
  `Variable Incentive $${money(flag.variableIncentive)}. Pay-period totals for this vendor.`;

export function LowCommissionShareBadge({ flag, className = "" }: { flag: LowCommissionShare | null | undefined; className?: string }) {
  if (!flag) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 align-middle ${className}`}
      title={lowCommissionShareTitle(flag)}
    >
      <span aria-hidden="true">⚑</span>
      Commission under 50% · {percent(flag.share)}
    </span>
  );
}

// "Pay hourly" switch shown on flagged vendors (and on vendors already switched, so HR can
// switch them back). On = every commission event of this vendor in the loaded period is paid
// hourly; part-way = only some are (e.g. a wider date range was loaded later).
export type HourlyPayToggleInfo = {
  name: string;
  eventCount: number;
  hourlyCount: number;
  rateLabel: string;
};

export function HourlyPayToggle({
  info,
  saving,
  onChange,
  className = "",
}: {
  info: HourlyPayToggleInfo | null | undefined;
  saving: boolean;
  onChange: (enabled: boolean) => void;
  className?: string;
}) {
  if (!info || info.eventCount === 0) return null;
  const on = info.hourlyCount > 0 && info.hourlyCount >= info.eventCount;
  const mixed = info.hourlyCount > 0 && !on;
  const events = `${info.eventCount} commission ${info.eventCount === 1 ? "event" : "events"} loaded for this period`;
  const rules = "California: overtime past 8h a day or 40h a week, double time past 12h a day. Other states: overtime past 40h a week.";
  const title = on
    ? `Paid hourly at ${info.rateLabel} instead of commission on the ${events}. Click to switch back to commission.`
    : mixed
      ? `Paid hourly on ${info.hourlyCount} of the ${events}. Click to pay hourly on all of them. ${rules}`
      : `Pay ${info.name || "this vendor"} hourly at ${info.rateLabel} instead of commission on the ${events}. ${rules}`;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={mixed ? "mixed" : on}
      disabled={saving}
      onClick={() => onChange(!on)}
      title={title}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold align-middle disabled:opacity-50 ${
        on || mixed
          ? "border-green-300 bg-green-50 text-green-800"
          : "border-gray-300 bg-white text-gray-700 hover:border-green-400 hover:text-green-700"
      } ${className}`}
    >
      <span className={`relative inline-block h-3 w-6 shrink-0 rounded-full transition-colors ${on ? "bg-green-600" : mixed ? "bg-green-300" : "bg-gray-300"}`}>
        <span className={`absolute top-0.5 h-2 w-2 rounded-full bg-white transition-all ${on ? "left-3.5" : mixed ? "left-2" : "left-0.5"}`} />
      </span>
      {saving
        ? "Saving…"
        : on
          ? `Paid hourly · ${info.rateLabel}`
          : mixed
            ? `Hourly on ${info.hourlyCount} of ${info.eventCount} events · ${info.rateLabel}`
            : `Pay hourly · ${info.rateLabel}`}
    </button>
  );
}

// One line above the payroll list with how many vendors carry the flag; the
// names (with their commission share) open underneath.
export function LowCommissionShareSummary({ vendors }: { vendors: Array<{ key: string; name: string; flag: LowCommissionShare }> }) {
  const [open, setOpen] = useState(false);
  if (vendors.length === 0) return null;
  const sorted = [...vendors].sort((a, b) => a.flag.share - b.flag.share || a.name.localeCompare(b.name));
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden="true">⚑</span>
        <span>
          <span className="font-semibold">
            {vendors.length} {vendors.length === 1 ? "vendor has" : "vendors have"}
          </span>{" "}
          Commission Pay under 50% of Commission Pay + Variable Incentive this period.
        </span>
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs font-medium text-amber-800 underline hover:text-amber-900">
          {open ? "Hide names" : "Show names"}
        </button>
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {sorted.map((v) => (
            <span
              key={v.key}
              className="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-2 py-0.5 text-xs"
              title={lowCommissionShareTitle(v.flag)}
            >
              <span className="font-medium text-gray-900">{v.name || "(no name)"}</span>
              <span className="text-amber-800">{percent(v.flag.share)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
