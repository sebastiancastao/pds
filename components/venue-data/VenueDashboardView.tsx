'use client';

// Presentational venue dashboard: hero figure, stat tiles, trend charts, venue
// ranking and tables. The page owns auth, filters and fetching.

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  DashboardEntry,
  VenueBreakdownRow,
  VenueDashboardData,
  VenueSummary,
} from '@/lib/venue-data';
import { BarRow, ChartCard, HBarChart, LineChart, LinePoint, VD_TOKENS } from './charts';
import {
  fmtCompact,
  fmtDate,
  fmtInt,
  fmtMoney,
  fmtMonth,
  fmtPercent,
} from './format';

export type DashboardPayload = VenueDashboardData & {
  venues: VenueSummary[];
  totalEntries: number;
  truncated: boolean;
};

const cardStyle = { background: 'var(--vd-surface)', border: '1px solid var(--vd-border)' };
const dash = '—';

function StatTile({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <div className="rounded-2xl p-4 sm:p-5" style={cardStyle}>
      <div className="text-sm" style={{ color: 'var(--vd-ink-2)' }}>
        {label}
      </div>
      <div className="mt-1 text-[1.75rem] font-semibold leading-tight" style={{ color: 'var(--vd-ink)' }}>
        {value}
      </div>
      <div className="mt-1 text-xs" style={{ color: 'var(--vd-ink-2)' }}>
        {caption}
      </div>
    </div>
  );
}

const th = 'whitespace-nowrap px-3 py-2 text-left text-xs font-medium';
const td = 'whitespace-nowrap px-3 py-2 text-sm tabular-nums';

function SimpleTable({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <table className="w-full border-collapse">
      <thead className="sticky top-0" style={{ background: 'var(--vd-surface)' }}>
        <tr style={{ borderBottom: '1px solid var(--vd-axis)', color: 'var(--vd-ink-2)' }}>{head}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

type SortKey =
  | 'venueName'
  | 'events'
  | 'attendance'
  | 'grossSales'
  | 'perCap'
  | 'occupancy'
  | 'salesPerStaff'
  | 'lastEventDate';

const VENUE_COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'venueName', label: 'Venue', numeric: false },
  { key: 'events', label: 'Events', numeric: true },
  { key: 'attendance', label: 'Attendance', numeric: true },
  { key: 'grossSales', label: 'Gross sales', numeric: true },
  { key: 'perCap', label: 'Per cap', numeric: true },
  { key: 'occupancy', label: 'Occupancy', numeric: true },
  { key: 'salesPerStaff', label: 'Sales / staff', numeric: true },
  { key: 'lastEventDate', label: 'Last event', numeric: false },
];

function VenueTable({ rows }: { rows: VenueBreakdownRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'grossSales',
    dir: 'desc',
  });

  const sorted = useMemo(() => {
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      // Missing values always sort last, whichever way the column is ordered.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * factor;
      return ((av as number) - (bv as number)) * factor;
    });
  }, [rows, sort]);

  const toggle = (key: SortKey, numeric: boolean) =>
    setSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: numeric ? 'desc' : 'asc' }
    );

  return (
    <div className="overflow-x-auto">
      <SimpleTable
        head={VENUE_COLUMNS.map((c) => (
          <th
            key={c.key}
            className={`${th} ${c.numeric ? 'text-right' : ''}`}
            aria-sort={
              sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
            }
          >
            <button
              type="button"
              onClick={() => toggle(c.key, c.numeric)}
              className="inline-flex items-center gap-1 font-medium hover:underline"
            >
              {c.label}
              <span aria-hidden="true" className="w-2 text-[10px]">
                {sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
              </span>
            </button>
          </th>
        ))}
      >
        {sorted.map((v) => (
          <tr key={v.venueId} style={{ borderBottom: '1px solid var(--vd-grid)' }}>
            <td className={`${td} font-medium`} style={{ color: 'var(--vd-ink)' }}>
              {v.venueName}
              {(v.city || v.state) && (
                <span className="ml-2 text-xs font-normal" style={{ color: 'var(--vd-ink-2)' }}>
                  {[v.city, v.state].filter(Boolean).join(', ')}
                </span>
              )}
            </td>
            <td className={`${td} text-right`}>{fmtInt(v.events)}</td>
            <td className={`${td} text-right`}>{fmtInt(v.attendance)}</td>
            <td className={`${td} text-right`}>{fmtMoney(v.grossSales)}</td>
            <td className={`${td} text-right`}>{v.perCap === null ? dash : fmtMoney(v.perCap, 2)}</td>
            <td className={`${td} text-right`}>{v.occupancy === null ? dash : fmtPercent(v.occupancy)}</td>
            <td className={`${td} text-right`}>
              {v.salesPerStaff === null ? dash : fmtMoney(v.salesPerStaff)}
            </td>
            <td className={td}>{fmtDate(v.lastEventDate)}</td>
          </tr>
        ))}
      </SimpleTable>
    </div>
  );
}

