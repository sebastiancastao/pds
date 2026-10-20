'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { listTimesheetPayPeriods, type TimesheetPayPeriod } from '@/lib/timesheet-pay-periods';

// Section of /user-management, shown to exec users only (it used to be its own page at
// /event-dashboard, which now redirects here). /api/timesheet-period-events is exec-only.
//
// Timesheet PDFs grouped by pay period. Each period downloads as one ZIP with
// a single pay-period folder holding every event and non-event PDF together,
// in date order (no Events / Non-Events split). Every PDF is the same file the
// event-dashboard Timesheet tab's "Export PDF" button produces
// (/api/events/[id]/timesheet-pdf). Events land in a period by their start
// date, the same way HR payroll groups them.

type PeriodEvent = {
  id: string;
  event_name: string | null;
  venue: string | null;
  city: string | null;
  state: string | null;
  event_date: string;
  end_date: string | null;
  is_non_event: boolean;
  is_active: boolean;
};

type PeriodGroup = TimesheetPayPeriod & {
  key: string;
  events: PeriodEvent[];
  nonEvents: PeriodEvent[];
  // Events and non-events together, by date then name: the order of the ZIP.
  all: PeriodEvent[];
};

type ZipItem = { path: string; event: PeriodEvent };
type ZipOutcome = { zipName: string | null; saved: number; skipped: string[]; failed: string[] };
type ZipProgress = { key: string; label: string; done: number; total: number };
type PdfResult = { bytes: Uint8Array; rowCount: number | null } | { error: string };

const ALL_KEY = 'all';
const ZIP_CONCURRENCY = 4;

function parseIsoDate(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

const formatPayDate = (iso: string) =>
  parseIsoDate(iso).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

const formatMonthDay = (iso: string) =>
  parseIsoDate(iso).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

const formatWeekdayMonthDay = (iso: string) =>
  parseIsoDate(iso).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });

