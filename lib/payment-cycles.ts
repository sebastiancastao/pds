// Pure helpers for generating recurring payment-cycle windows.
// No DB access — used by /api/hr/payment-cycles to materialize cycle instances.

export type CycleFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

export const CYCLE_FREQUENCIES: CycleFrequency[] = [
  'weekly',
  'biweekly',
  'semimonthly',
  'monthly',
];

export interface CycleConfig {
  frequency: CycleFrequency;
  anchor_date: string; // YYYY-MM-DD — first period start
  pay_offset_days: number; // pay_date = end_date + offset
}

export interface CycleWindow {
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  pay_date: string; // YYYY-MM-DD
  frequency: CycleFrequency;
  label: string;
}

const DAY_MS = 86_400_000;
const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const FREQ_LABEL: Record<CycleFrequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  semimonthly: 'Semi-monthly',
  monthly: 'Monthly',
};

// Approximate period length in days — only used to size the generation horizon.
const APPROX_LEN: Record<CycleFrequency, number> = {
  weekly: 7,
  biweekly: 14,
  semimonthly: 16,
  monthly: 31,
};

function parseUTC(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, day || 1));
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

function lastDayOfMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function todayUTC(): Date {
  return parseUTC(fmt(new Date()));
}

/** First window start for the cadence. Monthly/semimonthly snap to day 1 of the anchor month. */
function firstStart(config: CycleConfig): Date {
  const a = parseUTC(config.anchor_date);
  if (config.frequency === 'weekly' || config.frequency === 'biweekly') return a;
  return new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1));
}

function windowEnd(freq: CycleFrequency, start: Date): Date {
  switch (freq) {
    case 'weekly':
      return addDays(start, 6);
    case 'biweekly':
      return addDays(start, 13);
    case 'monthly':
      return new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), lastDayOfMonth(start.getUTCFullYear(), start.getUTCMonth()))
      );
    case 'semimonthly':
    default:
      // First half [1..15] ends on the 15th; second half [16..end] ends on month end.
      return start.getUTCDate() <= 15
        ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 15))
        : new Date(
            Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), lastDayOfMonth(start.getUTCFullYear(), start.getUTCMonth()))
          );
  }
}

function nextStart(freq: CycleFrequency, start: Date): Date {
  switch (freq) {
    case 'weekly':
      return addDays(start, 7);
    case 'biweekly':
      return addDays(start, 14);
    case 'monthly':
      return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    case 'semimonthly':
    default:
      return start.getUTCDate() <= 15
        ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 16))
        : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  }
}

function buildLabel(freq: CycleFrequency, start: Date, end: Date): string {
  const sM = MONTH_ABBR[start.getUTCMonth()];
  const eM = MONTH_ABBR[end.getUTCMonth()];
  const sameMonth =
    start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth();
  const range = sameMonth
    ? `${sM} ${start.getUTCDate()}–${end.getUTCDate()}, ${end.getUTCFullYear()}`
    : `${sM} ${start.getUTCDate()} – ${eM} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
  return `${FREQ_LABEL[freq]} · ${range}`;
}

export interface GenerateOptions {
  forwardCount?: number; // upcoming periods past today (default 6)
  backCount?: number; // recently-ended periods before today (default 2)
  today?: string; // YYYY-MM-DD override (testing)
}

/**
 * Generate a rolling window of pay periods around `today`:
 * `backCount` recently-ended cycles + the current one + `forwardCount` upcoming.
 * Never produces a window starting before the configured anchor.
 */
export function generateCycleWindows(
  config: CycleConfig,
  opts: GenerateOptions = {}
): CycleWindow[] {
  const forwardCount = Math.max(0, opts.forwardCount ?? 6);
  const backCount = Math.max(0, opts.backCount ?? 2);
  const today = opts.today ? parseUTC(opts.today) : todayUTC();
  const offset = Number.isFinite(config.pay_offset_days) ? Math.max(0, config.pay_offset_days) : 0;

  const horizon = addDays(today, forwardCount * APPROX_LEN[config.frequency] + 62);

  const raw: { start: Date; end: Date }[] = [];
  let start = firstStart(config);
  let guard = 0;
  while (guard++ < 1000) {
    const end = windowEnd(config.frequency, start);
    raw.push({ start, end });
    if (start.getTime() > horizon.getTime()) break;
    start = nextStart(config.frequency, start);
  }

  // Anchor the slice on the current (or next upcoming) period.
  let idx = raw.findIndex((w) => w.end.getTime() >= today.getTime());
  if (idx < 0) idx = raw.length - 1;

  const from = Math.max(0, idx - backCount);
  const to = Math.min(raw.length, idx + forwardCount + 1);

  return raw.slice(from, to).map(({ start: s, end: e }) => {
    const payDate = addDays(e, offset);
    return {
      start_date: fmt(s),
      end_date: fmt(e),
      pay_date: fmt(payDate),
      frequency: config.frequency,
      label: buildLabel(config.frequency, s, e),
    };
  });
}