function RecentTable({ rows }: { rows: DashboardEntry[] }) {
  return (
    <div className="overflow-x-auto">
      <SimpleTable
        head={
          <>
            <th className={th}>Date</th>
            <th className={th}>Venue</th>
            <th className={th}>Event</th>
            <th className={`${th} text-right`}>Attendance</th>
            <th className={`${th} text-right`}>Gross sales</th>
            <th className={`${th} text-right`}>Staff</th>
          </>
        }
      >
        {rows.map((r) => (
          <tr key={r.id} style={{ borderBottom: '1px solid var(--vd-grid)' }}>
            <td className={td}>{fmtDate(r.event_date)}</td>
            <td className={`${td} font-medium`} style={{ color: 'var(--vd-ink)' }}>
              {r.venue_name}
            </td>
            <td className={td}>{r.event_name || dash}</td>
            <td className={`${td} text-right`}>{r.attendance === null ? dash : fmtInt(r.attendance)}</td>
            <td className={`${td} text-right`}>
              {r.gross_sales === null ? dash : fmtMoney(r.gross_sales)}
            </td>
            <td className={`${td} text-right`}>{r.staff_count === null ? dash : fmtInt(r.staff_count)}</td>
          </tr>
        ))}
      </SimpleTable>
    </div>
  );
}

function plural(n: number, word: string) {
  return `${fmtInt(n)} ${word}${n === 1 ? '' : 's'}`;
}

