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

type MappedRow = {
  id: string;
  user_id: string;
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
  rejection_reason: string;
  rejection_notes: string;
  created_at: string;
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

  // ── Column layout ──────────────────────────────────────────────────────────
  const cols = [
    { header: "Event",          width: 160 },
    { header: "Event Date",     width: 76  },
    { header: "Clock In",       width: 108 },
    { header: "Clock Out",      width: 108 },
    { header: "Reason",         width: 110 },
    { header: "Notes",          width: 166 },
  ];
  const totalColWidth = cols.reduce((s, c) => s + c.width, 0);
  const scale = contentWidth / totalColWidth;
  const sc = cols.map(c => ({ ...c, width: c.width * scale }));

  const drawRow = (
    cells: Array<{ text: string; width: number; align?: "left" | "right" }>,
    opts?: { bold?: boolean; size?: number; bg?: { r: number; g: number; b: number } }
  ) => {
    const size = opts?.size ?? 7.5;
    const rowFont = opts?.bold ? boldFont : font;
    ensureSpace(size + 6);
    let x = leftMargin;

    if (opts?.bg) {
      const totalWidth = cells.reduce((s, c) => s + c.width, 0);
      page.drawRectangle({
        x: leftMargin, y: y - 2, width: totalWidth, height: size + 4,
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
      page.drawText(text, { x: drawX, y, size, font: rowFont, color: rgb(0.1, 0.1, 0.1) });
      x += cell.width;
    }

    y -= size + 5;
  };

  const drawDivider = (thickness = 0.5) => {
    page.drawLine({
      start: { x: leftMargin, y: y + 2 },
      end: { x: pageWidth - rightMargin, y: y + 2 },
      color: rgb(0.82, 0.86, 0.9), thickness,
    });
  };

  // ── Group rows by worker ───────────────────────────────────────────────────
  const byWorker = new Map<string, { name: string; email: string; role: string; division: string; rows: MappedRow[] }>();
  for (const row of rows) {
    if (!byWorker.has(row.user_id)) {
      byWorker.set(row.user_id, {
        name: row.worker_name,
        email: row.worker_email,
        role: row.worker_role,
        division: row.worker_division,
        rows: [],
      });
    }
    byWorker.get(row.user_id)!.rows.push(row);
  }

  for (const worker of byWorker.values()) {
    // Worker section header
    ensureSpace(40);
    page.drawRectangle({
      x: leftMargin, y: y - 2, width: contentWidth, height: 14,
      color: rgb(0.91, 0.94, 0.99),
    });
    page.drawText(worker.name, {
      x: leftMargin + 4, y, size: 9, font: boldFont, color: rgb(0.04, 0.18, 0.48),
    });
    const meta = [worker.email, worker.role, worker.division].filter(Boolean).join("  ·  ");
    if (meta) {
      page.drawText(meta, {
        x: leftMargin + 4 + boldFont.widthOfTextAtSize(worker.name, 9) + 12,
        y, size: 7.5, font, color: rgb(0.4, 0.4, 0.4),
      });
    }
    y -= 16;

    // Column headers
    drawRow(
      sc.map(c => ({ text: c.header, width: c.width })),
      { bold: true, size: 7.5, bg: { r: 0.94, g: 0.96, b: 0.99 } }
    );
    drawDivider(1);

    // Data rows
    for (const r of worker.rows) {
      drawRow([
        { text: r.event_name || "—",               width: sc[0].width },
        { text: fmtDate(r.event_date),              width: sc[1].width },
        { text: fmtDateTime(r.clock_in),            width: sc[2].width },
        { text: fmtDateTime(r.clock_out),           width: sc[3].width },
        { text: r.rejection_reason || "—",          width: sc[4].width },
        { text: r.rejection_notes || "—",           width: sc[5].width },
      ]);
      drawDivider();
    }

    y -= 10;
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

    let query = supabaseAdmin
      .from("attestation_rejections")
      .select(`
        id,
        rejection_reason,
        rejection_notes,
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

    if (from) query = query.gte("created_at", `${from}T00:00:00.000Z`);
    if (to)   query = query.lte("created_at", `${to}T23:59:59.999Z`);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const rejectionRows = (rows || []) as RejectionQueryRow[];

    // Resolve clock-in timestamps (same logic as the main report route)
    const affectedUserIds = Array.from(new Set(rejectionRows.map(r => r.user_id).filter(Boolean)));
    const clockOutTimestamps = rejectionRows
      .map(r => one(r.time_entries)?.timestamp || null)
      .filter((t): t is string => typeof t === "string" && t.length > 0);

    const shiftByClockOutId = new Map<string, { clock_in: string | null; clock_out: string | null }>();

    if (affectedUserIds.length > 0 && clockOutTimestamps.length > 0) {
      const minClockOut = new Date(clockOutTimestamps.reduce((min, cur) => (cur < min ? cur : min)));
      const maxClockOut = clockOutTimestamps.reduce((max, cur) => (cur > max ? cur : max));
      minClockOut.setDate(minClockOut.getDate() - 2);

      const { data: timeEntries, error: teError } = await supabaseAdmin
        .from("time_entries")
        .select("id, user_id, event_id, action, timestamp")
        .in("user_id", affectedUserIds)
        .in("action", ["clock_in", "clock_out"])
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
        for (const entry of userEntries) {
          if (entry.action === "clock_in") { openClockIn = entry; continue; }
          if (entry.action === "clock_out") {
            shiftByClockOutId.set(entry.id, {
              clock_in: openClockIn?.timestamp || null,
              clock_out: entry.timestamp || null,
            });
            openClockIn = null;
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
        worker_name: fullName,
        worker_email: worker?.email || "",
        worker_role: worker?.role || "",
        worker_division: worker?.division || "",
        event_name: event?.event_name || "",
        event_venue: event?.venue || "",
        event_city: event?.city || "",
        event_state: event?.state || "",
        event_date: event?.event_date || "",
        clock_in: shift?.clock_in || null,
        clock_out: shift?.clock_out || clockOutEntry?.timestamp || null,
        rejection_reason: row.rejection_reason,
        rejection_notes: row.rejection_notes || "",
        created_at: row.created_at,
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
