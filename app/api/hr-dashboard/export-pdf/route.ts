import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { decrypt, isEncrypted } from "@/lib/encryption";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function jsonError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

async function getAuthedUser(req: Request) {
  const supabase = createRouteHandlerClient({ cookies });
  let { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error } = await supabaseAnon.auth.getUser(token);
    if (!error && tokenUser?.user?.id) return tokenUser.user as any;
  }
  return null;
}

function decryptField(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!isEncrypted(trimmed)) return trimmed;
  try { return decrypt(trimmed); } catch { return trimmed; }
}

function formatTime(iso: string | null): string {
  if (!iso) return "--:--";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function formatDate(iso: string | null): string {
  if (!iso) return "--";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function formatDateTime(isoValue: string): string {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return isoValue || "--";
  return date.toLocaleString("en-US", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function msToHoursStr(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

function parseSignatureDataUrl(value: string): { format: "png" | "jpeg"; bytes: Buffer } | null {
  const match = value.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  const rawFormat = match[1].toLowerCase();
  const normalizedFormat = rawFormat === "jpg" ? "jpeg" : rawFormat;
  if (normalizedFormat !== "png" && normalizedFormat !== "jpeg") return null;
  try { return { format: normalizedFormat, bytes: Buffer.from(match[2], "base64") }; } catch { return null; }
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!text.trim()) return [""];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";
  const pushCurrent = () => { if (currentLine) lines.push(currentLine); currentLine = ""; };
  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { currentLine = candidate; continue; }
    if (currentLine) pushCurrent();
    if (font.widthOfTextAtSize(word, size) <= maxWidth) { currentLine = word; continue; }
    let chunk = "";
    for (const char of word) {
      const chunkCandidate = `${chunk}${char}`;
      if (font.widthOfTextAtSize(chunkCandidate, size) <= maxWidth) { chunk = chunkCandidate; } else { if (chunk) lines.push(chunk); chunk = char; }
    }
    currentLine = chunk;
  }
  pushCurrent();
  return lines.length > 0 ? lines : [""];
}

// --- Payroll calculation helpers (mirrored from hr-dashboard/page.tsx) ---

const normalizeState = (s?: string | null) => (s || "").toUpperCase().trim();
const normalizeDivision = (d?: string | null) => (d || "").toString().toLowerCase().trim();
const isTrailersDivision = (d?: string | null) => normalizeDivision(d) === "trailers";
const isVendorDivision = (d?: string | null) => { const div = normalizeDivision(d); return div === "vendor" || div === "both"; };

function getRestBreakAmount(actualHours: number, stateCode: string) {
  const st = normalizeState(stateCode);
  if (st === "NV" || st === "WI" || st === "AZ" || st === "NY") return 0;
  if (actualHours <= 0) return 0;
  return actualHours >= 10 ? 12 : 9;
}

function getEffectiveHours(payment: any): number {
  const actual = Number(payment?.actual_hours ?? payment?.actualHours ?? 0);
  if (actual > 0) return actual;
  const worked = Number(payment?.worked_hours ?? payment?.workedHours ?? 0);
  if (worked > 0) return worked;
  const reg = Number(payment?.regular_hours ?? payment?.regularHours ?? 0);
  const ot = Number(payment?.overtime_hours ?? payment?.overtimeHours ?? 0);
  const dt = Number(payment?.doubletime_hours ?? payment?.doubletimeHours ?? 0);
  const summed = reg + ot + dt;
  return summed > 0 ? summed : 0;
}

function computeAzNyCommissionPerVendor(
  items: Array<{ eligible: boolean; actualHours: number; extAmtRegular: number; isWeeklyOT: boolean }>,
  totalCommissionPool: number
): number {
  const eligibleItems = items.filter((i) => i.eligible && i.actualHours > 0);
  const vendorCount = eligibleItems.length;
  if (vendorCount <= 0) return 0;
  let commissionPerVendor = 0;
  for (let iter = 0; iter < 20; iter++) {
    const sumExtAmtOnRegRate = eligibleItems.reduce((sum, i) => {
      if (!i.isWeeklyOT) return sum + i.extAmtRegular;
      const totalFinalCommissionBase = Math.max(150, i.extAmtRegular + commissionPerVendor);
      return sum + (1.5 * totalFinalCommissionBase);
    }, 0);
    const next = (totalCommissionPool - sumExtAmtOnRegRate) / vendorCount;
    const nextCapped = Math.max(0, next);
    if (Math.abs(nextCapped - commissionPerVendor) < 0.01) { commissionPerVendor = nextCapped; break; }
    commissionPerVendor = nextCapped;
  }
  return commissionPerVendor;
}

// --- Timesheet calculation (from events/[id]/timesheet/route.ts) ---

type TimesheetSpan = {
  firstIn: string | null;
  lastOut: string | null;
  firstMealStart: string | null;
  lastMealEnd: string | null;
  secondMealStart: string | null;
  secondMealEnd: string | null;
};

function computeTimesheetForEvent(
  entries: any[],
  userIds: string[]
): { totals: Record<string, number>; spans: Record<string, TimesheetSpan> } {
  const totals: Record<string, number> = {};
  const spans: Record<string, TimesheetSpan> = {};

  for (const uid of userIds) {
    const userEntries = entries.filter(e => e.user_id === uid);
    totals[uid] = 0;
    spans[uid] = { firstIn: null, lastOut: null, firstMealStart: null, lastMealEnd: null, secondMealStart: null, secondMealEnd: null };

    const clockIns = userEntries.filter(e => e.action === "clock_in");
    const clockOuts = userEntries.filter(e => e.action === "clock_out");
    const mealStarts = userEntries.filter(e => e.action === "meal_start");
    const mealEnds = userEntries.filter(e => e.action === "meal_end");

    if (clockIns.length > 0) spans[uid].firstIn = clockIns[0].timestamp;
    if (clockOuts.length > 0) spans[uid].lastOut = clockOuts[clockOuts.length - 1].timestamp;
    if (mealStarts.length > 0) { spans[uid].firstMealStart = mealStarts[0].timestamp; if (mealStarts.length > 1) spans[uid].secondMealStart = mealStarts[1].timestamp; }
    if (mealEnds.length > 0) { spans[uid].lastMealEnd = mealEnds[0].timestamp; if (mealEnds.length > 1) spans[uid].secondMealEnd = mealEnds[1].timestamp; }

    let currentClockIn: string | null = null;
    const workIntervals: Array<{ start: Date; end: Date }> = [];
    for (const entry of userEntries) {
      if (entry.action === "clock_in") {
        if (!currentClockIn) currentClockIn = entry.timestamp;
      } else if (entry.action === "clock_out") {
        if (currentClockIn) {
          const dur = new Date(entry.timestamp).getTime() - new Date(currentClockIn).getTime();
          if (dur > 0) { totals[uid] += dur; workIntervals.push({ start: new Date(currentClockIn), end: new Date(entry.timestamp) }); }
          currentClockIn = null;
        }
      }
    }

    // Auto-detect meal breaks from gaps
    const hasExplicitMeals = mealStarts.length > 0 || mealEnds.length > 0;
    if (!hasExplicitMeals && workIntervals.length >= 2) {
      workIntervals.sort((a, b) => a.start.getTime() - b.start.getTime());
      const gaps: Array<{ start: Date; end: Date }> = [];
      for (let i = 0; i < workIntervals.length - 1 && gaps.length < 2; i++) {
        const gapStart = workIntervals[i].end;
        const gapEnd = workIntervals[i + 1].start;
        if (gapEnd.getTime() - gapStart.getTime() > 0) gaps.push({ start: gapStart, end: gapEnd });
      }
      if (gaps[0]) { spans[uid].firstMealStart = gaps[0].start.toISOString(); spans[uid].lastMealEnd = gaps[0].end.toISOString(); }
      if (gaps[1]) { spans[uid].secondMealStart = gaps[1].start.toISOString(); spans[uid].secondMealEnd = gaps[1].end.toISOString(); }
    }
  }

  return { totals, spans };
}

// --- Types for processed data ---

type EventExportData = {
  id: string;
  name: string;
  venue: string;
  city: string | null;
  state: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  timesheet: Array<{
    name: string;
    clockIn: string;
    clockOut: string;
    meal1: string;
    meal2: string;
    totalHours: string;
  }>;
  paysheet: Array<{
    name: string;
    email: string;
    regRate: number;
    loadedRate: number;
    hours: number;
    extAmtOnRegRate: number;
    commissionAmt: number;
    totalFinalCommissionAmt: number;
    tips: number;
    restBreak: number;
    other: number;
    totalGrossPay: number;
  }>;
  attestations: Array<{
    name: string;
    signedAt: string;
    isValid: boolean;
    signatureData: string | null;
    signatureType: string | null;
  }>;
  hideRestBreak: boolean;
  eventTotalGross: number;
  eventTotalHours: number;
};

// --- PDF generation ---

async function createPayrollPdf(
  events: EventExportData[],
  startDate: string,
  endDate: string
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const leftMargin = 40;
  const rightMargin = 40;
  const topMargin = 760;
  const bottomMargin = 42;
  const pageWidth = 612;
  const contentWidth = pageWidth - leftMargin - rightMargin;
  const imageCache = new Map<string, PDFImage>();

  let page: PDFPage = pdfDoc.addPage([612, 792]);
  let y = topMargin;

  const startNewPage = () => { page = pdfDoc.addPage([612, 792]); y = topMargin; };
  const ensureSpace = (requiredHeight: number) => { if (y - requiredHeight < bottomMargin) startNewPage(); };

  const drawWrapped = (
    text: string,
    options?: { fontOverride?: PDFFont; size?: number; x?: number; color?: { r: number; g: number; b: number }; lineHeight?: number; maxWidth?: number }
  ) => {
    const currentFont = options?.fontOverride || font;
    const size = options?.size ?? 10;
    const x = options?.x ?? leftMargin;
    const maxWidth = options?.maxWidth ?? pageWidth - x - rightMargin;
    const lineHeight = options?.lineHeight ?? size + 3;
    const color = options?.color ? rgb(options.color.r, options.color.g, options.color.b) : rgb(0.15, 0.15, 0.15);
    const lines = wrapText(text, currentFont, size, maxWidth);
    ensureSpace(lines.length * lineHeight + 2);
    for (const line of lines) {
      page.drawText(line, { x, y, size, font: currentFont, color });
      y -= lineHeight;
    }
  };

  const drawSectionTitle = (title: string) => {
    ensureSpace(24);
    page.drawText(title, { x: leftMargin, y, size: 12, font: boldFont, color: rgb(0.07, 0.07, 0.07) });
    y -= 7;
    page.drawLine({ start: { x: leftMargin, y }, end: { x: pageWidth - rightMargin, y }, color: rgb(0.84, 0.87, 0.9), thickness: 1 });
    y -= 12;
  };

  const drawTableRow = (
    cells: Array<{ text: string; width: number; align?: "left" | "right" }>,
    opts?: { bold?: boolean; size?: number; color?: { r: number; g: number; b: number } }
  ) => {
    const size = opts?.size ?? 7.5;
    const rowFont = opts?.bold ? boldFont : font;
    const color = opts?.color ? rgb(opts.color.r, opts.color.g, opts.color.b) : rgb(0.15, 0.15, 0.15);
    ensureSpace(size + 5);
    let x = leftMargin;
    for (const cell of cells) {
      let displayText = cell.text;
      // Truncate if too wide
      while (displayText.length > 1 && rowFont.widthOfTextAtSize(displayText, size) > cell.width - 2) {
        displayText = displayText.slice(0, -1);
      }
      const textWidth = rowFont.widthOfTextAtSize(displayText, size);
      const drawX = cell.align === "right" ? x + cell.width - textWidth - 1 : x + 1;
      page.drawText(displayText, { x: drawX, y, size, font: rowFont, color });
      x += cell.width;
    }
    y -= size + 3;
  };

  const drawTableLine = () => {
    page.drawLine({ start: { x: leftMargin, y: y + 2 }, end: { x: pageWidth - rightMargin, y: y + 2 }, color: rgb(0.84, 0.87, 0.9), thickness: 0.5 });
  };

  // === TITLE PAGE ===
  drawWrapped("HR Payroll Export", { fontOverride: boldFont, size: 20, color: { r: 0.04, g: 0.18, b: 0.48 } });
  y -= 4;
  if (startDate && endDate) {
    drawWrapped(`Date Range: ${startDate} to ${endDate}`, { size: 11, color: { r: 0.3, g: 0.3, b: 0.3 } });
  }
  drawWrapped(`Generated: ${new Date().toLocaleString("en-US")}`, { size: 10, color: { r: 0.4, g: 0.4, b: 0.4 } });
  y -= 10;

  // Summary
  const totalGross = events.reduce((s, e) => s + e.eventTotalGross, 0);
  const totalHours = events.reduce((s, e) => s + e.eventTotalHours, 0);
  const totalEmployees = new Set(events.flatMap(e => e.paysheet.map(p => p.email))).size;

  drawSectionTitle("Summary");
  drawWrapped(`Events: ${events.length}`, { size: 10 });
  drawWrapped(`Unique Employees: ${totalEmployees}`, { size: 10 });
  drawWrapped(`Total Hours: ${totalHours.toFixed(2)}`, { size: 10 });
  drawWrapped(`Total Gross Pay: $${totalGross.toFixed(2)}`, { size: 10 });

  // === PER EVENT ===
  for (const evt of events) {
    startNewPage();

    // Event Header
    drawWrapped(evt.name || "Unnamed Event", { fontOverride: boldFont, size: 16, color: { r: 0.04, g: 0.18, b: 0.48 } });
    y -= 2;
    drawWrapped(`Venue: ${evt.venue}${evt.city ? `, ${evt.city}` : ""}${evt.state ? `, ${evt.state}` : ""}`, { size: 10 });
    drawWrapped(`Date: ${evt.date || "--"}`, { size: 10 });
    if (evt.startTime || evt.endTime) {
      drawWrapped(`Scheduled: ${evt.startTime || "--"} - ${evt.endTime || "--"}`, { size: 10 });
    }
    y -= 8;

    // --- TIMESHEET ---
    drawSectionTitle("Timesheet");

    if (evt.timesheet.length === 0) {
      drawWrapped("No time entries recorded for this event.", { size: 9, color: { r: 0.5, g: 0.5, b: 0.5 } });
    } else {
      const tsCols = [
        { header: "Employee", width: 110 },
        { header: "Clock In", width: 80 },
        { header: "Clock Out", width: 80 },
        { header: "Meal Break 1", width: 90 },
        { header: "Meal Break 2", width: 90 },
        { header: "Total Hours", width: 82 },
      ];

      // Header row
      drawTableRow(tsCols.map(c => ({ text: c.header, width: c.width })), { bold: true, size: 7.5 });
      drawTableLine();

      for (const row of evt.timesheet) {
        drawTableRow([
          { text: row.name, width: tsCols[0].width },
          { text: row.clockIn, width: tsCols[1].width },
          { text: row.clockOut, width: tsCols[2].width },
          { text: row.meal1, width: tsCols[3].width },
          { text: row.meal2, width: tsCols[4].width },
          { text: row.totalHours, width: tsCols[5].width, align: "right" },
        ]);
      }
    }
    y -= 12;

    // --- PAYSHEET ---
    drawSectionTitle("Paysheet");

    if (evt.paysheet.length === 0) {
      drawWrapped("No payment data for this event.", { size: 9, color: { r: 0.5, g: 0.5, b: 0.5 } });
    } else {
      const psCols: Array<{ header: string; width: number }> = [
        { header: "Employee", width: 95 },
        { header: "Reg Rate", width: 45 },
        { header: "Loaded", width: 45 },
        { header: "Hours", width: 38 },
        { header: "Ext Amt", width: 50 },
        { header: "Comm", width: 45 },
        { header: "Total Final", width: 55 },
        { header: "Tips", width: 40 },
      ];
      if (!evt.hideRestBreak) psCols.push({ header: "Rest Brk", width: 42 });
      psCols.push({ header: "Other", width: 40 });
      psCols.push({ header: "Gross Pay", width: 55 });

      drawTableRow(psCols.map(c => ({ text: c.header, width: c.width })), { bold: true, size: 7.5 });
      drawTableLine();

      let sumGross = 0;
      for (const row of evt.paysheet) {
        const cells: Array<{ text: string; width: number; align?: "left" | "right" }> = [
          { text: row.name, width: psCols[0].width },
          { text: `$${row.regRate.toFixed(2)}`, width: psCols[1].width, align: "right" },
          { text: `$${row.loadedRate.toFixed(2)}`, width: psCols[2].width, align: "right" },
          { text: row.hours.toFixed(2), width: psCols[3].width, align: "right" },
          { text: `$${row.extAmtOnRegRate.toFixed(2)}`, width: psCols[4].width, align: "right" },
          { text: `$${row.commissionAmt.toFixed(2)}`, width: psCols[5].width, align: "right" },
          { text: `$${row.totalFinalCommissionAmt.toFixed(2)}`, width: psCols[6].width, align: "right" },
          { text: `$${row.tips.toFixed(2)}`, width: psCols[7].width, align: "right" },
        ];
        let colIdx = 8;
        if (!evt.hideRestBreak) {
          cells.push({ text: `$${row.restBreak.toFixed(2)}`, width: psCols[colIdx].width, align: "right" });
          colIdx++;
        }
        cells.push({ text: `$${row.other.toFixed(2)}`, width: psCols[colIdx].width, align: "right" });
        colIdx++;
        cells.push({ text: `$${row.totalGrossPay.toFixed(2)}`, width: psCols[colIdx].width, align: "right" });
        sumGross += row.totalGrossPay;
        drawTableRow(cells);
      }

      // Totals row
      drawTableLine();
      const totalCells: Array<{ text: string; width: number; align?: "left" | "right" }> = [
        { text: "TOTAL", width: psCols[0].width },
      ];
      // Fill empties until last column
      for (let i = 1; i < psCols.length - 1; i++) totalCells.push({ text: "", width: psCols[i].width });
      totalCells.push({ text: `$${sumGross.toFixed(2)}`, width: psCols[psCols.length - 1].width, align: "right" });
      drawTableRow(totalCells, { bold: true });
    }
    y -= 12;

    // --- ATTESTATIONS ---
    drawSectionTitle("Attestations");

    if (evt.attestations.length === 0) {
      drawWrapped("No attestations recorded for this event.", { size: 9, color: { r: 0.5, g: 0.5, b: 0.5 } });
    } else {
      for (const att of evt.attestations) {
        drawWrapped(`${att.name}`, { fontOverride: boldFont, size: 9.5 });
        drawWrapped(
          `Signed At: ${att.signedAt} | Valid: ${att.isValid ? "Yes" : "No"}`,
          { size: 8.5, x: leftMargin + 10 }
        );

        const signatureRaw = (att.signatureData || "").trim();
        if (!signatureRaw) {
          drawWrapped("Signature: (missing)", { size: 8.5, x: leftMargin + 10, color: { r: 0.55, g: 0.1, b: 0.1 } });
          y -= 4;
          continue;
        }

        const parsedImage = parseSignatureDataUrl(signatureRaw);
        if (parsedImage) {
          try {
            let embedded = imageCache.get(signatureRaw);
            if (!embedded) {
              embedded = parsedImage.format === "png"
                ? await pdfDoc.embedPng(parsedImage.bytes)
                : await pdfDoc.embedJpg(parsedImage.bytes);
              imageCache.set(signatureRaw, embedded);
            }
            const maxSigWidth = Math.min(200, contentWidth - 24);
            const maxSigHeight = 50;
            const scale = Math.min(maxSigWidth / embedded.width, maxSigHeight / embedded.height, 1);
            const drawWidth = embedded.width * scale;
            const drawHeight = embedded.height * scale;
            ensureSpace(drawHeight + 16);
            page.drawText("Signature:", { x: leftMargin + 10, y, size: 8, font, color: rgb(0.35, 0.35, 0.35) });
            y -= 8;
            page.drawImage(embedded, { x: leftMargin + 10, y: y - drawHeight, width: drawWidth, height: drawHeight });
            y -= drawHeight + 6;
          } catch {
            drawWrapped("Signature (image decode failed)", { size: 8.5, x: leftMargin + 10, color: { r: 0.55, g: 0.1, b: 0.1 } });
            y -= 4;
          }
        } else {
          drawWrapped(`Signature (${att.signatureType || "text"}): ${signatureRaw.slice(0, 80)}`, { size: 8.5, x: leftMargin + 10 });
          y -= 4;
        }
      }
    }
  }

  return pdfDoc.save();
}

// --- Main handler ---

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) return jsonError("Not authenticated", 401);

    const { data: userData } = await supabaseAdmin.from("users").select("role").eq("id", user.id).single();
    const role = (userData?.role || "").toString().trim().toLowerCase();
    if (!["admin", "exec", "hr", "manager"].includes(role)) {
      return jsonError("Unauthorized", 403);
    }

    const { searchParams } = new URL(req.url);
    const eventIdsRaw = searchParams.get("event_ids") || "";
    const startDate = searchParams.get("start_date") || "";
    const endDate = searchParams.get("end_date") || "";
    const eventIds = eventIdsRaw.split(",").map(s => s.trim()).filter(Boolean);

    if (eventIds.length === 0) return jsonError("No event IDs provided", 400);

    // Batch fetch all data in parallel
    const [eventsResult, teamsResult, timeEntriesResult, vendorPaymentsResult, eventPaymentsResult, ratesResult] = await Promise.all([
      supabaseAdmin.from("events")
        .select("id, event_name, venue, city, state, event_date, start_time, end_time, ends_next_day, tips, ticket_sales, tax_rate_percent, commission_pool")
        .in("id", eventIds),
      supabaseAdmin.from("event_teams")
        .select("event_id, vendor_id")
        .in("event_id", eventIds),
      supabaseAdmin.from("time_entries")
        .select("id, user_id, action, timestamp, started_at, event_id")
        .in("event_id", eventIds)
        .order("timestamp", { ascending: true })
        .limit(10000),
      supabaseAdmin.from("vendor_payments")
        .select("*, users(email, division, profiles(first_name, last_name))")
        .in("event_id", eventIds),
      supabaseAdmin.from("event_payments")
        .select("*")
        .in("event_id", eventIds),
      supabaseAdmin.from("rates").select("state_code, base_rate"),
    ]);

    const eventsMap = new Map<string, any>();
    for (const e of eventsResult.data || []) eventsMap.set(e.id, e);

    const teamsByEvent = new Map<string, string[]>();
    for (const t of teamsResult.data || []) {
      if (!teamsByEvent.has(t.event_id)) teamsByEvent.set(t.event_id, []);
      teamsByEvent.get(t.event_id)!.push(t.vendor_id);
    }

    const entriesByEvent = new Map<string, any[]>();
    for (const te of timeEntriesResult.data || []) {
      if (!te.event_id) continue;
      if (!entriesByEvent.has(te.event_id)) entriesByEvent.set(te.event_id, []);
      entriesByEvent.get(te.event_id)!.push(te);
    }

    const vpByEvent = new Map<string, any[]>();
    for (const vp of vendorPaymentsResult.data || []) {
      if (!vp.event_id) continue;
      if (!vpByEvent.has(vp.event_id)) vpByEvent.set(vp.event_id, []);
      vpByEvent.get(vp.event_id)!.push(vp);
    }

    const epByEvent = new Map<string, any>();
    for (const ep of eventPaymentsResult.data || []) {
      if (ep.event_id) epByEvent.set(ep.event_id, ep);
    }

    const configuredRates: Record<string, number> = {};
    for (const row of ratesResult.data || []) {
      const st = normalizeState(row?.state_code);
      const br = Number(row?.base_rate || 0);
      if (st && br > 0) configuredRates[st] = br;
    }
    const getConfiguredBaseRate = (stateCode?: string | null) => {
      const st = normalizeState(stateCode);
      return Number(configuredRates[st] || 0) > 0 ? configuredRates[st] : 17.28;
    };

    // Collect all user IDs for profiles and attestations
    const allUserIds = new Set<string>();
    for (const [, members] of teamsByEvent) for (const uid of members) allUserIds.add(uid);
    for (const [, payments] of vpByEvent) for (const vp of payments) if (vp.user_id) allUserIds.add(vp.user_id);

    // Fetch profiles + attestations
    const userIdArr = Array.from(allUserIds);
    const [profilesResult, attestationsResult, usersResult] = await Promise.all([
      userIdArr.length > 0
        ? supabaseAdmin.from("profiles").select("user_id, first_name, last_name").in("user_id", userIdArr)
        : { data: [] },
      userIdArr.length > 0
        ? supabaseAdmin.from("form_signatures")
            .select("id, user_id, form_id, form_type, signature_data, signature_type, signed_at, ip_address, is_valid")
            .eq("form_type", "clock_out_attestation")
            .in("user_id", userIdArr)
            .order("signed_at", { ascending: false })
            .limit(5000)
        : { data: [] },
      userIdArr.length > 0
        ? supabaseAdmin.from("users").select("id, email").in("id", userIdArr)
        : { data: [] },
    ]);

    const profileMap = new Map<string, { firstName: string; lastName: string }>();
    for (const p of (profilesResult as any).data || []) {
      profileMap.set(p.user_id, {
        firstName: decryptField(p.first_name),
        lastName: decryptField(p.last_name),
      });
    }

    const emailMap = new Map<string, string>();
    for (const u of (usersResult as any).data || []) {
      emailMap.set(u.id, u.email || "");
    }

    const getName = (userId: string): string => {
      const p = profileMap.get(userId);
      return [p?.firstName, p?.lastName].filter(Boolean).join(" ") || "Unknown";
    };

    // Group attestations by user_id
    const attestationsByUser = new Map<string, any[]>();
    for (const att of (attestationsResult as any).data || []) {
      if (!attestationsByUser.has(att.user_id)) attestationsByUser.set(att.user_id, []);
      attestationsByUser.get(att.user_id)!.push(att);
    }

    // Also fetch weekly hours for AZ/NY events
    const azNyEventIds = eventIds.filter(eid => {
      const evt = eventsMap.get(eid);
      const st = normalizeState(evt?.state);
      return st === "AZ" || st === "NY";
    });
    let weeklyHoursMap: Record<string, Record<string, number>> = {};
    if (azNyEventIds.length > 0) {
      // Fetch weekly hours for AZ/NY events from the weekly-hours API-like logic
      // For simplicity, default to 0 (same fallback behavior as main page when API fails)
    }

    // --- Process each event ---
    const exportEvents: EventExportData[] = [];

    for (const eventId of eventIds) {
      const evt = eventsMap.get(eventId);
      if (!evt) continue;

      const eventState = normalizeState(evt.state) || "CA";
      const hideRestBreak = eventState === "NV" || eventState === "WI" || eventState === "AZ" || eventState === "NY";
      const configuredBaseRate = getConfiguredBaseRate(eventState);
      const teamUserIds = teamsByEvent.get(eventId) || [];
      const eventEntries = entriesByEvent.get(eventId) || [];
      const vendorPayments = vpByEvent.get(eventId) || [];
      const eventPaymentSummary = epByEvent.get(eventId) || {};

      // Event financial data
      const eventTips = Number(evt.tips || 0);
      const ticketSales = Number(evt.ticket_sales || 0);
      const totalSales = Math.max(ticketSales - eventTips, 0);
      const taxRate = Number(evt.tax_rate_percent || 0);
      const tax = totalSales * (taxRate / 100);
      const adjustedGrossAmount = Number(eventPaymentSummary.net_sales || 0) || Math.max(totalSales - tax, 0);
      const commissionPoolPercent = Number(eventPaymentSummary.commission_pool_percent || evt.commission_pool || 0) || 0;
      const eventCommissionDollars = Number(eventPaymentSummary.commission_pool_dollars || 0) || (adjustedGrossAmount * commissionPoolPercent);
      const eventTotalTips = Number(eventPaymentSummary.total_tips || 0) || eventTips;

      // --- Timesheet ---
      const allTimesheetUserIds = Array.from(new Set([...teamUserIds, ...vendorPayments.map((vp: any) => vp.user_id).filter(Boolean)]));
      const { totals: tsTotals, spans: tsSpans } = computeTimesheetForEvent(eventEntries, allTimesheetUserIds);

      const timesheetRows = allTimesheetUserIds
        .filter(uid => tsTotals[uid] > 0 || tsSpans[uid]?.firstIn)
        .map(uid => {
          const span = tsSpans[uid] || {} as TimesheetSpan;
          const meal1 = span.firstMealStart && span.lastMealEnd
            ? `${formatTime(span.firstMealStart)} - ${formatTime(span.lastMealEnd)}`
            : "--";
          const meal2 = span.secondMealStart && span.secondMealEnd
            ? `${formatTime(span.secondMealStart)} - ${formatTime(span.secondMealEnd)}`
            : "--";
          return {
            name: getName(uid),
            clockIn: formatTime(span.firstIn),
            clockOut: formatTime(span.lastOut),
            meal1,
            meal2,
            totalHours: msToHoursStr(tsTotals[uid] || 0),
          };
        });

      // --- Paysheet ---
      const isAZorNY = eventState === "AZ" || eventState === "NY";
      const baseRate = configuredBaseRate;
      const memberCount = vendorPayments.length;

      const vendorCountEligible = vendorPayments.reduce((count: number, p: any) => {
        return isVendorDivision(p?.users?.division) ? count + 1 : count;
      }, 0);
      const vendorCountForCommission = vendorCountEligible > 0 ? vendorCountEligible : memberCount;
      const perVendorCommissionShare = vendorCountForCommission > 0 ? eventCommissionDollars / vendorCountForCommission : 0;

      const commissionPerVendorAzNy = isAZorNY
        ? computeAzNyCommissionPerVendor(
            vendorPayments.map((p: any) => {
              const actualHours = getEffectiveHours(p);
              const div = p?.users?.division;
              const eligible = !isTrailersDivision(div) && isVendorDivision(div) && actualHours > 0;
              const priorWeeklyHours = weeklyHoursMap[eventId]?.[p.user_id] || 0;
              const isWeeklyOT = (priorWeeklyHours + actualHours) > 40;
              return { eligible, actualHours, extAmtRegular: actualHours * baseRate, isWeeklyOT };
            }),
            eventCommissionDollars
          )
        : 0;

      const totalTips = eventTotalTips;
      const totalEventHours = vendorPayments.reduce((sum: number, p: any) => sum + getEffectiveHours(p), 0);

      const paysheetRows = vendorPayments.map((payment: any) => {
        const user = payment.users;
        const profile = Array.isArray(user?.profiles) ? user.profiles[0] : user?.profiles;
        const firstName = decryptField(profile?.first_name);
        const lastName = decryptField(profile?.last_name);
        const name = [firstName, lastName].filter(Boolean).join(" ") || "Unknown";
        const email = user?.email || "";
        const adjustmentAmount = Number(payment.adjustment_amount || 0);
        const actualHours = getEffectiveHours(payment);
        const memberDivision = user?.division;
        const isTrailers = isTrailersDivision(memberDivision);
        const priorWeeklyHours = isAZorNY ? (weeklyHoursMap[eventId]?.[payment.user_id] || 0) : 0;
        const isWeeklyOT = isAZorNY && (priorWeeklyHours + actualHours) > 40;
        const extAmtRegular = actualHours * baseRate;
        const extAmtOnRegRateNonAzNy = actualHours * baseRate * 1.5;

        let commissionAmt;
        if (isAZorNY) {
          commissionAmt = (!isTrailers && isVendorDivision(memberDivision) && actualHours > 0) ? commissionPerVendorAzNy : 0;
        } else {
          commissionAmt = (!isTrailers && actualHours > 0 && vendorCountForCommission > 0)
            ? Math.max(0, perVendorCommissionShare - extAmtOnRegRateNonAzNy)
            : 0;
        }

        const totalFinalCommissionBase = (isAZorNY && actualHours > 0) ? Math.max(150, extAmtRegular + commissionAmt) : 0;
        const loadedRateBase = (isAZorNY && actualHours > 0) ? totalFinalCommissionBase / actualHours : baseRate;
        const otRate = (isAZorNY && isWeeklyOT) ? loadedRateBase * 1.5 : 0;

        const extAmtOnRegRate = isAZorNY
          ? (isWeeklyOT ? (otRate * actualHours) : extAmtRegular)
          : extAmtOnRegRateNonAzNy;

        const totalFinalCommissionAmt = actualHours > 0
          ? isAZorNY
            ? (isWeeklyOT ? extAmtOnRegRate : totalFinalCommissionBase)
            : Math.max(150, extAmtOnRegRate + commissionAmt)
          : 0;

        const loadedRate = isAZorNY
          ? loadedRateBase
          : (actualHours > 0 ? totalFinalCommissionAmt / actualHours : baseRate);

        const tips = (totalEventHours > 0 && totalTips > 0) ? totalTips * (actualHours / totalEventHours) : Number(payment.tips || 0);
        const restBreak = getRestBreakAmount(actualHours, eventState);
        const totalPay = totalFinalCommissionAmt + tips + restBreak;
        const finalPay = totalPay + adjustmentAmount;

        return {
          name,
          email,
          regRate: baseRate,
          loadedRate,
          hours: actualHours,
          extAmtOnRegRate,
          commissionAmt,
          totalFinalCommissionAmt,
          tips,
          restBreak,
          other: adjustmentAmount,
          totalGrossPay: finalPay,
        };
      });

      // --- Attestations ---
      const eventDate = (evt.event_date || "").toString().split("T")[0];
      const attestationRows: EventExportData["attestations"] = [];

      for (const uid of allTimesheetUserIds) {
        const userAttestations = attestationsByUser.get(uid) || [];
        // Find attestation matching this event date
        const matched = userAttestations.find((a: any) => {
          if (!a.signed_at || !eventDate) return false;
          const signedDate = a.signed_at.split("T")[0];
          return signedDate === eventDate;
        });

        if (matched) {
          attestationRows.push({
            name: getName(uid),
            signedAt: formatDateTime(matched.signed_at),
            isValid: !!matched.is_valid,
            signatureData: typeof matched.signature_data === "string" ? matched.signature_data : null,
            signatureType: typeof matched.signature_type === "string" ? matched.signature_type : null,
          });
        }
      }

      const eventTotalGross = paysheetRows.reduce((s, r) => s + r.totalGrossPay, 0);
      const eventTotalHrs = paysheetRows.reduce((s, r) => s + r.hours, 0);

      exportEvents.push({
        id: eventId,
        name: evt.event_name || "Unnamed Event",
        venue: evt.venue || "--",
        city: evt.city,
        state: eventState,
        date: evt.event_date || "--",
        startTime: evt.start_time || null,
        endTime: evt.end_time || null,
        timesheet: timesheetRows,
        paysheet: paysheetRows,
        attestations: attestationRows,
        hideRestBreak,
        eventTotalGross,
        eventTotalHours: eventTotalHrs,
      });
    }

    // Sort events by date
    exportEvents.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    const pdfBytes = await createPayrollPdf(exportEvents, startDate, endDate);
    const pdfBuffer = Buffer.from(pdfBytes);

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="payroll-export-${startDate || "start"}-to-${endDate || "end"}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("Error exporting payroll PDF:", err);
    return jsonError(err?.message || "Failed to export PDF", 500);
  }
}
