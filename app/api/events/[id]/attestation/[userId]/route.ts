import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
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

async function getAuthedUser(req: NextRequest) {
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
  try {
    return decrypt(trimmed);
  } catch {
    return trimmed;
  }
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

function formatDateTime(iso: string | null): string {
  if (!iso) return "--";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function parseSignatureDataUrl(value: string): { format: "png" | "jpeg"; bytes: Buffer } | null {
  const match = value.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  const rawFormat = match[1].toLowerCase();
  const normalizedFormat = rawFormat === "jpg" ? "jpeg" : rawFormat;
  if (normalizedFormat !== "png" && normalizedFormat !== "jpeg") return null;
  try {
    return { format: normalizedFormat, bytes: Buffer.from(match[2], "base64") };
  } catch {
    return null;
  }
}

function msToHoursMinutes(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; userId: string } }
) {
  try {
    const authedUser = await getAuthedUser(req);
    if (!authedUser?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const eventId = params.id;
    const targetUserId = params.userId;

    // Fetch event details
    const { data: event, error: evtErr } = await supabaseAdmin
      .from("events")
      .select("id, event_name, artist, venue, city, state, event_date, start_time, end_time, ends_next_day")
      .eq("id", eventId)
      .maybeSingle();

    if (evtErr || !event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Fetch user profile
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("user_id, first_name, last_name")
      .eq("user_id", targetUserId)
      .maybeSingle();

    const firstName = decryptField(profile?.first_name);
    const lastName = decryptField(profile?.last_name);
    const fullName = [firstName, lastName].filter(Boolean).join(" ") || "Unknown";

    // Fetch user email
    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("email")
      .eq("id", targetUserId)
      .maybeSingle();

    const email = userData?.email || "";

    // Fetch time entries for this user + event
    const eventDate = (event.event_date || "").toString().split("T")[0];
    const { data: entries } = await supabaseAdmin
      .from("time_entries")
      .select("id, user_id, action, timestamp, event_id")
      .eq("user_id", targetUserId)
      .eq("event_id", eventId)
      .order("timestamp", { ascending: true });

    // If no entries with event_id, try date-based fallback
    let timeEntries = entries || [];
    if (timeEntries.length === 0 && eventDate) {
      const startIso = `${eventDate}T00:00:00Z`;
      const endDate = new Date(`${eventDate}T23:59:59.999Z`);
      endDate.setUTCDate(endDate.getUTCDate() + 1);
      const endIso = endDate.toISOString();

      const { data: fallbackEntries } = await supabaseAdmin
        .from("time_entries")
        .select("id, user_id, action, timestamp, event_id")
        .eq("user_id", targetUserId)
        .gte("timestamp", startIso)
        .lte("timestamp", endIso)
        .order("timestamp", { ascending: true });

      timeEntries = (fallbackEntries || []).filter(
        (e: any) => !e.event_id || e.event_id === eventId
      );
    }

    // Parse time entries
    const clockIns = timeEntries.filter((e: any) => e.action === "clock_in");
    const clockOuts = timeEntries.filter((e: any) => e.action === "clock_out");
    const mealStarts = timeEntries.filter((e: any) => e.action === "meal_start");
    const mealEnds = timeEntries.filter((e: any) => e.action === "meal_end");

    const firstClockIn = clockIns[0]?.timestamp || null;
    const lastClockOut = clockOuts[clockOuts.length - 1]?.timestamp || null;
    const firstMealStart = mealStarts[0]?.timestamp || null;
    const firstMealEnd = mealEnds[0]?.timestamp || null;
    const secondMealStart = mealStarts[1]?.timestamp || null;
    const secondMealEnd = mealEnds[1]?.timestamp || null;

    // Calculate total worked time
    let totalWorkedMs = 0;
    let currentClockIn: string | null = null;
    for (const entry of timeEntries) {
      if (entry.action === "clock_in") {
        if (!currentClockIn) currentClockIn = entry.timestamp;
      } else if (entry.action === "clock_out") {
        if (currentClockIn) {
          const dur = new Date(entry.timestamp).getTime() - new Date(currentClockIn).getTime();
          if (dur > 0) totalWorkedMs += dur;
          currentClockIn = null;
        }
      }
    }

    // Calculate meal break duration
    let mealBreakMs = 0;
    if (firstMealStart && firstMealEnd) {
      const dur = new Date(firstMealEnd).getTime() - new Date(firstMealStart).getTime();
      if (dur > 0) mealBreakMs += dur;
    }
    if (secondMealStart && secondMealEnd) {
      const dur = new Date(secondMealEnd).getTime() - new Date(secondMealStart).getTime();
      if (dur > 0) mealBreakMs += dur;
    }

    // Fetch attestation signature (clock-out attestation for this user)
    // The form_id pattern is "clock-out-{time_entry_id}" for the clock_out entry
    const clockOutIds = clockOuts.map((e: any) => `clock-out-${e.id}`);

    let attestation: any = null;
    if (clockOutIds.length > 0) {
      const { data: sigs } = await supabaseAdmin
        .from("form_signatures")
        .select("id, form_id, signature_data, signature_type, signed_at, ip_address, is_valid, form_data_hash")
        .eq("form_type", "clock_out_attestation")
        .eq("user_id", targetUserId)
        .in("form_id", clockOutIds)
        .order("signed_at", { ascending: false })
        .limit(1);

      attestation = sigs?.[0] || null;
    }

    // If not found by form_id, try broader search for this user's recent attestation
    if (!attestation && eventDate) {
      const { data: sigs } = await supabaseAdmin
        .from("form_signatures")
        .select("id, form_id, signature_data, signature_type, signed_at, ip_address, is_valid, form_data_hash")
        .eq("form_type", "clock_out_attestation")
        .eq("user_id", targetUserId)
        .gte("signed_at", `${eventDate}T00:00:00Z`)
        .order("signed_at", { ascending: false })
        .limit(1);

      attestation = sigs?.[0] || null;
    }

    // Generate PDF
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const leftMargin = 50;
    const rightMargin = 50;
    const pageWidth = 612;
    const pageHeight = 792;
    const contentWidth = pageWidth - leftMargin - rightMargin;

    let page: PDFPage = pdfDoc.addPage([pageWidth, pageHeight]);
    let y = pageHeight - 50;

    const ensureSpace = (needed: number) => {
      if (y - needed < 60) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - 50;
      }
    };

    const drawText = (text: string, opts?: { font?: PDFFont; size?: number; x?: number; color?: ReturnType<typeof rgb> }) => {
      const f = opts?.font || font;
      const s = opts?.size || 10;
      const x = opts?.x || leftMargin;
      const c = opts?.color || rgb(0.1, 0.1, 0.1);
      ensureSpace(s + 6);
      page.drawText(text, { x, y, size: s, font: f, color: c });
      y -= s + 5;
    };

    const drawLine = () => {
      ensureSpace(8);
      page.drawLine({
        start: { x: leftMargin, y },
        end: { x: pageWidth - rightMargin, y },
        color: rgb(0.8, 0.83, 0.87),
        thickness: 1,
      });
      y -= 10;
    };

    const drawField = (label: string, value: string) => {
      ensureSpace(24);
      page.drawText(label, { x: leftMargin, y, size: 9, font: boldFont, color: rgb(0.35, 0.35, 0.35) });
      page.drawText(value, { x: leftMargin + 140, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
      y -= 18;
    };

    // Header
    drawText("CLOCK-OUT ATTESTATION", { font: boldFont, size: 18, color: rgb(0.04, 0.18, 0.48) });
    y -= 2;
    drawText("Time & Attendance Record", { size: 10, color: rgb(0.45, 0.45, 0.45) });
    y -= 8;
    drawLine();

    // Employee Info
    drawText("EMPLOYEE INFORMATION", { font: boldFont, size: 12, color: rgb(0.15, 0.15, 0.15) });
    y -= 4;
    drawField("Name:", fullName);
    if (email) drawField("Email:", email);
    drawField("Employee ID:", targetUserId.slice(0, 8) + "...");
    y -= 6;
    drawLine();

    // Event Info
    drawText("EVENT INFORMATION", { font: boldFont, size: 12, color: rgb(0.15, 0.15, 0.15) });
    y -= 4;
    drawField("Event:", event.event_name || "N/A");
    if (event.artist) drawField("Artist:", event.artist);
    drawField("Venue:", [event.venue, event.city, event.state].filter(Boolean).join(", ") || "N/A");
    drawField("Event Date:", formatDate(event.event_date));
    drawField("Scheduled:", `${event.start_time?.slice(0, 5) || "--:--"} - ${event.end_time?.slice(0, 5) || "--:--"}`);
    y -= 6;
    drawLine();

    // Time Record
    drawText("TIME RECORD", { font: boldFont, size: 12, color: rgb(0.15, 0.15, 0.15) });
    y -= 4;
    drawField("Clock In:", formatTime(firstClockIn));
    drawField("Clock Out:", formatTime(lastClockOut));
    drawField("Total Worked:", msToHoursMinutes(totalWorkedMs));
    drawField("Decimal Hours:", (totalWorkedMs / 3600000).toFixed(2));
    y -= 4;

    if (firstMealStart || secondMealStart) {
      drawText("Meal Breaks:", { font: boldFont, size: 9, x: leftMargin, color: rgb(0.35, 0.35, 0.35) });
      y -= 2;
      if (firstMealStart) {
        drawField("  Meal 1:", `${formatTime(firstMealStart)} - ${formatTime(firstMealEnd)}`);
      }
      if (secondMealStart) {
        drawField("  Meal 2:", `${formatTime(secondMealStart)} - ${formatTime(secondMealEnd)}`);
      }
      if (mealBreakMs > 0) {
        drawField("  Total Break:", msToHoursMinutes(mealBreakMs));
      }
    }
    y -= 6;
    drawLine();

    // Attestation Statement
    drawText("ATTESTATION STATEMENT", { font: boldFont, size: 12, color: rgb(0.15, 0.15, 0.15) });
    y -= 6;

    const attestationText = [
      "I hereby attest that:",
      "",
      "1. I have accurately reported all hours worked during this shift.",
      "2. I have taken all required meal and rest breaks as provided by law.",
      "3. The clock-out time recorded above is correct and accurate.",
      "4. I understand that falsifying time records is grounds for disciplinary action.",
    ];

    for (const line of attestationText) {
      if (line === "") {
        y -= 6;
      } else {
        drawText(line, { size: 10 });
      }
    }
    y -= 8;

    // Signature
    if (attestation) {
      drawText("SIGNATURE", { font: boldFont, size: 12, color: rgb(0.15, 0.15, 0.15) });
      y -= 4;

      const sigData = (attestation.signature_data || "").trim();
      if (sigData) {
        const parsed = parseSignatureDataUrl(sigData);
        if (parsed) {
          try {
            const embedded = parsed.format === "png"
              ? await pdfDoc.embedPng(parsed.bytes)
              : await pdfDoc.embedJpg(parsed.bytes);

            const maxW = Math.min(250, contentWidth);
            const maxH = 70;
            const scale = Math.min(maxW / embedded.width, maxH / embedded.height, 1);
            const drawWidth = embedded.width * scale;
            const drawHeight = embedded.height * scale;

            // Draw signature box background
            ensureSpace(drawHeight + 30);
            page.drawRectangle({
              x: leftMargin,
              y: y - drawHeight - 5,
              width: drawWidth + 20,
              height: drawHeight + 10,
              borderColor: rgb(0.8, 0.83, 0.87),
              borderWidth: 1,
              color: rgb(0.98, 0.98, 0.99),
            });

            page.drawImage(embedded, {
              x: leftMargin + 10,
              y: y - drawHeight,
              width: drawWidth,
              height: drawHeight,
            });
            y -= drawHeight + 16;
          } catch {
            drawText("(Signature image could not be rendered)", { size: 9, color: rgb(0.6, 0.1, 0.1) });
          }
        } else {
          drawText("(Signature data present but format not supported)", { size: 9, color: rgb(0.6, 0.1, 0.1) });
        }
      } else {
        drawText("(No signature data)", { size: 9, color: rgb(0.6, 0.1, 0.1) });
      }

      y -= 4;
      drawField("Signed At:", formatDateTime(attestation.signed_at));
      if (attestation.ip_address) drawField("IP Address:", attestation.ip_address);
      drawField("Valid:", attestation.is_valid ? "Yes" : "No");
      if (attestation.form_data_hash) {
        drawField("Data Hash:", attestation.form_data_hash.slice(0, 24) + "...");
      }
    } else {
      y -= 4;
      drawText("NO ATTESTATION ON FILE", { font: boldFont, size: 12, color: rgb(0.7, 0.15, 0.15) });
      y -= 4;
      drawText("This employee has not submitted a clock-out attestation for this event.", { size: 10, color: rgb(0.5, 0.5, 0.5) });

      // Draw a signature line for manual signing
      y -= 20;
      page.drawLine({
        start: { x: leftMargin, y },
        end: { x: leftMargin + 250, y },
        color: rgb(0.3, 0.3, 0.3),
        thickness: 0.75,
      });
      y -= 12;
      drawText("Employee Signature", { size: 8, color: rgb(0.5, 0.5, 0.5) });
      y -= 14;
      page.drawLine({
        start: { x: leftMargin, y },
        end: { x: leftMargin + 150, y },
        color: rgb(0.3, 0.3, 0.3),
        thickness: 0.75,
      });
      y -= 12;
      drawText("Date", { size: 8, color: rgb(0.5, 0.5, 0.5) });
    }

    // Footer
    y -= 16;
    drawLine();
    drawText(`Generated: ${new Date().toLocaleString("en-US")}`, { size: 8, color: rgb(0.55, 0.55, 0.55) });
    drawText("This document is an official record of time and attendance.", { size: 8, color: rgb(0.55, 0.55, 0.55) });

    const pdfBytes = await pdfDoc.save();
    const safeName = fullName.replace(/[^a-zA-Z0-9]/g, "_");
    const filename = `attestation_${safeName}_${eventDate}.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("Error generating attestation PDF:", err);
    return NextResponse.json({ error: err?.message || "Failed to generate PDF" }, { status: 500 });
  }
}
