// app/api/reports/attestation-rejections/pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import { safeDecrypt } from "@/lib/encryption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const ALLOWED_ROLES = ["manager", "supervisor", "supervisor2", "hr", "exec"];

type MaybeArray<T> = T | T[] | null | undefined;

type RejectionQueryRow = {
  id: string;
  rejection_reason: string;
  rejection_notes: string | null;
  signature_data: string | null;
  created_at: string;
  user_id: string;
  event_id: string | null;
  time_entry_id: string;
  time_entries: MaybeArray<{
    id: string;
    user_id: string | null;
    event_id: string | null;
    action: string | null;
    timestamp: string | null;
  }>;
  events: MaybeArray<{
    event_name: string | null;
    venue: string | null;
    city: string | null;
    state: string | null;
    event_date: string | null;
  }>;
  users: MaybeArray<{
    email: string | null;
    role: string | null;
    division: string | null;
    profiles: MaybeArray<{
      first_name: string | null;
      last_name: string | null;
    }>;
  }>;
};

type ShiftData = {
  clock_in: string | null;
  clock_out: string | null;
  meal1_start: string | null;
  meal1_end: string | null;
  meal2_start: string | null;
  meal2_end: string | null;
  meal3_start: string | null;
  meal3_end: string | null;
};

type MappedRow = {
  id: string;
  user_id: string;
  time_entry_id: string;
  worker_name: string;
  worker_email: string;
  worker_role: string;
  worker_division: string;
  event_name: string;
  event_venue: string;
  event_city: string;
  event_state: string;
  event_date: string;
  clock_in: string | null;
  clock_out: string | null;
  meal1_start: string | null;
  meal1_end: string | null;
  meal2_start: string | null;
  meal2_end: string | null;
  meal3_start: string | null;
  meal3_end: string | null;
  total_hours: string;
  rejection_reason: string;
  rejection_notes: string;
  created_at: string;
  signatureData: string | null;
};

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser } = await supabaseAnon.auth.getUser(token);
    if (tokenUser?.user?.id) return tokenUser.user as any;
  }
  return null;
}

function dec(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try { return safeDecrypt(value.trim()); } catch { return value.trim(); }
}