export default function VenueDashboardView({
  data,
  loading,
  error,
  onShowAllTime,
  filtered,
}: {
  data: DashboardPayload | null;
  loading: boolean;
  error: string;
  onShowAllTime: () => void;
  /** True when a date range or venue filter is applied. */
  filtered: boolean;
}) {
  const monthlySales = useMemo<LinePoint[]>(
    () =>
      (data?.monthly ?? []).map((m) => ({
        label: fmtMonth(m.month),
        axisLabel: fmtMonth(m.month, 'short'),
        value: m.grossSales,
        detail: plural(m.events, 'event'),
      })),
    [data]
  );
  const monthlyAttendance = useMemo<LinePoint[]>(
    () =>
      (data?.monthly ?? []).map((m) => ({
        label: fmtMonth(m.month),
        axisLabel: fmtMonth(m.month, 'short'),
        value: m.attendance,
        detail: plural(m.events, 'event'),
      })),
    [data]
  );

  const topVenues = useMemo(
    () => (data?.byVenue ?? []).filter((v) => v.grossSales > 0).slice(0, 10),
    [data]
  );
  const venueBars = useMemo<BarRow[]>(
    () =>
      topVenues.map((v) => ({
        id: v.venueId,
        label: v.venueName,
        value: v.grossSales,
        valueLabel: fmtMoney(v.grossSales),
        details: [
          { label: 'Events', value: fmtInt(v.events) },
          { label: 'Attendance', value: fmtInt(v.attendance) },
          { label: 'Per cap', value: v.perCap === null ? dash : fmtMoney(v.perCap, 2) },
        ],
      })),
    [topVenues]
  );

  if (!data) {
    if (error) {
      return (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700" role="alert">
          {error}
        </div>
      );
    }
    return (
      <div className="flex justify-center py-24" aria-busy="true">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
      </div>
    );
  }

  const t = data.totals;

  if (t.events === 0) {
    return (
      <div className="rounded-2xl p-10 text-center" style={cardStyle}>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--vd-ink)' }}>
          {data.totalEntries === 0 ? 'No venue data yet' : 'No venue data matches these filters'}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm" style={{ color: 'var(--vd-ink-2)' }}>
          {data.totalEntries === 0
            ? 'Enter the first venue report and this dashboard will fill in.'
            : `There ${data.totalEntries === 1 ? 'is 1 entry' : `are ${fmtInt(data.totalEntries)} entries`} outside the selected dates.`}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {data.totalEntries > 0 && filtered && (
            <button
              type="button"
              onClick={onShowAllTime}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
            >
              Show all time
            </button>
          )}
          <Link
            href="/venue-data"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Enter venue data
          </Link>
        </div>
      </div>
    );
  }

  const span =
    data.firstEventDate && data.lastEventDate
      ? data.firstEventDate === data.lastEventDate
        ? fmtDate(data.firstEventDate)
        : `${fmtDate(data.firstEventDate)} to ${fmtDate(data.lastEventDate)}`
      : '';

  return (
    <div
      style={VD_TOKENS}
      className={`space-y-6 transition-opacity duration-200 ${loading ? 'opacity-60' : 'opacity-100'}`}
      aria-busy={loading}
    >
      {data.truncated && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
          This range has more entries than the dashboard can total. Narrow the dates to see exact figures.
        </div>
      )}

      {/* Hero figure */}
      <section className="rounded-2xl p-6 sm:p-8" style={cardStyle}>
        <div className="text-sm" style={{ color: 'var(--vd-ink-2)' }}>
          Gross sales
        </div>
        <div className="mt-1 text-5xl font-semibold tracking-tight" style={{ color: 'var(--vd-ink)' }}>
          {fmtMoney(t.grossSales)}
        </div>
        <div className="mt-2 text-sm" style={{ color: 'var(--vd-ink-2)' }}>
          {plural(t.events, 'event')} at {plural(data.venuesReporting, 'venue')}
          {span ? ` · ${span}` : ''}
        </div>
      </section>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <StatTile label="Attendance" value={fmtInt(t.attendance)} caption="Total across events" />
        <StatTile
          label="Per cap"
          value={t.perCap === null ? dash : fmtMoney(t.perCap, 2)}
          caption="Gross sales / attendance"
        />
        <StatTile
          label="Occupancy"
          value={t.occupancy === null ? dash : fmtPercent(t.occupancy)}
          caption="Attendance / capacity"
        />
        <StatTile
          label="Sales per staff"
          value={t.salesPerStaff === null ? dash : fmtMoney(t.salesPerStaff)}
          caption="Gross sales / staff count"
        />
        <StatTile
          label="Staff per event"
          value={t.avgStaff === null ? dash : (Math.round(t.avgStaff * 10) / 10).toLocaleString('en-US')}
          caption="Average staff count"
        />
      </div>

      {/* Trend charts: one measure each, so no dual axis */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Gross sales by month"
          subtitle="Month of the event date"
          chart={
            <LineChart
              points={monthlySales}
              formatValue={(n) => fmtMoney(n)}
              formatAxis={(n) => fmtCompact(n, '$')}
              ariaLabel="Line chart of gross sales by month"
            />
          }
          table={
            <SimpleTable
              head={
                <>
                  <th className={th}>Month</th>
                  <th className={`${th} text-right`}>Events</th>
                  <th className={`${th} text-right`}>Gross sales</th>
                </>
              }
            >
              {data.monthly.map((m) => (
                <tr key={m.month} style={{ borderBottom: '1px solid var(--vd-grid)' }}>
                  <td className={td}>{fmtMonth(m.month)}</td>
                  <td className={`${td} text-right`}>{fmtInt(m.events)}</td>
                  <td className={`${td} text-right`}>{fmtMoney(m.grossSales)}</td>
                </tr>
              ))}
            </SimpleTable>
          }
        />
        <ChartCard
          title="Attendance by month"
          subtitle="Month of the event date"
          chart={
            <LineChart
              points={monthlyAttendance}
              formatValue={(n) => fmtInt(n)}
              formatAxis={(n) => fmtCompact(n)}
              ariaLabel="Line chart of attendance by month"
            />
          }
          table={
            <SimpleTable
              head={
                <>
                  <th className={th}>Month</th>
                  <th className={`${th} text-right`}>Events</th>
                  <th className={`${th} text-right`}>Attendance</th>
                </>
              }
            >
              {data.monthly.map((m) => (
                <tr key={m.month} style={{ borderBottom: '1px solid var(--vd-grid)' }}>
                  <td className={td}>{fmtMonth(m.month)}</td>
                  <td className={`${td} text-right`}>{fmtInt(m.events)}</td>
                  <td className={`${td} text-right`}>{fmtInt(m.attendance)}</td>
                </tr>
              ))}
            </SimpleTable>
          }
        />
      </div>

      {/* Venue ranking */}
      {venueBars.length > 0 && (
        <ChartCard
          title="Gross sales by venue"
          subtitle={
            data.byVenue.length > venueBars.length
              ? `Top ${venueBars.length} of ${data.byVenue.length} venues`
              : `${plural(venueBars.length, 'venue')}`
          }
          chart={<HBarChart rows={venueBars} ariaLabel="Bar chart of gross sales by venue" />}
          table={
            <SimpleTable
              head={
                <>
                  <th className={th}>Venue</th>
                  <th className={`${th} text-right`}>Gross sales</th>
                  <th className={`${th} text-right`}>Events</th>
                  <th className={`${th} text-right`}>Attendance</th>
                  <th className={`${th} text-right`}>Per cap</th>
                </>
              }
            >
              {topVenues.map((v) => (
                <tr key={v.venueId} style={{ borderBottom: '1px solid var(--vd-grid)' }}>
                  <td className={td}>{v.venueName}</td>
                  <td className={`${td} text-right`}>{fmtMoney(v.grossSales)}</td>
                  <td className={`${td} text-right`}>{fmtInt(v.events)}</td>
                  <td className={`${td} text-right`}>{fmtInt(v.attendance)}</td>
                  <td className={`${td} text-right`}>{v.perCap === null ? dash : fmtMoney(v.perCap, 2)}</td>
                </tr>
              ))}
            </SimpleTable>
          }
        />
      )}

      {/* Venue table */}
      <section className="rounded-2xl p-5 sm:p-6" style={cardStyle}>
        <h2 className="text-base font-semibold" style={{ color: 'var(--vd-ink)' }}>
          Venue breakdown
        </h2>
        <p className="mb-3 mt-0.5 text-sm" style={{ color: 'var(--vd-ink-2)' }}>
          Click a column to sort. Per cap, occupancy and sales per staff only use events that reported both values.
        </p>
        <VenueTable rows={data.byVenue} />
      </section>

      {/* Recent entries */}
      <section className="rounded-2xl p-5 sm:p-6" style={cardStyle}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold" style={{ color: 'var(--vd-ink)' }}>
            Latest events
          </h2>
          <Link href="/venue-data" className="text-sm font-medium text-blue-600 hover:text-blue-700">
            Manage entries
          </Link>
        </div>
        <RecentTable rows={data.recent} />
      </section>
    </div>
  );
}
