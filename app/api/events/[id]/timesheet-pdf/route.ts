import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import { safeDecrypt } from "@/lib/encryption";
import { formatIsoToHHMM, getLocalDateRange, getTimezoneForState } from "@/lib/timezones";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const GATE_PHONE_OFFSET_MINUTES = 30;
const GATE_PHONE_OFFSET_MS = GATE_PHONE_OFFSET_MINUTES * 60 * 1000;
const ATTESTATION_TIME_MATCH_WINDOW_MS = 15 * 60 * 1000;

type TimesheetEntry = {
  id: string | null;
  user_id: string;
  action: string;
  timestamp: string;
  started_at: string | null;
  event_id: string | null;
};

type TimesheetSpan = {
  firstIn: string | null;
  lastOut: string | null;
  firstMealStart: string | null;
  lastMealEnd: string | null;
  secondMealStart: string | null;
  secondMealEnd: string | null;
  thirdMealStart: string | null;
  thirdMealEnd: string | null;
  firstInDisplay: string;
  lastOutDisplay: string;
  firstMealStartDisplay: string;
  lastMealEndDisplay: string;
  secondMealStartDisplay: string;
  secondMealEndDisplay: string;
  thirdMealStartDisplay: string;
  thirdMealEndDisplay: string;
};

type TimesheetRow = {
  name: string;
  attestationStatus: string;
  gate?: string;
  clockIn: string;
  meal1Start: string;
  meal1End: string;
  meal2Start: string;
  meal2End: string;
  meal3Start: string;
  meal3End: string;
  clockOut: string;
  hours: string;
};

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id) return user;

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error } = await supabaseAnon.auth.getUser(token);
    if (!error && tokenUser?.user?.id) return tokenUser.user as any;
  }

  return null;
}

function timeToSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + (match[3] ? Number(match[3]) : 0);
}

function isoToLocalHHMM(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  return formatIsoToHHMM(iso, timeZone);
}

function subtractMinutesFromHHMM(hhmm: string, minutes: number): string {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return "";
  const [hh, mm] = hhmm.split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return "";

  const dayMinutes = 24 * 60;
  const totalMinutes = (((hh * 60 + mm - minutes) % dayMinutes) + dayMinutes) % dayMinutes;
  const outHh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const outMm = String(totalMinutes % 60).padStart(2, "0");
  return `${outHh}:${outMm}`;
}

function formatHoursFromMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const totalMinutes = Math.floor(ms / 60000);
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${hh}:${String(mm).padStart(2, "0")}`;
}

function getDisplayedWorkedMs(apiTotalMsValue: number, span?: TimesheetSpan | null, applyOffset = true): number {
  const apiTotalMs = Math.max(Number(apiTotalMsValue || 0), 0);

  const firstInMs = span?.firstIn ? new Date(span.firstIn).getTime() : NaN;
  const lastOutMs = span?.lastOut ? new Date(span.lastOut).getTime() : NaN;
  const meal1Ms =
    span?.firstMealStart && span?.lastMealEnd
      ? Math.max(new Date(span.lastMealEnd).getTime() - new Date(span.firstMealStart).getTime(), 0)
      : 0;
  const meal2Ms =
    span?.secondMealStart && span?.secondMealEnd
      ? Math.max(new Date(span.secondMealEnd).getTime() - new Date(span.secondMealStart).getTime(), 0)
      : 0;
  const meal3Ms =
    span?.thirdMealStart && span?.thirdMealEnd
      ? Math.max(new Date(span.thirdMealEnd).getTime() - new Date(span.thirdMealStart).getTime(), 0)
      : 0;
  const mealMs = meal1Ms + meal2Ms + meal3Ms;

  let spanNetMs = 0;
  if (Number.isFinite(firstInMs) && Number.isFinite(lastOutMs) && lastOutMs > firstInMs) {
    spanNetMs = Math.max(lastOutMs - firstInMs - mealMs, 0);
  }

  let totalMs = 0;
  if (apiTotalMs > 0 && spanNetMs > 0) {
    totalMs = Math.min(apiTotalMs, spanNetMs);
  } else if (spanNetMs > 0) {
    totalMs = spanNetMs;
  } else if (apiTotalMs > 0) {
    totalMs = Math.max(apiTotalMs - mealMs, 0);
  }

  if (applyOffset && totalMs > 0 && span?.firstIn) {
    totalMs += GATE_PHONE_OFFSET_MS;
  }

  return totalMs;
}

function hasTimesheetTabData(span?: TimesheetSpan | null, apiTotalMsValue = 0): boolean {
  if (Math.max(Number(apiTotalMsValue || 0), 0) > 0) return true;
  return Boolean(
    span?.firstIn ||
    span?.lastOut ||
    span?.firstMealStart ||
    span?.lastMealEnd ||
    span?.secondMealStart ||
    span?.secondMealEnd ||
    span?.thirdMealStart ||
    span?.thirdMealEnd
  );
}

async function buildTimesheetPdf(
  eventName: string,
  eventDate: string,
  eventState: string,
  startTime: string | null,
  endTime: string | null,
  rows: TimesheetRow[],
  applyGateOffset: boolean,
  showThirdMeal: boolean,
  totalHours: string
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 792;
  const pageHeight = 612;
  const leftMargin = 32;
  const rightMargin = 32;
  const topMargin = pageHeight - 36;
  const bottomMargin = 36;
  const contentWidth = pageWidth - leftMargin - rightMargin;

  let page: PDFPage = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = topMargin;

  const startNewPage = () => {
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    y = topMargin;
  };

  const ensureSpace = (height: number) => {
    if (y - height < bottomMargin) startNewPage();
  };

  ensureSpace(30);
  page.drawText("TimeSheet", {
    x: leftMargin,
    y,
    size: 18,
    font: boldFont,
    color: rgb(0.04, 0.18, 0.48),
  });
  y -= 22;

  const tzName = getTimezoneForState(eventState) || "America/Los_Angeles";
  const tzAbbr =
    new Date().toLocaleTimeString("en-US", {
      timeZone: tzName,
      timeZoneName: "short",
    }).split(" ").pop() || "";
  const headerLine2 = [eventName, eventDate, startTime && endTime ? `${startTime} - ${endTime} ${tzAbbr}` : ""]
    .filter(Boolean)
    .join("  |  ");

  page.drawText(headerLine2, {
    x: leftMargin,
    y,
    size: 10,
    font,
    color: rgb(0.25, 0.25, 0.25),
  });
  y -= 14;

  page.drawText(`Generated: ${new Date().toLocaleString("en-US")}`, {
    x: leftMargin,
    y,
    size: 8,
    font,
    color: rgb(0.5, 0.5, 0.5),
  });
  y -= 6;

  page.drawLine({
    start: { x: leftMargin, y },
    end: { x: pageWidth - rightMargin, y },
    color: rgb(0.75, 0.8, 0.88),
    thickness: 1,
  });
  y -= 14;

  const cols: Array<{ header: string; width: number; align?: "left" | "right" }> = [
    { header: "Staff", width: 130 },
    { header: "Attestation", width: 72 },
    { header: "Clock In", width: 60 },
    { header: "M1 Start", width: 58 },
    { header: "M1 End", width: 58 },
    { header: "M2 Start", width: 58 },
    { header: "M2 End", width: 58 },
  ];
  if (applyGateOffset) {
    cols.splice(2, 0, { header: "Gate", width: 56 });
  }
  if (showThirdMeal) {
    cols.push({ header: "M3 Start", width: 58 });
    cols.push({ header: "M3 End", width: 58 });
  }
  cols.push({ header: "Clock Out", width: 60 });
  cols.push({ header: "Hrs", width: 48, align: "right" });

  const totalColWidth = cols.reduce((sum, col) => sum + col.width, 0);
  const scale = contentWidth / totalColWidth;
  const scaledCols = cols.map((col) => ({ ...col, width: col.width * scale }));

  const drawRow = (
    cells: Array<{ text: string; width: number; align?: "left" | "right" }>,
    opts?: { bold?: boolean; size?: number; bg?: { r: number; g: number; b: number } }
  ) => {
    const size = opts?.size ?? 8;
    const rowFont = opts?.bold ? boldFont : font;
    ensureSpace(size + 6);
    let x = leftMargin;

    if (opts?.bg) {
      const totalWidth = cells.reduce((sum, cell) => sum + cell.width, 0);
      page.drawRectangle({
        x: leftMargin,
        y: y - 2,
        width: totalWidth,
        height: size + 4,
        color: rgb(opts.bg.r, opts.bg.g, opts.bg.b),
      });
    }

    for (const cell of cells) {
      let text = cell.text;
      while (text.length > 1 && rowFont.widthOfTextAtSize(text, size) > cell.width - 3) {
        text = text.slice(0, -1);
      }
      const textWidth = rowFont.widthOfTextAtSize(text, size);
      const drawX = cell.align === "right" ? x + cell.width - textWidth - 2 : x + 2;
      page.drawText(text, {
        x: drawX,
        y,
        size,
        font: rowFont,
        color: rgb(0.1, 0.1, 0.1),
      });
      x += cell.width;
    }

    y -= size + 5;
  };

  const drawDivider = (thickness = 0.5) => {
    page.drawLine({
      start: { x: leftMargin, y: y + 2 },
      end: { x: pageWidth - rightMargin, y: y + 2 },
      color: rgb(0.82, 0.86, 0.9),
      thickness,
    });
  };

  drawRow(
    scaledCols.map((col) => ({ text: col.header, width: col.width, align: col.align })),
    { bold: true, size: 8, bg: { r: 0.94, g: 0.96, b: 0.99 } }
  );
  drawDivider(1);

  if (rows.length === 0) {
    ensureSpace(20);
    page.drawText("No time entries recorded.", {
      x: leftMargin,
      y,
      size: 9,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
    y -= 14;
  } else {
    for (const row of rows) {
      const cells: Array<{ text: string; width: number; align?: "left" | "right" }> = [
        { text: row.name, width: scaledCols[0].width },
        { text: row.attestationStatus, width: scaledCols[1].width },
      ];
      let idx = 2;
      if (applyGateOffset) {
        cells.push({ text: row.gate || "", width: scaledCols[idx].width });
        idx += 1;
      }
      cells.push({ text: row.clockIn, width: scaledCols[idx].width });
      cells.push({ text: row.meal1Start, width: scaledCols[idx + 1].width });
      cells.push({ text: row.meal1End, width: scaledCols[idx + 2].width });
      cells.push({ text: row.meal2Start, width: scaledCols[idx + 3].width });
      cells.push({ text: row.meal2End, width: scaledCols[idx + 4].width });
      idx += 5;

      if (showThirdMeal) {
        cells.push({ text: row.meal3Start, width: scaledCols[idx].width });
        cells.push({ text: row.meal3End, width: scaledCols[idx + 1].width });
        idx += 2;
      }

      cells.push({ text: row.clockOut, width: scaledCols[idx].width });
      cells.push({ text: row.hours, width: scaledCols[idx + 1].width, align: "right" });

      drawRow(cells, { size: 8 });
      drawDivider();
    }

    y -= 4;
    const totalCells: Array<{ text: string; width: number; align?: "left" | "right" }> = [
      { text: `TOTAL  (${rows.length} staff)`, width: scaledCols[0].width },
    ];
    for (let i = 1; i < scaledCols.length - 1; i++) {
      totalCells.push({ text: "", width: scaledCols[i].width });
    }
    totalCells.push({
      text: totalHours,
      width: scaledCols[scaledCols.length - 1].width,
      align: "right",
    });
    drawRow(totalCells, { bold: true, size: 8, bg: { r: 0.94, g: 0.96, b: 0.99 } });
  }

  const pageCount = pdfDoc.getPageCount();
  for (let i = 0; i < pageCount; i++) {
    const currentPage = pdfDoc.getPage(i);
    currentPage.drawText(`Page ${i + 1} of ${pageCount} | Confidential`, {
      x: leftMargin,
      y: 18,
      size: 7,
      font,
      color: rgb(0.55, 0.55, 0.55),
    });
  }

  return pdfDoc.save();
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: userData, error: userError } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (userError) {
      return NextResponse.json({ error: userError.message }, { status: 500 });
    }

    if ((userData?.role || "").toLowerCase() !== "exec") {
      return NextResponse.json({ error: "Only exec users can export timesheet PDFs" }, { status: 403 });
    }

    const eventId = params.id;
    if (!eventId) {
      return NextResponse.json({ error: "Event ID required" }, { status: 400 });
    }

    const [eventResult, teamResult] = await Promise.all([
      supabaseAdmin
        .from("events")
        .select("id, event_name, event_date, state, start_time, end_time, ends_next_day")
        .eq("id", eventId)
        .maybeSingle(),
      supabaseAdmin
        .from("event_teams")
        .select("vendor_id")
        .eq("event_id", eventId),
    ]);

    if (eventResult.error) {
      return NextResponse.json({ error: eventResult.error.message }, { status: 500 });
    }
    if (teamResult.error) {
      return NextResponse.json({ error: teamResult.error.message }, { status: 500 });
    }

    const event = eventResult.data;
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const date = String(event.event_date || "").split("T")[0];
    const applyGateOffset = date >= "2026-03-03";
    const eventState = String(event.state || "CA").toUpperCase();
    const tz = getTimezoneForState(eventState) || "America/Los_Angeles";
    const teamMembers = teamResult.data || [];
    const allUserIds = Array.from(
      new Set(teamMembers.map((member: any) => String(member?.vendor_id || "").trim()).filter(Boolean))
    );

    if (allUserIds.length === 0) {
      const pdfBytes = await buildTimesheetPdf(
        event.event_name || "Event",
        date,
        eventState,
        event.start_time ? String(event.start_time).slice(0, 5) : null,
        event.end_time ? String(event.end_time).slice(0, 5) : null,
        [],
        applyGateOffset,
        false,
        "0:00"
      );

      return new NextResponse(Buffer.from(pdfBytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="timesheet.pdf"',
          "Cache-Control": "no-store",
        },
      });
    }

    let hasAttestationByUserId = new Map<string, boolean>();
    let latestClockOutByUserId = new Map<
      string,
      { timestampMs: number | null; attestationAccepted: boolean | null }
    >();

    let clockOutRows: any[] | null = null;
    let clockOutError: any = null;
    const clockOutWithAttestationResult = await supabaseAdmin
      .from("time_entries")
      .select("id, user_id, timestamp, attestation_accepted")
      .eq("event_id", eventId)
      .eq("action", "clock_out")
      .in("user_id", allUserIds);

    if (
      clockOutWithAttestationResult.error &&
      String((clockOutWithAttestationResult.error as any)?.code || "").trim() === "42703"
    ) {
      const fallbackClockOutResult = await supabaseAdmin
        .from("time_entries")
        .select("id, user_id, timestamp")
        .eq("event_id", eventId)
        .eq("action", "clock_out")
        .in("user_id", allUserIds);
      clockOutRows = fallbackClockOutResult.data || null;
      clockOutError = fallbackClockOutResult.error || null;
    } else {
      clockOutRows = clockOutWithAttestationResult.data || null;
      clockOutError = clockOutWithAttestationResult.error || null;
    }

    if (clockOutError) {
      return NextResponse.json({ error: clockOutError.message }, { status: 500 });
    }

    const clockOutRowsByUser = new Map<
      string,
      Array<{ formId: string; timestampMs: number | null }>
    >();
    const clockOutMs: number[] = [];

    for (const row of clockOutRows || []) {
      const userId = String((row as any)?.user_id || "").trim();
      const entryId = String((row as any)?.id || "").trim();
      if (!userId || !entryId) continue;

      const parsedMs = Date.parse(String((row as any)?.timestamp || ""));
      const timestampMs = Number.isNaN(parsedMs) ? null : parsedMs;
      const rawAttestationAccepted = (row as any)?.attestation_accepted;
      const attestationAccepted =
        typeof rawAttestationAccepted === "boolean" ? rawAttestationAccepted : null;
      if (timestampMs !== null) clockOutMs.push(timestampMs);

      const existing = clockOutRowsByUser.get(userId) || [];
      existing.push({ formId: `clock-out-${entryId}`, timestampMs });
      clockOutRowsByUser.set(userId, existing);

      const previousLatest = latestClockOutByUserId.get(userId);
      const previousMs = previousLatest?.timestampMs ?? Number.NEGATIVE_INFINITY;
      const currentMs = timestampMs ?? Number.NEGATIVE_INFINITY;
      if (!previousLatest || currentMs >= previousMs) {
        latestClockOutByUserId.set(userId, { timestampMs, attestationAccepted });
      }
    }

    if (clockOutRowsByUser.size > 0) {
      let attestationQuery = supabaseAdmin
        .from("form_signatures")
        .select("user_id, form_id, signed_at")
        .eq("form_type", "clock_out_attestation")
        .in("user_id", allUserIds);

      if (clockOutMs.length > 0) {
        const minMs = Math.min(...clockOutMs) - ATTESTATION_TIME_MATCH_WINDOW_MS;
        const maxMs = Math.max(...clockOutMs) + ATTESTATION_TIME_MATCH_WINDOW_MS;
        attestationQuery = attestationQuery
          .gte("signed_at", new Date(minMs).toISOString())
          .lte("signed_at", new Date(maxMs).toISOString());
      }

      const { data: attestationRows, error: attestationError } = await attestationQuery;
      if (attestationError) {
        return NextResponse.json({ error: attestationError.message }, { status: 500 });
      }

      for (const row of attestationRows || []) {
        const userId = String((row as any)?.user_id || "").trim();
        if (!userId) continue;

        const userClockOutRows = clockOutRowsByUser.get(userId) || [];
        if (userClockOutRows.length === 0) continue;

        const formId = String((row as any)?.form_id || "").trim();
        const signedAtMs = Date.parse(String((row as any)?.signed_at || ""));
        const hasDirectFormMatch = userClockOutRows.some((entry) => entry.formId === formId);
        const hasTimeMatch =
          !Number.isNaN(signedAtMs) &&
          userClockOutRows.some(
            (entry) =>
              entry.timestampMs !== null &&
              Math.abs(entry.timestampMs - signedAtMs) <= ATTESTATION_TIME_MATCH_WINDOW_MS
          );

        if (hasDirectFormMatch || hasTimeMatch) {
          hasAttestationByUserId.set(userId, true);
        }
      }
    }

    const startSec = timeToSeconds(event.start_time);
    const endSec = timeToSeconds(event.end_time);
    const endsNextDay =
      Boolean(event.ends_next_day) ||
      (startSec !== null && endSec !== null && endSec <= startSec);

    const queryRange = getLocalDateRange(date, tz, 2);
    if (!queryRange) {
      return NextResponse.json({ error: "Invalid event date/timezone" }, { status: 400 });
    }
    const { startIso, endExclusiveIso } = queryRange;

    let { data: entries, error: entriesError } = await supabaseAdmin
      .from("time_entries")
      .select("id, user_id, action, timestamp, started_at, event_id")
      .in("user_id", allUserIds)
      .eq("event_id", eventId)
      .gte("timestamp", startIso)
      .lt("timestamp", endExclusiveIso)
      .order("timestamp", { ascending: true });

    if (entriesError) {
      return NextResponse.json({ error: entriesError.message }, { status: 500 });
    }

    if (endsNextDay) {
      const { data: byTimestamp, error: byTimestampError } = await supabaseAdmin
        .from("time_entries")
        .select("id, user_id, action, timestamp, started_at, event_id")
        .in("user_id", allUserIds)
        .or(`event_id.eq.${eventId},event_id.is.null`)
        .gte("timestamp", startIso)
        .lt("timestamp", endExclusiveIso)
        .order("timestamp", { ascending: true });

      if (byTimestampError) {
        return NextResponse.json({ error: byTimestampError.message }, { status: 500 });
      }

      const merged: TimesheetEntry[] = [];
      const seen = new Set<string>();
      for (const row of [...(entries || []), ...(byTimestamp || [])] as TimesheetEntry[]) {
        if (row?.event_id && row.event_id !== eventId) continue;
        const key = row?.id ? `id:${row.id}` : `k:${row.user_id}|${row.action}|${row.timestamp}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(row);
      }
      entries = merged;
    }

    if (!entries || entries.length === 0) {
      const { data: byTimestamp, error: byTimestampError } = await supabaseAdmin
        .from("time_entries")
        .select("id, user_id, action, timestamp, started_at, event_id")
        .in("user_id", allUserIds)
        .or(`event_id.eq.${eventId},event_id.is.null`)
        .gte("timestamp", startIso)
        .lt("timestamp", endExclusiveIso)
        .order("timestamp", { ascending: true });

      if (byTimestampError) {
        return NextResponse.json({ error: byTimestampError.message }, { status: 500 });
      }

      entries = byTimestamp || [];
    }

    if (!entries || entries.length === 0) {
      const { data: byStartedAt, error: byStartedAtError } = await supabaseAdmin
        .from("time_entries")
        .select("id, user_id, action, timestamp, started_at, event_id")
        .in("user_id", allUserIds)
        .or(`event_id.eq.${eventId},event_id.is.null`)
        .gte("started_at", startIso)
        .lt("started_at", endExclusiveIso)
        .order("started_at", { ascending: true });

      if (byStartedAtError) {
        return NextResponse.json({ error: byStartedAtError.message }, { status: 500 });
      }

      entries = byStartedAt || [];
    }

    const { data: profileRows, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("user_id, first_name, last_name")
      .in("user_id", allUserIds);

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    const profileMap = new Map<string, { firstName: string; lastName: string }>();
    for (const profile of profileRows || []) {
      profileMap.set(profile.user_id, {
        firstName: safeDecrypt(profile.first_name) || profile.first_name || "",
        lastName: safeDecrypt(profile.last_name) || profile.last_name || "",
      });
    }

    const entriesByUser: Record<string, TimesheetEntry[]> = {};
    for (const uid of allUserIds) {
      entriesByUser[uid] = [];
    }
    for (const entry of (entries || []) as TimesheetEntry[]) {
      if (entriesByUser[entry.user_id]) {
        entriesByUser[entry.user_id].push(entry);
      }
    }

    const totals: Record<string, number> = {};
    const spans: Record<string, TimesheetSpan> = {};

    for (const uid of allUserIds) {
      const userEntries = entriesByUser[uid] || [];
      const clockIns = userEntries.filter((entry) => entry.action === "clock_in");
      const clockOuts = userEntries.filter((entry) => entry.action === "clock_out");
      const mealStarts = userEntries.filter((entry) => entry.action === "meal_start");
      const mealEnds = userEntries.filter((entry) => entry.action === "meal_end");

      totals[uid] = 0;
      const span: TimesheetSpan = {
        firstIn: null,
        lastOut: null,
        firstMealStart: null,
        lastMealEnd: null,
        secondMealStart: null,
        secondMealEnd: null,
        thirdMealStart: null,
        thirdMealEnd: null,
        firstInDisplay: "",
        lastOutDisplay: "",
        firstMealStartDisplay: "",
        lastMealEndDisplay: "",
        secondMealStartDisplay: "",
        secondMealEndDisplay: "",
        thirdMealStartDisplay: "",
        thirdMealEndDisplay: "",
      };

      if (clockIns.length > 0) {
        span.firstIn = clockIns[0].timestamp;
        span.firstInDisplay = formatIsoToHHMM(clockIns[0].timestamp, tz);
      }
      if (clockOuts.length > 0) {
        span.lastOut = clockOuts[clockOuts.length - 1].timestamp;
        span.lastOutDisplay = formatIsoToHHMM(clockOuts[clockOuts.length - 1].timestamp, tz);
      }
      if (mealStarts.length > 0) {
        span.firstMealStart = mealStarts[0].timestamp;
        span.firstMealStartDisplay = formatIsoToHHMM(mealStarts[0].timestamp, tz);
        if (mealStarts.length > 1) {
          span.secondMealStart = mealStarts[1].timestamp;
          span.secondMealStartDisplay = formatIsoToHHMM(mealStarts[1].timestamp, tz);
        }
        if (mealStarts.length > 2) {
          span.thirdMealStart = mealStarts[2].timestamp;
          span.thirdMealStartDisplay = formatIsoToHHMM(mealStarts[2].timestamp, tz);
        }
      }
      if (mealEnds.length > 0) {
        span.lastMealEnd = mealEnds[0].timestamp;
        span.lastMealEndDisplay = formatIsoToHHMM(mealEnds[0].timestamp, tz);
        if (mealEnds.length > 1) {
          span.secondMealEnd = mealEnds[1].timestamp;
          span.secondMealEndDisplay = formatIsoToHHMM(mealEnds[1].timestamp, tz);
        }
        if (mealEnds.length > 2) {
          span.thirdMealEnd = mealEnds[2].timestamp;
          span.thirdMealEndDisplay = formatIsoToHHMM(mealEnds[2].timestamp, tz);
        }
      }

      let currentClockIn: string | null = null;
      const workIntervals: Array<{ start: Date; end: Date }> = [];

      for (const entry of userEntries) {
        if (entry.action === "clock_in") {
          if (!currentClockIn) {
            currentClockIn = entry.timestamp;
          }
        } else if (entry.action === "clock_out" && currentClockIn) {
          const startMs = new Date(currentClockIn).getTime();
          const endMs = new Date(entry.timestamp).getTime();
          const duration = endMs - startMs;

          if (duration > 0) {
            totals[uid] += duration;
            workIntervals.push({
              start: new Date(currentClockIn),
              end: new Date(entry.timestamp),
            });
          }

          currentClockIn = null;
        }
      }

      const hasExplicitMeals = mealStarts.length > 0 || mealEnds.length > 0;
      if (!hasExplicitMeals && workIntervals.length >= 2) {
        workIntervals.sort((a, b) => a.start.getTime() - b.start.getTime());
        const gaps: Array<{ start: Date; end: Date }> = [];

        for (let i = 0; i < workIntervals.length - 1; i++) {
          const gapStart = workIntervals[i].end;
          const gapEnd = workIntervals[i + 1].start;
          const gapMs = gapEnd.getTime() - gapStart.getTime();
          if (gapMs > 0) {
            gaps.push({ start: gapStart, end: gapEnd });
          }
          if (gaps.length >= 3) break;
        }

        if (gaps[0]) {
          span.firstMealStart = gaps[0].start.toISOString();
          span.lastMealEnd = gaps[0].end.toISOString();
          span.firstMealStartDisplay = formatIsoToHHMM(gaps[0].start.toISOString(), tz);
          span.lastMealEndDisplay = formatIsoToHHMM(gaps[0].end.toISOString(), tz);
        }
        if (gaps[1]) {
          span.secondMealStart = gaps[1].start.toISOString();
          span.secondMealEnd = gaps[1].end.toISOString();
          span.secondMealStartDisplay = formatIsoToHHMM(gaps[1].start.toISOString(), tz);
          span.secondMealEndDisplay = formatIsoToHHMM(gaps[1].end.toISOString(), tz);
        }
        if (gaps[2]) {
          span.thirdMealStart = gaps[2].start.toISOString();
          span.thirdMealEnd = gaps[2].end.toISOString();
          span.thirdMealStartDisplay = formatIsoToHHMM(gaps[2].start.toISOString(), tz);
          span.thirdMealEndDisplay = formatIsoToHHMM(gaps[2].end.toISOString(), tz);
        }
      }

      spans[uid] = span;
    }

    const sortedTeamMembers = [...teamMembers].sort((a: any, b: any) => {
      const aProfile = profileMap.get(String(a?.vendor_id || "").trim());
      const bProfile = profileMap.get(String(b?.vendor_id || "").trim());
      const aLast = (aProfile?.lastName || "").toLowerCase();
      const bLast = (bProfile?.lastName || "").toLowerCase();
      if (aLast !== bLast) return aLast.localeCompare(bLast, undefined, { sensitivity: "base", numeric: true });
      const aFirst = (aProfile?.firstName || "").toLowerCase();
      const bFirst = (bProfile?.firstName || "").toLowerCase();
      if (aFirst !== bFirst) return aFirst.localeCompare(bFirst, undefined, { sensitivity: "base", numeric: true });
      return String(a?.vendor_id || "").localeCompare(String(b?.vendor_id || ""), undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });

    const rows: TimesheetRow[] = sortedTeamMembers
      .filter((member: any) => {
        const uid = String(member?.vendor_id || "").trim();
        return hasTimesheetTabData(spans[uid], totals[uid]);
      })
      .map((member: any) => {
        const uid = String(member?.vendor_id || "").trim();
        const profile = profileMap.get(uid);
        const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim() || "Unknown";
        const span = spans[uid];

        const firstClockIn = span.firstInDisplay || isoToLocalHHMM(span.firstIn, tz);
        const lastClockOut = span.lastOutDisplay || isoToLocalHHMM(span.lastOut, tz);
        const firstMealStart = span.firstMealStartDisplay || isoToLocalHHMM(span.firstMealStart, tz);
        const lastMealEnd = span.lastMealEndDisplay || isoToLocalHHMM(span.lastMealEnd, tz);
        const secondMealStart = span.secondMealStartDisplay || isoToLocalHHMM(span.secondMealStart, tz);
        const secondMealEnd = span.secondMealEndDisplay || isoToLocalHHMM(span.secondMealEnd, tz);
        const thirdMealStart = span.thirdMealStartDisplay || isoToLocalHHMM(span.thirdMealStart, tz);
        const thirdMealEnd = span.thirdMealEndDisplay || isoToLocalHHMM(span.thirdMealEnd, tz);
        const displayedWorkedMs = getDisplayedWorkedMs(totals[uid], span, applyGateOffset);

        const latestClockOut = latestClockOutByUserId.get(uid);
        const attestationStatusRaw =
          latestClockOut?.attestationAccepted === false
            ? "rejected"
            : hasAttestationByUserId.get(uid)
              ? "submitted"
              : "not_submitted";
        const hasAttestation = attestationStatusRaw === "submitted";
        const isRejected = attestationStatusRaw === "rejected";
        const attestationStatus = hasAttestation ? "Submitted" : isRejected ? "Rejected" : "Not submitted";

        return {
          name,
          attestationStatus,
          gate: applyGateOffset ? subtractMinutesFromHHMM(firstClockIn, GATE_PHONE_OFFSET_MINUTES) : firstClockIn,
          clockIn: firstClockIn,
          meal1Start: firstMealStart,
          meal1End: lastMealEnd,
          meal2Start: secondMealStart,
          meal2End: secondMealEnd,
          meal3Start: thirdMealStart,
          meal3End: thirdMealEnd,
          clockOut: lastClockOut,
          hours: formatHoursFromMs(displayedWorkedMs),
        };
      });

    const showThirdMeal = Object.values(spans).some(
      (span) => span.thirdMealStart || span.thirdMealEnd
    );
    const totalMs = allUserIds.reduce(
      (sum, uid) => sum + getDisplayedWorkedMs(totals[uid], spans[uid], applyGateOffset),
      0
    );
    const totalHours = formatHoursFromMs(totalMs);

    const pdfBytes = await buildTimesheetPdf(
      event.event_name || "Event",
      date,
      eventState,
      event.start_time ? String(event.start_time).slice(0, 5) : null,
      event.end_time ? String(event.end_time).slice(0, 5) : null,
      rows,
      applyGateOffset,
      showThirdMeal,
      totalHours
    );

    const safeName = (event.event_name || "timesheet").replace(/[^a-z0-9]/gi, "-").toLowerCase();
    const dateStr = date || "event-date";

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="timesheet-${safeName}-${dateStr}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("Timesheet PDF error:", err);
    return NextResponse.json({ error: err?.message || "Failed to generate PDF" }, { status: 500 });
  }
}
