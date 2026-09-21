"use client";

import {
  TIMESHEET_TIME_FIELDS,
  formatClock12h,
  type TimesheetEditProposal,
  type TimesheetTimeKey,
  type TimesheetTimes,
} from "@/lib/timesheet-edit-requests";

// Timesheet fields laid out like the timesheet form: shift start and end on the
// first row, then each meal as a start and end pair.
const FORM_ROWS: TimesheetTimeKey[][] = [
  ["firstIn", "lastOut"],
  ["firstMealStart", "lastMealEnd"],
  ["secondMealStart", "secondMealEnd"],
];

const MEAL_KEYS = new Set<TimesheetTimeKey>([
  "firstMealStart",
  "lastMealEnd",
  "secondMealStart",
  "secondMealEnd",
]);

const LABELS = Object.fromEntries(
  TIMESHEET_TIME_FIELDS.map((field) => [field.key, field.label])
) as Record<TimesheetTimeKey, string>;

// The inputs for the times a requester wants on the timesheet. A field that
// differs from the recorded value is highlighted and shows what it was.
export function TimesheetTimesFields({
  value,
  previous,
  onChange,
  disabled,
}: {
  value: TimesheetTimes;
  previous: TimesheetTimes | null;
  onChange: (key: TimesheetTimeKey, next: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      {FORM_ROWS.map((row) => (
        <div key={row.join("-")} className="grid grid-cols-2 gap-3">
          {row.map((key) => {
            const recorded = previous ? previous[key] : "";
            const changed = previous !== null && value[key] !== recorded;
            const inputId = `timesheet-edit-${key}`;
            return (
              <div key={key}>
                <div className="flex items-center justify-between">
                  <label htmlFor={inputId} className="text-xs font-medium text-gray-600">
                    {LABELS[key]}
                  </label>
                  {MEAL_KEYS.has(key) && value[key] && (
                    <button
                      type="button"
                      onClick={() => onChange(key, "")}
                      disabled={disabled}
                      className="text-[11px] font-medium text-gray-400 hover:text-gray-700 disabled:opacity-50"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <input
                  id={inputId}
                  type="time"
                  value={value[key]}
                  disabled={disabled}
                  onChange={(event) => onChange(key, event.target.value)}
                  className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm text-gray-900 outline-none transition focus:ring-2 disabled:bg-gray-50 disabled:text-gray-400 ${
                    changed
                      ? "border-amber-400 bg-amber-50 focus:border-amber-500 focus:ring-amber-100"
                      : "border-gray-300 focus:border-slate-400 focus:ring-slate-200"
                  }`}
                />
                {changed && (
                  <p className="mt-1 text-[11px] text-amber-700">
                    Was {recorded ? formatClock12h(recorded) : "empty"}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Read only table of the times a request asks for, next to what was recorded
// when it was filed. Changed rows are highlighted.
export function TimesheetProposalView({
  proposal,
  compact = false,
}: {
  proposal: TimesheetEditProposal | null;
  compact?: boolean;
}) {
  if (!proposal) return null;

  const rows = TIMESHEET_TIME_FIELDS.filter(
    (field) => proposal.requested[field.key] || proposal.previous?.[field.key]
  );
  if (rows.length === 0) return null;

  const cell = compact ? "px-2 py-1" : "px-3 py-1.5";
  const size = compact ? "text-xs" : "text-sm";
  const hasPrevious = proposal.previous !== null;

  return (
    <div className={size}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Requested times
        </span>
        {proposal.workDate && (
          <span className="text-xs text-gray-500">
            Work day {proposal.workDate.slice(5, 7)}/{proposal.workDate.slice(8, 10)}/
            {proposal.workDate.slice(0, 4)}
          </span>
        )}
      </div>
      <table className="w-full overflow-hidden rounded-xl border border-gray-200 bg-white">
        <thead>
          <tr className="bg-gray-50 text-left text-xs text-gray-500">
            <th className={`${cell} font-semibold`}>Field</th>
            {hasPrevious && <th className={`${cell} font-semibold`}>Current</th>}
            <th className={`${cell} font-semibold`}>Requested</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((field) => {
            const before = proposal.previous ? proposal.previous[field.key] : "";
            const after = proposal.requested[field.key];
            const changed = hasPrevious && before !== after;
            return (
              <tr
                key={field.key}
                className={`border-t border-gray-100 ${changed ? "bg-amber-50" : ""}`}
              >
                <td className={`${cell} text-gray-600`}>{field.label}</td>
                {hasPrevious && (
                  <td className={`${cell} text-gray-700`}>{formatClock12h(before)}</td>
                )}
                <td className={`${cell} ${changed ? "font-semibold text-gray-900" : "text-gray-700"}`}>
                  {formatClock12h(after)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
