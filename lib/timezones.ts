const DEFAULT_TIMEZONE = "America/Los_Angeles";

export const STATE_TIMEZONE_MAP: Record<string, string> = {
  AL: "America/Chicago",
  AK: "America/Anchorage",
  AZ: "America/Phoenix",
  AR: "America/Chicago",
  CA: "America/Los_Angeles",
  CO: "America/Denver",
  CT: "America/New_York",
  DE: "America/New_York",
  FL: "America/New_York",
  GA: "America/New_York",
  HI: "Pacific/Honolulu",
  ID: "America/Denver",
  IL: "America/Chicago",
  IN: "America/Indiana/Indianapolis",
  IA: "America/Chicago",
  KS: "America/Chicago",
  KY: "America/New_York",
  LA: "America/Chicago",
  ME: "America/New_York",
  MD: "America/New_York",
  MA: "America/New_York",
  MI: "America/Detroit",
  MN: "America/Chicago",
  MS: "America/Chicago",
  MO: "America/Chicago",
  MT: "America/Denver",
  NE: "America/Chicago",
  NV: "America/Los_Angeles",
  NH: "America/New_York",
  NJ: "America/New_York",
  NM: "America/Denver",
  NY: "America/New_York",
  NC: "America/New_York",
  ND: "America/Chicago",
  OH: "America/New_York",
  OK: "America/Chicago",
  OR: "America/Los_Angeles",
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  SD: "America/Chicago",
  TN: "America/Chicago",
  TX: "America/Chicago",
  UT: "America/Denver",
  VT: "America/New_York",
  VA: "America/New_York",
  WA: "America/Los_Angeles",
  WV: "America/New_York",
  WI: "America/Chicago",
  WY: "America/Denver",
  DC: "America/New_York",
};

const STATE_NAME_TIMEZONE_MAP: Record<string, string> = {
  ALABAMA: "America/Chicago",
  ALASKA: "America/Anchorage",
  ARIZONA: "America/Phoenix",
  ARKANSAS: "America/Chicago",
  CALIFORNIA: "America/Los_Angeles",
  COLORADO: "America/Denver",
  CONNECTICUT: "America/New_York",
  DELAWARE: "America/New_York",
  FLORIDA: "America/New_York",
  GEORGIA: "America/New_York",
  HAWAII: "Pacific/Honolulu",
  IDAHO: "America/Denver",
  ILLINOIS: "America/Chicago",
  INDIANA: "America/Indiana/Indianapolis",
  IOWA: "America/Chicago",
  KANSAS: "America/Chicago",
  KENTUCKY: "America/New_York",
  LOUISIANA: "America/Chicago",
  MAINE: "America/New_York",
  MARYLAND: "America/New_York",
  MASSACHUSETTS: "America/New_York",
  MICHIGAN: "America/Detroit",
  MINNESOTA: "America/Chicago",
  MISSISSIPPI: "America/Chicago",
  MISSOURI: "America/Chicago",
  MONTANA: "America/Denver",
  NEBRASKA: "America/Chicago",
  NEVADA: "America/Los_Angeles",
  "NEW HAMPSHIRE": "America/New_York",
  "NEW JERSEY": "America/New_York",
  "NEW MEXICO": "America/Denver",
  "NEW YORK": "America/New_York",
  "NORTH CAROLINA": "America/New_York",
  "NORTH DAKOTA": "America/Chicago",
  OHIO: "America/New_York",
  OKLAHOMA: "America/Chicago",
  OREGON: "America/Los_Angeles",
  PENNSYLVANIA: "America/New_York",
  "RHODE ISLAND": "America/New_York",
  "SOUTH CAROLINA": "America/New_York",
  "SOUTH DAKOTA": "America/Chicago",
  TENNESSEE: "America/Chicago",
  TEXAS: "America/Chicago",
  UTAH: "America/Denver",
  VERMONT: "America/New_York",
  VIRGINIA: "America/New_York",
  WASHINGTON: "America/Los_Angeles",
  "WEST VIRGINIA": "America/New_York",
  WISCONSIN: "America/Chicago",
  WYOMING: "America/Denver",
  "DISTRICT OF COLUMBIA": "America/New_York",
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>();

export function getTimezoneForState(state: string | null | undefined): string {
  if (!state) return DEFAULT_TIMEZONE;
  const normalized = state.toUpperCase().trim().replace(/\./g, "").replace(/\s+/g, " ");
  return STATE_TIMEZONE_MAP[normalized] ?? STATE_NAME_TIMEZONE_MAP[normalized] ?? DEFAULT_TIMEZONE;
}

function getOffsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = offsetFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    offsetFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function parseDateParts(dateStr: string) {
  const match = DATE_RE.exec(dateStr);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (![year, month, day].every(Number.isFinite)) return null;
  return { year, month, day };
}

function parseTimeParts(value: string) {
  const match = TIME_RE.exec(value.trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  if (hours === 24 && minutes === 0 && seconds === 0) hours = 0;
  if (hours < 0 || hours > 23) return null;
  if (minutes < 0 || minutes > 59) return null;
  if (seconds < 0 || seconds > 59) return null;
  return { hours, minutes, seconds };
}

export function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const token = getOffsetFormatter(timeZone)
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")
    ?.value;

  if (!token || token === "GMT" || token === "UTC") return 0;

  const match = /^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(token);
  if (!match) {
    throw new Error(`Unsupported time zone offset token: ${token}`);
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || 0);
  return sign * (hours * 60 + minutes);
}

export function addDaysToDateString(dateStr: string, days: number): string | null {
  const parts = parseDateParts(dateStr);
  if (!parts) return null;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function toZonedIso(
  dateStr: string,
  timeValue: string | null | undefined,
  timeZone: string
): string | null {
  const dateParts = parseDateParts(dateStr);
  const timeParts = typeof timeValue === "string" ? parseTimeParts(timeValue) : null;
  if (!dateParts || !timeParts) return null;

  const localMsAsUtc = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hours,
    timeParts.minutes,
    timeParts.seconds,
    0
  );

  let offsetMinutes = getTimeZoneOffsetMinutes(new Date(localMsAsUtc), timeZone);
  let utcMs = localMsAsUtc - offsetMinutes * 60_000;

  for (let i = 0; i < 2; i++) {
    const adjustedOffsetMinutes = getTimeZoneOffsetMinutes(new Date(utcMs), timeZone);
    if (adjustedOffsetMinutes === offsetMinutes) break;
    offsetMinutes = adjustedOffsetMinutes;
    utcMs = localMsAsUtc - offsetMinutes * 60_000;
  }

  return new Date(utcMs).toISOString();
}

export function formatIsoToHHMM(
  isoValue: string | null | undefined,
  timeZone: string
): string {
  if (!isoValue) return "";
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(date);
  const hh = (parts.find((part) => part.type === "hour")?.value || "00").padStart(2, "0");
  const mm = (parts.find((part) => part.type === "minute")?.value || "00").padStart(2, "0");
  return `${hh}:${mm}`;
}

export function getLocalDateRange(
  dateStr: string,
  timeZone: string,
  daySpan = 1
): { startIso: string; endExclusiveIso: string } | null {
  const startIso = toZonedIso(dateStr, "00:00:00", timeZone);
  const endDate = addDaysToDateString(dateStr, daySpan);
  if (!startIso || !endDate) return null;
  const endExclusiveIso = toZonedIso(endDate, "00:00:00", timeZone);
  if (!endExclusiveIso) return null;
  return { startIso, endExclusiveIso };
}