function one<T>(value: MaybeArray<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function parseSignatureDataUrl(value: string): { format: "png" | "jpeg"; bytes: Buffer } | null {
  const match = value.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  const rawFormat = match[1].toLowerCase();
  const normalized = rawFormat === "jpg" ? "jpeg" : rawFormat;
  if (normalized !== "png" && normalized !== "jpeg") return null;
  try { return { format: normalized, bytes: Buffer.from(match[2], "base64") }; } catch { return null; }
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function calcHours(shift: Pick<MappedRow, "clock_in" | "clock_out" | "meal1_start" | "meal1_end" | "meal2_start" | "meal2_end" | "meal3_start" | "meal3_end">): string {
  if (!shift.clock_in || !shift.clock_out) return "—";
  const grossMs = new Date(shift.clock_out).getTime() - new Date(shift.clock_in).getTime();
  if (grossMs <= 0) return "0:00";
  let mealMs = 0;
  const meals = [
    [shift.meal1_start, shift.meal1_end],
    [shift.meal2_start, shift.meal2_end],
    [shift.meal3_start, shift.meal3_end],
  ];
  for (const [s, e] of meals) {
    if (s && e) mealMs += Math.max(new Date(e).getTime() - new Date(s).getTime(), 0);
  }
  const netMs = Math.max(grossMs - mealMs, 0);
  const totalMin = Math.floor(netMs / 60000);
  return `${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, "0")}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

async function buildRejectionsPdf(
  rows: MappedRow[],
  fromDate: string | null,
  toDate: string | null
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

  // ── Document header ────────────────────────────────────────────────────────
  ensureSpace(60);
  page.drawText("Attestation Rejection Report", {
    x: leftMargin, y, size: 18, font: boldFont,
    color: rgb(0.04, 0.18, 0.48),
  });
  y -= 22;

  const subtitle = [
    fromDate && `From: ${fmtDate(fromDate)}`,
    toDate && `To: ${fmtDate(toDate)}`,
    `${rows.length} rejection${rows.length !== 1 ? "s" : ""}`,
  ].filter(Boolean).join("  |  ");

  page.drawText(subtitle, { x: leftMargin, y, size: 10, font, color: rgb(0.25, 0.25, 0.25) });
  y -= 14;

  page.drawText(`Generated: ${new Date().toLocaleString("en-US")}`, {
    x: leftMargin, y, size: 8, font, color: rgb(0.5, 0.5, 0.5),
  });
  y -= 8;

  page.drawLine({
    start: { x: leftMargin, y },
    end: { x: pageWidth - rightMargin, y },
    color: rgb(0.75, 0.8, 0.88), thickness: 1,
  });
  y -= 16;

  // ── Column layout — matches timesheet tab column names exactly ─────────────
  const showThirdMeal = rows.some(r => r.meal3_start || r.meal3_end);

  const cols = [
    { header: "Staff",     width: 108 },
    { header: "Event",     width: 90  },
    { header: "Date",      width: 55  },
    { header: "In",        width: 48  },
    { header: "M1 Start",  width: 42  },
    { header: "M1 End",    width: 42  },
    { header: "M2 Start",  width: 42  },
    { header: "M2 End",    width: 42  },
    ...(showThirdMeal ? [{ header: "M3 Start", width: 42 }, { header: "M3 End", width: 42 }] : []),
    { header: "Out",       width: 48  },
    { header: "Hrs",       width: 30, align: "right" as const },
    { header: "Reason",    width: 90  },
    { header: "Notes",     width: 75  },
  ];
  const totalColWidth = cols.reduce((s, c) => s + c.width, 0);
  const scale = contentWidth / totalColWidth;
  const sc = cols.map(c => ({ ...c, width: c.width * scale }));

  const ROW_SIZE = 7.5;
  const ROW_PAD = 5;

  const drawRow = (
    cells: Array<{ text: string; width: number; align?: "left" | "right" }>,
    opts?: { bold?: boolean; size?: number; bg?: { r: number; g: number; b: number }; textColor?: { r: number; g: number; b: number } }
  ) => {
    const size = opts?.size ?? ROW_SIZE;
    const rowFont = opts?.bold ? boldFont : font;
    const color = opts?.textColor ?? { r: 0.1, g: 0.1, b: 0.1 };
    ensureSpace(size + ROW_PAD + 2);
    let x = leftMargin;

    if (opts?.bg) {
      const totalWidth = cells.reduce((s, c) => s + c.width, 0);
      page.drawRectangle({
        x: leftMargin, y: y - 2, width: totalWidth, height: size + ROW_PAD,
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
      page.drawText(text, { x: drawX, y, size, font: rowFont, color: rgb(color.r, color.g, color.b) });
      x += cell.width;
    }

    y -= size + ROW_PAD;
  };

  const drawDivider = (thickness = 0.5) => {
    page.drawLine({
      start: { x: leftMargin, y: y + 2 },
      end: { x: pageWidth - rightMargin, y: y + 2 },
      color: rgb(0.82, 0.86, 0.9), thickness,
    });
  };

  // ── Table header row (matches timesheet tab header style) ─────────────────
  drawRow(
    sc.map(c => ({ text: c.header.toUpperCase(), width: c.width, align: c.align })),
    { bold: true, size: 7, bg: { r: 0.95, g: 0.96, b: 0.98 }, textColor: { r: 0.25, g: 0.3, b: 0.42 } }
  );
  drawDivider(1);

  // ── Flat table rows (one per rejection, like timesheet tab) ───────────────
  for (const r of rows) {
    ensureSpace(ROW_SIZE + ROW_PAD + 2);

    const nameCell = r.worker_name || "—";
    const roleMeta = [r.worker_role, r.worker_division].filter(Boolean).join(" · ");

    // Staff cell: name on first line, role/division meta in lighter text below
    const staffDisplayText = roleMeta ? `${nameCell} (${roleMeta})` : nameCell;

    const cells: Array<{ text: string; width: number; align?: "left" | "right" }> = [
      { text: staffDisplayText,         width: sc[0].width },
      { text: r.event_name || "—",      width: sc[1].width },
      { text: fmtDate(r.event_date),    width: sc[2].width },
      { text: fmtTime(r.clock_in),      width: sc[3].width },
      { text: fmtTime(r.meal1_start),   width: sc[4].width },
      { text: fmtTime(r.meal1_end),     width: sc[5].width },
      { text: fmtTime(r.meal2_start),   width: sc[6].width },
      { text: fmtTime(r.meal2_end),     width: sc[7].width },
    ];
    let idx = 8;
    if (showThirdMeal) {
      cells.push({ text: fmtTime(r.meal3_start), width: sc[idx].width });
      cells.push({ text: fmtTime(r.meal3_end),   width: sc[idx + 1].width });
      idx += 2;
    }
    cells.push({ text: fmtTime(r.clock_out),       width: sc[idx].width });
    cells.push({ text: r.total_hours,              width: sc[idx + 1].width, align: "right" });
    cells.push({ text: r.rejection_reason || "—",  width: sc[idx + 2].width });
    cells.push({ text: r.rejection_notes  || "—",  width: sc[idx + 3].width });
    drawRow(cells);

    if (r.signatureData) {
      const parsed = parseSignatureDataUrl(r.signatureData);
      if (parsed) {
        try {
          const embedded = parsed.format === "png"
            ? await pdfDoc.embedPng(parsed.bytes)
            : await pdfDoc.embedJpg(parsed.bytes);
          const maxSigWidth = Math.min(220, contentWidth / 2);
          const maxSigHeight = 44;
          const sigScale = Math.min(maxSigWidth / embedded.width, maxSigHeight / embedded.height, 1);
          const drawWidth = embedded.width * sigScale;
          const drawHeight = embedded.height * sigScale;
          ensureSpace(drawHeight + 16);
          page.drawText("Signature:", {
            x: leftMargin + 4, y, size: 7, font, color: rgb(0.35, 0.35, 0.35),
          });
          y -= 9;
          page.drawImage(embedded, {
            x: leftMargin + 4, y: y - drawHeight, width: drawWidth, height: drawHeight,
          });
          y -= drawHeight + 5;
        } catch {
          // skip on image decode failure
        }
      }
    }

    drawDivider();
  }

  // ── Page footers ───────────────────────────────────────────────────────────
  const pageCount = pdfDoc.getPageCount();
  for (let i = 0; i < pageCount; i++) {
    const p = pdfDoc.getPage(i);
    p.drawText(`Page ${i + 1} of ${pageCount}  |  Confidential`, {
      x: leftMargin, y: 18, size: 7, font, color: rgb(0.55, 0.55, 0.55),
    });
  }

  return pdfDoc.save();
}

export async function GET(req: NextRequest) {
  try {
    const authedUser = await getAuthedUser(req);
    if (!authedUser?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", authedUser.id)
      .maybeSingle();

    const role = (userData?.role || "").toLowerCase().trim();
    if (!ALLOWED_ROLES.includes(role)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const userId = searchParams.get("user_id");

    let query = supabaseAdmin
      .from("attestation_rejections")
      .select(`
        id,
        rejection_reason,
        rejection_notes,
        signature_data,
        created_at,
        user_id,
        event_id,
        time_entry_id,
        time_entries ( id, user_id, event_id, action, timestamp ),
        events ( event_name, venue, city, state, event_date ),
        users (
          email,
          role,
          division,
          profiles ( first_name, last_name )
        )
      `)
      .order("created_at", { ascending: false });

    if (from)   query = query.gte("created_at", `${from}T00:00:00.000Z`);
    if (to)     query = query.lte("created_at", `${to}T23:59:59.999Z`);
    if (userId) query = query.eq("user_id", userId);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const rejectionRows = (rows || []) as RejectionQueryRow[];

    // Resolve clock-in timestamps (same logic as the main report route)
    const affectedUserIds = Array.from(new Set(rejectionRows.map(r => r.user_id).filter(Boolean)));
    const clockOutTimestamps = rejectionRows
      .map(r => one(r.time_entries)?.timestamp || null)
      .filter((t): t is string => typeof t === "string" && t.length > 0);

    const shiftByClockOutId = new Map<string, ShiftData>();

    if (affectedUserIds.length > 0 && clockOutTimestamps.length > 0) {
      const minClockOut = new Date(clockOutTimestamps.reduce((min, cur) => (cur < min ? cur : min)));
      const maxClockOut = clockOutTimestamps.reduce((max, cur) => (cur > max ? cur : max));
      minClockOut.setDate(minClockOut.getDate() - 2);

      const { data: timeEntries, error: teError } = await supabaseAdmin
        .from("time_entries")
        .select("id, user_id, event_id, action, timestamp")
        .in("user_id", affectedUserIds)
        .in("action", ["clock_in", "clock_out", "meal_start", "meal_end"])
        .gte("timestamp", minClockOut.toISOString())
        .lte("timestamp", maxClockOut)
        .order("timestamp", { ascending: true });

      if (teError) throw new Error(teError.message);

      const entriesByUser = new Map<string, any[]>();
      for (const entry of timeEntries || []) {
        if (!entry.user_id) continue;
        if (!entriesByUser.has(entry.user_id)) entriesByUser.set(entry.user_id, []);
        entriesByUser.get(entry.user_id)!.push(entry);
      }

      for (const userEntries of entriesByUser.values()) {
        let openClockIn: any = null;
        let meals: Array<{ start: string | null; end: string | null }> = [];
        let currentMealStart: string | null = null;

        for (const entry of userEntries) {
          if (entry.action === "clock_in") {
            openClockIn = entry;
            meals = [];
            currentMealStart = null;
            continue;
          }
          if (entry.action === "meal_start" && openClockIn) {
            currentMealStart = entry.timestamp;
            continue;
          }
          if (entry.action === "meal_end" && openClockIn) {
            meals.push({ start: currentMealStart, end: entry.timestamp });
            currentMealStart = null;
            continue;
          }
          if (entry.action === "clock_out" && openClockIn) {
            if (currentMealStart) { meals.push({ start: currentMealStart, end: null }); currentMealStart = null; }
            shiftByClockOutId.set(entry.id, {
              clock_in:    openClockIn.timestamp || null,
              clock_out:   entry.timestamp || null,
              meal1_start: meals[0]?.start ?? null,
              meal1_end:   meals[0]?.end   ?? null,
              meal2_start: meals[1]?.start ?? null,
              meal2_end:   meals[1]?.end   ?? null,
              meal3_start: meals[2]?.start ?? null,
              meal3_end:   meals[2]?.end   ?? null,
            });
            openClockIn = null;
            meals = [];
          }
        }
      }
    }

    const mapped: MappedRow[] = rejectionRows.map(row => {
      const worker = one(row.users);
      const profile = one(worker?.profiles);
      const event = one(row.events);
      const clockOutEntry = one(row.time_entries);
      const shift = shiftByClockOutId.get(row.time_entry_id);
      const firstName = dec(profile?.first_name);
      const lastName = dec(profile?.last_name);
      const fullName = [firstName, lastName].filter(Boolean).join(" ") || worker?.email || row.user_id;

      return {
        id: row.id,
        user_id: row.user_id,
        time_entry_id: row.time_entry_id,
        worker_name: fullName,
        worker_email: worker?.email || "",
        worker_role: worker?.role || "",
        worker_division: worker?.division || "",
        event_name: event?.event_name || "",
        event_venue: event?.venue || "",
        event_city: event?.city || "",
        event_state: event?.state || "",
        event_date: event?.event_date || "",
        clock_in:    shift?.clock_in    || null,
        clock_out:   shift?.clock_out   || clockOutEntry?.timestamp || null,
        meal1_start: shift?.meal1_start ?? null,
        meal1_end:   shift?.meal1_end   ?? null,
        meal2_start: shift?.meal2_start ?? null,
        meal2_end:   shift?.meal2_end   ?? null,
        meal3_start: shift?.meal3_start ?? null,
        meal3_end:   shift?.meal3_end   ?? null,
        total_hours: calcHours({
          clock_in:    shift?.clock_in    || null,
          clock_out:   shift?.clock_out   || clockOutEntry?.timestamp || null,
          meal1_start: shift?.meal1_start ?? null,
          meal1_end:   shift?.meal1_end   ?? null,
          meal2_start: shift?.meal2_start ?? null,
          meal2_end:   shift?.meal2_end   ?? null,
          meal3_start: shift?.meal3_start ?? null,
          meal3_end:   shift?.meal3_end   ?? null,
        }),
        rejection_reason: row.rejection_reason,
        rejection_notes: row.rejection_notes || "",
        created_at: row.created_at,
        signatureData: row.signature_data ? String(row.signature_data).trim() || null : null,
      };
    });

    const pdfBytes = await buildRejectionsPdf(mapped, from, to);

    const dateSuffix = new Date().toISOString().split("T")[0];
    const filename = `attestation-rejections-${dateSuffix}.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("[attestation-rejections pdf]", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
