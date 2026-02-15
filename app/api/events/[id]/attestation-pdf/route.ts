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
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error } = await supabaseAnon.auth.getUser(token);
    if (!error && tokenUser?.user?.id) return tokenUser.user as any;
  }
  return null;
}

function decryptName(value: unknown, uid: string): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!isEncrypted(trimmed)) return trimmed;
  try { return decrypt(trimmed); } catch { return ""; }
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "--";
  return d.toLocaleString("en-US", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "--";
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function parseSignatureDataUrl(value: string): { format: "png" | "jpeg"; bytes: Buffer } | null {
  const match = value.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  const fmt = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
  if (fmt !== "png" && fmt !== "jpeg") return null;
  try { return { format: fmt as "png" | "jpeg", bytes: Buffer.from(match[2], "base64") }; }
  catch { return null; }
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!text.trim()) return [""];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { cur = candidate; continue; }
    if (cur) lines.push(cur);
    cur = word;
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : [""];
}

/**
 * GET /api/events/[id]/attestation-pdf?userId=<uuid>
 *
 * Downloads a single vendor's clock-out attestation PDF for a specific event.
 * Exec role only.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) return jsonError("Not authenticated", 401);

    // Exec-only
    const { data: userData } = await supabaseAdmin.from("users").select("role").eq("id", user.id).single();
    const role = (userData?.role || "").toString().trim().toLowerCase();
    if (role !== "exec") {
      return jsonError("Only exec can download attestations", 403);
    }

    const eventId = params.id;
    const { searchParams } = new URL(req.url);
    const vendorId = searchParams.get("userId");
    if (!eventId || !vendorId) {
      return jsonError("eventId and userId are required", 400);
    }

    // Fetch event info
    const { data: event } = await supabaseAdmin
      .from("events")
      .select("id, event_name, venue, city, state, event_date, start_time, end_time")
      .eq("id", eventId)
      .maybeSingle();
    if (!event) return jsonError("Event not found", 404);

    // Fetch vendor profile
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("user_id, first_name, last_name")
      .eq("user_id", vendorId)
      .maybeSingle();
    const firstName = decryptName(profile?.first_name, vendorId);
    const lastName = decryptName(profile?.last_name, vendorId);
    const vendorName = [firstName, lastName].filter(Boolean).join(" ") || "Unknown";

    // Fetch time entries for this vendor + event
    const eventDate = (event.event_date || "").split("T")[0];
    const { data: timeEntries } = await supabaseAdmin
      .from("time_entries")
      .select("action, timestamp")
      .eq("user_id", vendorId)
      .eq("event_id", eventId)
      .order("timestamp", { ascending: true });

    // Compute shift details
    let clockInAt: string | null = null;
    let clockOutAt: string | null = null;
    let mealMs = 0;
    let openMealStart: number | null = null;

    for (const entry of timeEntries || []) {
      const tsMs = Date.parse(entry.timestamp);
      if (Number.isNaN(tsMs)) continue;
      if (entry.action === "clock_in" && !clockInAt) clockInAt = entry.timestamp;
      else if (entry.action === "clock_out") {
        clockOutAt = entry.timestamp;
        if (openMealStart !== null) { mealMs += Math.max(0, tsMs - openMealStart); openMealStart = null; }
      } else if (entry.action === "meal_start" && openMealStart === null) openMealStart = tsMs;
      else if (entry.action === "meal_end" && openMealStart !== null) {
        mealMs += Math.max(0, tsMs - openMealStart); openMealStart = null;
      }
    }

    let totalHoursMs = 0;
    if (clockInAt && clockOutAt) {
      totalHoursMs = Math.max(0, Date.parse(clockOutAt) - Date.parse(clockInAt) - mealMs);
    }

    // Fetch attestation (clock_out_attestation) for this vendor in last 48h
    const fortyEightHoursAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const { data: attestations } = await supabaseAdmin
      .from("form_signatures")
      .select("id, user_id, signed_at, ip_address, is_valid, form_id, signature_data, signature_type")
      .eq("form_type", "clock_out_attestation")
      .eq("user_id", vendorId)
      .gte("signed_at", fortyEightHoursAgo)
      .order("signed_at", { ascending: false })
      .limit(5);

    const att = (attestations || [])[0] || null;

    // ─── Build PDF ───
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const leftMargin = 50;
    const rightMargin = 50;
    const topMargin = 720;
    const bottomMargin = 50;
    const pageWidth = 612;

    let page: PDFPage = pdfDoc.addPage([612, 792]);
    let y = topMargin;

    const ensureSpace = (h: number) => {
      if (y - h < bottomMargin) { page = pdfDoc.addPage([612, 792]); y = topMargin; }
    };

    const drawText = (text: string, opts?: { font?: PDFFont; size?: number; x?: number; color?: ReturnType<typeof rgb> }) => {
      const s = opts?.size ?? 10;
      const x = opts?.x ?? leftMargin;
      const f = opts?.font ?? font;
      const c = opts?.color ?? rgb(0.15, 0.15, 0.15);
      const maxW = pageWidth - x - rightMargin;
      const lines = wrapText(text, f, s, maxW);
      const lh = s + 4;
      ensureSpace(lines.length * lh);
      for (const line of lines) {
        page.drawText(line, { x, y, size: s, font: f, color: c });
        y -= lh;
      }
    };

    const drawLine = () => {
      ensureSpace(8);
      page.drawLine({
        start: { x: leftMargin, y },
        end: { x: pageWidth - rightMargin, y },
        color: rgb(0.84, 0.87, 0.9),
        thickness: 1,
      });
      y -= 12;
    };

    // Header
    drawText("Clock-Out Attestation", { font: boldFont, size: 18, color: rgb(0.04, 0.18, 0.48) });
    y -= 4;
    drawText(`Generated: ${formatDateTime(new Date().toISOString())}`, { size: 9, color: rgb(0.4, 0.4, 0.4) });
    y -= 10;
    drawLine();

    // Event info
    drawText("Event Details", { font: boldFont, size: 13 });
    y -= 4;
    drawText(`Event: ${(event as any).event_name || "Unnamed Event"}`);
    drawText(`Venue: ${event.venue || "--"}  |  Location: ${event.city || "--"}${event.state ? `, ${event.state}` : ""}`);
    drawText(`Date: ${eventDate}  |  Schedule: ${event.start_time || "--"} - ${event.end_time || "--"}`);
    y -= 10;
    drawLine();

    // Vendor shift info
    drawText("Vendor Shift Details", { font: boldFont, size: 13 });
    y -= 4;
    drawText(`Name: ${vendorName}`, { font: boldFont });
    drawText(`Check In: ${clockInAt ? formatTime(clockInAt) : "--"}`);
    drawText(`Check Out: ${clockOutAt ? formatTime(clockOutAt) : "--"}`);
    drawText(`Meal Time: ${mealMs > 0 ? formatDuration(mealMs) : "0h 00m"}`);
    drawText(`Total Hours: ${formatDuration(totalHoursMs)}`);
    y -= 10;
    drawLine();

    // Attestation
    drawText("Attestation", { font: boldFont, size: 13 });
    y -= 4;

    if (!att) {
      drawText("No clock-out attestation found for this vendor.", { color: rgb(0.55, 0.1, 0.1) });
    } else {
      drawText(`I, ${vendorName}, hereby attest that:`, { font: boldFont, size: 10 });
      y -= 2;
      drawText(`    - I have accurately reported all hours worked`, { size: 10, x: leftMargin + 8 });
      drawText(`    - I have taken all required meal and rest breaks`, { size: 10, x: leftMargin + 8 });
      drawText(`    - I am clocking out at the correct time`, { size: 10, x: leftMargin + 8 });
      y -= 6;
      drawText(`Signed At: ${formatDateTime(att.signed_at)}  |  Valid: ${att.is_valid ? "Yes" : "No"}`, {
        size: 9, color: rgb(0.35, 0.35, 0.35),
      });
      y -= 6;

      // Signature image
      const sigRaw = (att.signature_data || "").trim();
      if (!sigRaw) {
        drawText("Signature: (missing)", { size: 9, color: rgb(0.55, 0.1, 0.1) });
      } else {
        const parsed = parseSignatureDataUrl(sigRaw);
        if (parsed) {
          try {
            const embedded = parsed.format === "png"
              ? await pdfDoc.embedPng(parsed.bytes)
              : await pdfDoc.embedJpg(parsed.bytes);

            const maxW = Math.min(280, pageWidth - leftMargin - rightMargin - 20);
            const maxH = 80;
            const scale = Math.min(maxW / embedded.width, maxH / embedded.height, 1);
            const dw = embedded.width * scale;
            const dh = embedded.height * scale;

            ensureSpace(dh + 20);
            page.drawText("Signature:", { x: leftMargin, y, size: 9, font, color: rgb(0.35, 0.35, 0.35) });
            y -= 12;
            page.drawImage(embedded, { x: leftMargin, y: y - dh, width: dw, height: dh });
            y -= dh + 10;
          } catch {
            drawText("Signature: (failed to render image)", { size: 9, color: rgb(0.55, 0.1, 0.1) });
          }
        } else {
          drawText(`Signature (${att.signature_type || "text"}): ${sigRaw}`, { size: 9 });
        }
      }
    }

    const pdfBytes = await pdfDoc.save();
    const safeName = vendorName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `attestation-${safeName}-${eventDate}.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=\"${filename}\"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("Error generating attestation PDF:", err);
    return jsonError(err?.message || "Failed to generate PDF", 500);
  }
}