function formatPeriodRange(start: string, end: string) {
  const startYear = start.slice(0, 4);
  const endYear = end.slice(0, 4);
  return `${formatMonthDay(start)}${startYear === endYear ? '' : `, ${startYear}`} – ${formatMonthDay(end)}, ${endYear}`;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const isMultiDay = (event: PeriodEvent) => Boolean(event.end_date && event.end_date > event.event_date);

function venueLabel(event: PeriodEvent) {
  const venue = (event.venue || '').trim();
  const cityState = [(event.city || '').trim(), (event.state || '').trim().toUpperCase()].filter(Boolean).join(', ');
  if (venue && cityState) return `${venue} (${cityState})`;
  return venue || cityState;
}

// Windows rejects these characters and trailing dots or spaces in file names.
function cleanFileNamePart(value: string | null | undefined) {
  return String(value || '')
    .replace(/[\u0000-\u001f\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
}

function pdfFileName(event: PeriodEvent) {
  const dateLabel = isMultiDay(event) ? `${event.event_date} to ${event.end_date}` : event.event_date;
  const parts = [dateLabel, cleanFileNamePart(event.event_name) || 'Untitled', cleanFileNamePart(venueLabel(event))].filter(
    Boolean,
  );
  return `${parts.join(' - ').slice(0, 150).trim()}.pdf`;
}

const periodFolderName = (period: TimesheetPayPeriod) => `Pay ${period.payDate} (${period.start} to ${period.end})`;

const periodZipName = (period: TimesheetPayPeriod) =>
  `Timesheets_Pay_${period.payDate}_${period.start}_to_${period.end}.zip`;

// Windows treats file names case-insensitively, so compare in lower case.
function makeUniquePath(used: Set<string>, path: string) {
  let candidate = path;
  for (let n = 2; used.has(candidate.toLowerCase()); n += 1) {
    candidate = path.replace(/(\.pdf)?$/i, `_${n}$1`);
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

// One folder per pay period; events and non-events sit side by side in it.
function periodZipItems(group: PeriodGroup, used: Set<string>): ZipItem[] {
  const folder = periodFolderName(group);
  return group.all.map((event) => ({
    event,
    path: makeUniquePath(used, `${folder}/${pdfFileName(event)}`),
  }));
}

async function getAccessToken() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function fetchTimesheetPdf(eventId: string): Promise<{ blob: Blob; rowCount: number | null }> {
  let lastError: Error = new Error('Download failed');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/events/${eventId}/timesheet-pdf`, {
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const header = res.headers.get('x-timesheet-row-count');
        const rowCount = header === null || header.trim() === '' ? NaN : Number(header);
        return { blob: await res.blob(), rowCount: Number.isFinite(rowCount) ? rowCount : null };
      }
      const body = await res.json().catch(() => ({}));
      lastError = new Error(body?.error || `The server returned ${res.status}`);
      // Only server errors and timeouts are worth a second try.
      if (res.status < 500) break;
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError;
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function buildTimesheetZip(
  items: ZipItem[],
  options: {
    skipEmpty: boolean;
    shouldCancel: () => boolean;
    onProgress: (done: number, total: number) => void;
  },
): Promise<{ cancelled: true } | { cancelled: false; blob: Blob | null; saved: number; skipped: string[]; failed: string[] }> {
  const { zipSync, strToU8 } = await import('fflate');
  const results: Array<PdfResult | null> = new Array(items.length).fill(null);
  let nextIndex = 0;
  let done = 0;
  options.onProgress(0, items.length);

  const worker = async () => {
    while (nextIndex < items.length && !options.shouldCancel()) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        const { blob, rowCount } = await fetchTimesheetPdf(items[index].event.id);
        results[index] = { bytes: new Uint8Array(await blob.arrayBuffer()), rowCount };
      } catch (err: any) {
        console.error('[TIMESHEET ZIP] Could not download:', items[index].path, err);
        results[index] = { error: err?.message || 'Download failed' };
      } finally {
        done += 1;
        options.onProgress(done, items.length);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(ZIP_CONCURRENCY, items.length) }, worker));
  if (options.shouldCancel()) return { cancelled: true };

  const files: Record<string, Uint8Array> = {};
  const skipped: string[] = [];
  const failed: string[] = [];
  items.forEach((item, index) => {
    const result = results[index];
    if (!result || 'error' in result) {
      failed.push(`${item.path}  (${result && 'error' in result ? result.error : 'not downloaded'})`);
      return;
    }
    if (options.skipEmpty && result.rowCount === 0) {
      skipped.push(item.path);
      return;
    }
    files[item.path] = result.bytes;
  });

  const saved = Object.keys(files).length;
  if (saved === 0) return { cancelled: false, blob: null, saved, skipped, failed };

  if (skipped.length > 0) {
    files['SKIPPED_NO_TIME_ENTRIES.txt'] = strToU8(
      `These timesheets had no time entries, so they are not in this zip:\r\n\r\n${skipped.join('\r\n')}\r\n`,
    );
  }
  if (failed.length > 0) {
    files['MISSING_FILES.txt'] = strToU8(
      `These timesheets could not be downloaded and are not in this zip. Download them again from this page or from the event dashboard:\r\n\r\n${failed.join('\r\n')}\r\n`,
    );
  }

  // PDFs are already compressed, so they are stored as-is.
  const zipped = zipSync(files, { level: 0 });
  return {
    cancelled: false,
    blob: new Blob([zipped as BlobPart], { type: 'application/zip' }),
    saved,
    skipped,
    failed,
  };
}

function describeOutcome(outcome: ZipOutcome) {
  const failedCount = outcome.failed.length;
  const skippedCount = outcome.skipped.length;
  if (!outcome.zipName) {
    if (failedCount === 0) return 'No ZIP was saved because none of these timesheets have time entries yet.';
    return `No ZIP was saved. ${plural(failedCount, 'timesheet')} could not be downloaded${
      skippedCount > 0 ? ` and ${skippedCount} had no time entries` : ''
    }.`;
  }
  const parts = [`Saved ${plural(outcome.saved, 'PDF')} to ${outcome.zipName}.`];
  if (skippedCount > 0) parts.push(`Left out ${skippedCount} with no time entries.`);
  if (failedCount > 0) {
    parts.push(
      `${plural(failedCount, 'timesheet')} could not be downloaded and ${failedCount === 1 ? 'is' : 'are'} listed in MISSING_FILES.txt inside the ZIP.`,
    );
  }
  return parts.join(' ');
}

export default function TimesheetPayPeriodZips() {
  const [periods, setPeriods] = useState<TimesheetPayPeriod[]>([]);
  const [events, setEvents] = useState<PeriodEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [skipEmpty, setSkipEmpty] = useState(true);
  const [progress, setProgress] = useState<ZipProgress | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, ZipOutcome>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const cancelRef = useRef(false);

  const loadEvents = useCallback(async (list: TimesheetPayPeriod[]) => {
    if (list.length === 0) {
      setEvents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      // Periods are newest first: the last one starts earliest.
      const startDate = list[list.length - 1].start;
      const endDate = list[0].end;
      const token = await getAccessToken();
      const res = await fetch(
        `/api/timesheet-period-events?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
        { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `The server returned ${res.status}`);
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch (err: any) {
      setLoadError(err?.message || 'Could not load the events.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const list = listTimesheetPayPeriods();
    setPeriods(list);
    loadEvents(list);
  }, [loadEvents]);

  const groups = useMemo<PeriodGroup[]>(() => {
    const byDateThenName = (a: PeriodEvent, b: PeriodEvent) =>
      a.event_date.localeCompare(b.event_date) ||
      (a.event_name || '').localeCompare(b.event_name || '', undefined, { sensitivity: 'base', numeric: true });
    return periods.map((period) => {
      const inPeriod = events
        .filter((event) => event.event_date >= period.start && event.event_date <= period.end)
        .sort(byDateThenName);
      return {
        ...period,
        key: period.start,
        events: inPeriod.filter((event) => !event.is_non_event),
        nonEvents: inPeriod.filter((event) => event.is_non_event),
        all: inPeriod,
      };
    });
  }, [periods, events]);

  const totalTimesheets = groups.reduce((sum, group) => sum + group.events.length + group.nonEvents.length, 0);

  const runZip = async (key: string, label: string, items: ZipItem[], zipName: string) => {
    if (progress || items.length === 0) return;
    cancelRef.current = false;
    setMessage(null);
    setProgress({ key, label, done: 0, total: items.length });
    try {
      const result = await buildTimesheetZip(items, {
        skipEmpty,
        shouldCancel: () => cancelRef.current,
        onProgress: (done, total) => setProgress({ key, label, done, total }),
      });
      if (result.cancelled) {
        setMessage({ tone: 'info', text: 'Download cancelled. Nothing was saved.' });
        return;
      }
      if (result.blob) saveBlob(result.blob, zipName);
      const outcome: ZipOutcome = {
        zipName: result.blob ? zipName : null,
        saved: result.saved,
        skipped: result.skipped,
        failed: result.failed,
      };
      setOutcomes((prev) => ({ ...prev, [key]: outcome }));
    } catch (err: any) {
      setMessage({ tone: 'error', text: err?.message || 'Could not build the ZIP file.' });
    } finally {
      setProgress(null);
    }
  };

  const downloadPeriod = (group: PeriodGroup) => {
    const items = periodZipItems(group, new Set());
    runZip(group.key, `Pay date ${formatPayDate(group.payDate)}`, items, periodZipName(group));
  };

  const downloadAllPeriods = () => {
    const withEvents = groups.filter((group) => group.events.length + group.nonEvents.length > 0);
    if (withEvents.length === 0) return;
    const used = new Set<string>();
    const items = withEvents.flatMap((group) => periodZipItems(group, used));
    const oldest = withEvents[withEvents.length - 1];
    const newest = withEvents[0];
    runZip(ALL_KEY, 'All pay periods', items, `Timesheets_All_Pay_Periods_${oldest.start}_to_${newest.end}.zip`);
  };

  const downloadOne = async (event: PeriodEvent) => {
    setBusyEventId(event.id);
    setMessage(null);
    try {
      const { blob } = await fetchTimesheetPdf(event.id);
      saveBlob(blob, pdfFileName(event));
    } catch (err: any) {
      setMessage({
        tone: 'error',
        text: `Could not download the timesheet for ${event.event_name || 'this event'}. ${err?.message || ''}`.trim(),
      });
    } finally {
      setBusyEventId(null);
    }
  };

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const busy = progress !== null;
  const downloadButtonClass =
    'inline-flex h-9 items-center justify-center rounded-lg bg-blue-600 px-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';
  const secondaryButtonClass =
    'inline-flex h-9 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50';
  const smallPrimaryClass =
    'inline-flex h-8 items-center justify-center rounded-md bg-blue-600 px-2.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';
  const smallSecondaryClass =
    'inline-flex h-8 items-center justify-center rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50';

  const renderEventList = (title: string, list: PeriodEvent[]) => (
    <div>
      <div className="bg-gray-50 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-gray-700">
        {title} ({list.length})
      </div>
      {list.length === 0 ? (
        <p className="px-5 py-3 text-sm text-gray-500">None in this pay period.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {list.map((event) => {
            const venue = venueLabel(event);
            const dateText = isMultiDay(event)
              ? `${formatWeekdayMonthDay(event.event_date)} – ${formatWeekdayMonthDay(event.end_date as string)}`
              : formatWeekdayMonthDay(event.event_date);
            return (
              <li key={event.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 break-words">
                    {event.event_name || 'Untitled'}
                    {!event.is_active && (
                      <span className="ml-2 rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Inactive</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    {dateText}
                    {venue ? ` · ${venue}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link href={`/event-dashboard/${event.id}`} target="_blank" rel="noreferrer" className={smallSecondaryClass}>
                    Open event
                  </Link>
                  <button
                    type="button"
                    onClick={() => downloadOne(event)}
                    disabled={busyEventId !== null}
                    className={smallPrimaryClass}
                  >
                    {busyEventId === event.id ? 'Downloading...' : 'PDF'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  const allOutcome = outcomes[ALL_KEY];

  return (
    <div>
      <div>
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-gray-600">
              Download every event and non-event timesheet in a pay period as one ZIP. Each pay period is one folder with
              all of its timesheets together, and each PDF is the same file as Export PDF on the event dashboard.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start">
            <button
              type="button"
              onClick={downloadAllPeriods}
              disabled={busy || loading || totalTimesheets === 0}
              title="Every pay period below in one ZIP, one folder per pay period"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
              </svg>
              {progress?.key === ALL_KEY
                ? `Zipping ${progress.done} of ${progress.total}...`
                : 'Download all periods (ZIP)'}
            </button>
          </div>
        </div>

        <div className="mb-6 rounded-lg bg-white px-5 py-4 shadow">
          <label className="flex items-start gap-3 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={skipEmpty}
              onChange={(e) => setSkipEmpty(e.target.checked)}
              disabled={busy}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <span>
              Leave out timesheets with no time entries
              <span className="block text-xs text-gray-500">
                They are listed in SKIPPED_NO_TIME_ENTRIES.txt inside the ZIP instead.
              </span>
            </span>
          </label>
          <p className="mt-3 text-xs text-gray-500">
            Events and non-events land in a pay period by their start date, the same way HR payroll groups them. Pay periods run
            Monday to Sunday for two weeks and are paid the Friday after.
          </p>
        </div>

        {progress && (
          <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-blue-900">
                Building the ZIP for {progress.label}: {progress.done} of {plural(progress.total, 'timesheet')}. Keep this tab open.
              </p>
              <button
                type="button"
                onClick={() => {
                  cancelRef.current = true;
                }}
                className={secondaryButtonClass}
              >
                Cancel
              </button>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-blue-100">
              <div
                className="h-full rounded-full bg-blue-600 transition-all"
                style={{ width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}

        {message && (
          <div
            className={`mb-6 rounded-lg border p-4 text-sm ${
              message.tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-blue-200 bg-blue-50 text-blue-800'
            }`}
          >
            {message.text}
          </div>
        )}

        {allOutcome && (
          <div
            className={`mb-6 rounded-lg border p-4 text-sm ${
              allOutcome.zipName ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}
          >
            All pay periods: {describeOutcome(allOutcome)}
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-lg shadow px-5 py-10 text-center text-gray-500">Loading events...</div>
        ) : loadError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {loadError}{' '}
            <button type="button" onClick={() => loadEvents(periods)} className="font-medium underline">
              Try again
            </button>
          </div>
        ) : groups.length === 0 ? (
          <div className="bg-white rounded-lg shadow px-5 py-10 text-center text-gray-500">No pay periods yet.</div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => {
              const count = group.events.length + group.nonEvents.length;
              const isOpen = expanded.has(group.key);
              const outcome = outcomes[group.key];
              return (
                <div key={group.key} className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-gray-900">Pay date {formatPayDate(group.payDate)}</p>
                        {group.inProgress && (
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            In progress
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">{formatPeriodRange(group.start, group.end)}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {plural(group.events.length, 'event')} · {plural(group.nonEvents.length, 'non-event')}
                      </p>
                      {outcome && (
                        <p className={`mt-1 text-xs ${outcome.zipName ? 'text-green-700' : 'text-amber-700'}`}>
                          {describeOutcome(outcome)}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(group.key)}
                        disabled={count === 0}
                        className={secondaryButtonClass}
                      >
                        {isOpen ? 'Hide list' : 'Show list'}
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadPeriod(group)}
                        disabled={busy || count === 0}
                        className={downloadButtonClass}
                      >
                        {progress?.key === group.key
                          ? `Zipping ${progress.done} of ${progress.total}...`
                          : count === 0
                            ? 'No timesheets'
                            : 'Download ZIP'}
                      </button>
                    </div>
                  </div>
                  {isOpen && count > 0 && (
                    <div className="border-t border-gray-200">
                      {renderEventList('Events', group.events)}
                      {renderEventList('Non-events', group.nonEvents)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
