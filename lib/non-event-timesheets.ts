import { addDaysToDateString } from "@/lib/timezones";

export const MAX_NON_EVENT_TIMESHEET_DAYS = 7;

export function normalizeEventEndDate(startDate: string, endDate?: string | null): string {
  if (!startDate) return "";
  if (!endDate || endDate < startDate) return startDate;
  return endDate;
}

export function getMaxNonEventEndDate(startDate: string): string | null {
  if (!startDate) return null;
  return addDaysToDateString(startDate, MAX_NON_EVENT_TIMESHEET_DAYS - 1);
}

export function getInclusiveDateSpanDays(startDate: string, endDate?: string | null): number {
  const normalizedEndDate = normalizeEventEndDate(startDate, endDate);
  if (!startDate || !normalizedEndDate) return 1;

  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${normalizedEndDate}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return 1;
  }

  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}
