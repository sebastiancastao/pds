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

type ActiveKiosk = {
  ipAddress: string;
  userAgent: string;
  operatorUserId: string;
  operatorName: string;
  eventId: string | null;
  lastSeen: string;
};

type CheckedInUser = {
  userId: string;
  name: string;
  eventId: string | null;
  eventName: string | null;
  venue: string | null;
  clockedInAt: string;
  division: string;
};

type ActiveEvent = {
  id: string;
  name: string | null;
  venue: string | null;
  city: string | null;
  state: string | null;
  date: string;
  startTime: string;
  endTime: string;
  checkedInCount: number;
  checkedInUsers: Array<{ userId: string; name: string; clockedInAt: string; division: string }>;
};

type AttestationWithSignature = {
  id: string;
  userId: string;
  name: string;
  signedAt: string;
  ipAddress: string;
  isValid: boolean;
  formId: string;
  signatureData: string | null;
  signatureType: string | null;
};

type MonitorExportData = {
  timestamp: string;
  activeKiosks: ActiveKiosk[];
  activeEvents: ActiveEvent[];
  checkedInUsers: CheckedInUser[];
  attestations: AttestationWithSignature[];
  summary: {
    totalActiveKiosks: number;
    totalCheckedIn: number;
    totalAttestationsToday: number;
    totalActiveEvents: number;
  };
};

function jsonError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

async function getAuthedUser(req: Request) {
  const supabase = createRouteHandlerClient({ cookies });
  let {
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

function decryptProfileNamePart(value: unknown, userIdForLog: string): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!isEncrypted(trimmed)) return trimmed;
  try {
    return decrypt(trimmed);
  } catch {
    console.warn("Profile name decryption failed for user", userIdForLog);
    return "";
  }
}

function toLocalDateStr(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateTime(isoValue: string): string {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return isoValue || "--";
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatTime(isoValue: string): string {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function parseSignatureDataUrl(value: string): { format: "png" | "jpeg"; bytes: Buffer } | null {
  const match = value.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  const rawFormat = match[1].toLowerCase();
  const normalizedFormat = rawFormat === "jpg" ? "jpeg" : rawFormat;
  if (normalizedFormat !== "png" && normalizedFormat !== "jpeg") return null;
  try {
    return {
      format: normalizedFormat,
      bytes: Buffer.from(match[2], "base64"),
    };
  } catch {
    return null;
  }
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!text.trim()) return [""];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  const pushCurrent = () => {
    if (currentLine) lines.push(currentLine);
    currentLine = "";
  };

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      currentLine = candidate;
      continue;
    }

    if (currentLine) {
      pushCurrent();
    }

    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      currentLine = word;
      continue;
    }

    let chunk = "";
    for (const char of word) {
      const chunkCandidate = `${chunk}${char}`;
      if (font.widthOfTextAtSize(chunkCandidate, size) <= maxWidth) {
        chunk = chunkCandidate;
      } else {
        if (chunk) lines.push(chunk);
        chunk = char;
      }
    }
    currentLine = chunk;
  }

  pushCurrent();
  return lines.length > 0 ? lines : [""];
}

async function getMonitorDataWithSignatures(): Promise<MonitorExportData> {
  const now = new Date();
  const sixtySecondsAgo = new Date(now.getTime() - 60_000);
  const twentyFourHoursAgo = new Date(now.getTime() - 86_400_000);
  const today = toLocalDateStr(now);
  const yesterday = toLocalDateStr(new Date(now.getTime() - 86_400_000));

  const [heartbeatsResult, activeEventsResult, timeEntriesResult, attestationsResult] = await Promise.all([
    supabaseAdmin
      .from("audit_logs")
      .select("user_id, ip_address, user_agent, resource_id, created_at")
      .eq("action", "kiosk.heartbeat")
      .gte("created_at", sixtySecondsAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(200),

    supabaseAdmin
      .from("events")
      .select("id, event_name, venue, city, state, event_date, start_time, end_time, ends_next_day, is_active")
      .eq("is_active", true)
      .in("event_date", [today, yesterday]),

    supabaseAdmin
      .from("time_entries")
      .select("user_id, action, timestamp, event_id, division")
      .in("action", ["clock_in", "clock_out"] as any)
      .gte("timestamp", `${yesterday}T00:00:00`)
      .order("timestamp", { ascending: true })
      .limit(5000),

    supabaseAdmin
      .from("form_signatures")
      .select("id, user_id, ip_address, user_agent, signed_at, is_valid, form_id, signature_data, signature_type")
      .eq("form_type", "clock_out_attestation")
      .gte("signed_at", twentyFourHoursAgo.toISOString())
      .order("signed_at", { ascending: false })
      .limit(200),
  ]);

  const allUserIds = new Set<string>();
  for (const hb of heartbeatsResult.data || []) if (hb.user_id) allUserIds.add(hb.user_id);
  for (const te of timeEntriesResult.data || []) if (te.user_id) allUserIds.add(te.user_id);
  for (const fs of attestationsResult.data || []) if (fs.user_id) allUserIds.add(fs.user_id);

  const profileMap = new Map<string, { firstName: string; lastName: string }>();
  if (allUserIds.size > 0) {
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("user_id, first_name, last_name")
      .in("user_id", Array.from(allUserIds));

    for (const p of profiles || []) {
      const userId = String((p as any).user_id);
      profileMap.set(userId, {
        firstName: decryptProfileNamePart((p as any).first_name, userId),
        lastName: decryptProfileNamePart((p as any).last_name, userId),
      });
    }
  }

  const getName = (userId: string): string => {
    const profile = profileMap.get(userId);
    return [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || "Unknown";
  };

  const kiosksByIp = new Map<string, ActiveKiosk>();
  for (const hb of heartbeatsResult.data || []) {
    const ipAddress = String(hb.ip_address || "unknown");
    if (!kiosksByIp.has(ipAddress)) {
      kiosksByIp.set(ipAddress, {
        ipAddress,
        userAgent: String(hb.user_agent || ""),
        operatorUserId: hb.user_id,
        operatorName: getName(hb.user_id),
        eventId: hb.resource_id || null,
        lastSeen: hb.created_at,
      });
    }
  }

  const eventsMap = new Map<string, ActiveEvent>();
  for (const evt of activeEventsResult.data || []) {
    eventsMap.set(evt.id, {
      id: evt.id,
      name: (evt as any).event_name || null,
      venue: evt.venue || null,
      city: evt.city || null,
      state: evt.state || null,
      date: evt.event_date,
      startTime: evt.start_time,
      endTime: evt.end_time,
      checkedInCount: 0,
      checkedInUsers: [],
    });
  }

  const userClockStatus = new Map<
    string,
    {
      lastAction: string;
      lastTimestamp: string;
      eventId: string | null;
      division: string;
    }
  >();

  for (const te of timeEntriesResult.data || []) {
    const uid = String(te.user_id || "");
    if (!uid) continue;
    userClockStatus.set(uid, {
      lastAction: te.action,
      lastTimestamp: te.timestamp,
      eventId: te.event_id || null,
      division: te.division || "",
    });
  }

  const checkedInUsers: CheckedInUser[] = [];
  for (const [userId, status] of userClockStatus) {
    if (status.lastAction !== "clock_in") continue;

    const eventData = status.eventId ? eventsMap.get(status.eventId) : null;
    checkedInUsers.push({
      userId,
      name: getName(userId),
      eventId: status.eventId,
      eventName: eventData?.name || null,
      venue: eventData?.venue || null,
      clockedInAt: status.lastTimestamp,
      division: status.division,
    });

    if (status.eventId && eventsMap.has(status.eventId)) {
      const eventEntry = eventsMap.get(status.eventId)!;
      eventEntry.checkedInCount += 1;
      eventEntry.checkedInUsers.push({
        userId,
        name: getName(userId),
        clockedInAt: status.lastTimestamp,
        division: status.division,
      });
    }
  }

  const attestations = (attestationsResult.data || []).map((sig: any): AttestationWithSignature => ({
    id: sig.id,
    userId: sig.user_id,
    name: getName(sig.user_id),
    signedAt: sig.signed_at,
    ipAddress: sig.ip_address || "unknown",
    isValid: !!sig.is_valid,
    formId: sig.form_id || "",
    signatureData: typeof sig.signature_data === "string" ? sig.signature_data : null,
    signatureType: typeof sig.signature_type === "string" ? sig.signature_type : null,
  }));

  return {
    timestamp: now.toISOString(),
    activeKiosks: Array.from(kiosksByIp.values()),
    activeEvents: Array.from(eventsMap.values()),
    checkedInUsers,
    attestations,
    summary: {
      totalActiveKiosks: kiosksByIp.size,
      totalCheckedIn: checkedInUsers.length,
      totalAttestationsToday: attestations.length,
      totalActiveEvents: eventsMap.size,
    },
  };
}

async function createMonitorPdf(data: MonitorExportData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const leftMargin = 42;
  const rightMargin = 42;
  const topMargin = 760;
  const bottomMargin = 42;
  const pageWidth = 612;
  const contentWidth = pageWidth - leftMargin - rightMargin;
  const imageCache = new Map<string, PDFImage>();

  let page: PDFPage = pdfDoc.addPage([612, 792]);
  let y = topMargin;

  const startNewPage = () => {
    page = pdfDoc.addPage([612, 792]);
    y = topMargin;
  };

  const ensureSpace = (requiredHeight: number) => {
    if (y - requiredHeight < bottomMargin) {
      startNewPage();
    }
  };

  const drawWrapped = (
    text: string,
    options?: {
      fontOverride?: PDFFont;
      size?: number;
      x?: number;
      color?: { r: number; g: number; b: number };
      lineHeight?: number;
      maxWidth?: number;
    }
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
    page.drawText(title, { x: leftMargin, y, size: 13, font: boldFont, color: rgb(0.07, 0.07, 0.07) });
    y -= 8;
    page.drawLine({
      start: { x: leftMargin, y },
      end: { x: pageWidth - rightMargin, y },
      color: rgb(0.84, 0.87, 0.9),
      thickness: 1,
    });
    y -= 14;
  };

  const drawBullet = (text: string, size = 10) => {
    drawWrapped(`- ${text}`, { size, x: leftMargin + 2 });
  };

  drawWrapped("Check-In Monitor Report", { fontOverride: boldFont, size: 18, color: { r: 0.04, g: 0.18, b: 0.48 } });
  drawWrapped(`Generated: ${formatDateTime(data.timestamp)}`, { size: 10, color: { r: 0.35, g: 0.35, b: 0.35 } });
  y -= 6;

  drawSectionTitle("Summary");
  drawBullet(`Active Kiosks: ${data.summary.totalActiveKiosks}`);
  drawBullet(`Currently Checked In: ${data.summary.totalCheckedIn}`);
  drawBullet(`Active Events: ${data.summary.totalActiveEvents}`);
  drawBullet(`Clock-Out Attestations (last 24h): ${data.summary.totalAttestationsToday}`);
  y -= 6;

  drawSectionTitle(`Active Kiosks (${data.activeKiosks.length})`);
  if (data.activeKiosks.length === 0) {
    drawBullet("No active kiosks.");
  } else {
    data.activeKiosks.forEach((kiosk, index) => {
      drawWrapped(
        `${index + 1}. ${kiosk.ipAddress} | Operator: ${kiosk.operatorName} | Last Seen: ${formatDateTime(
          kiosk.lastSeen
        )}`
      );
      if (kiosk.eventId) drawWrapped(`Event ID: ${kiosk.eventId}`, { size: 9, x: leftMargin + 14 });
      y -= 2;
    });
  }
  y -= 6;

  drawSectionTitle(`Event Check-Ins (${data.activeEvents.length})`);
  if (data.activeEvents.length === 0) {
    drawBullet("No active events.");
  } else {
    data.activeEvents.forEach((eventData, index) => {
      drawWrapped(`${index + 1}. ${eventData.name || "Unnamed Event"} (${eventData.checkedInCount} checked in)`, {
        fontOverride: boldFont,
      });
      drawWrapped(
        `Venue: ${eventData.venue || "--"} | Location: ${eventData.city || "--"}${
          eventData.state ? `, ${eventData.state}` : ""
        } | Date: ${eventData.date}`,
        { size: 9, x: leftMargin + 14 }
      );
      if (eventData.checkedInUsers.length === 0) {
        drawWrapped("No workers currently checked in for this event.", { size: 9, x: leftMargin + 14 });
      } else {
        eventData.checkedInUsers.forEach((worker, workerIndex) => {
          drawWrapped(
            `${workerIndex + 1}. ${worker.name} | Clocked in: ${formatTime(worker.clockedInAt)} | Division: ${
              worker.division || "--"
            }`,
            { size: 9, x: leftMargin + 22 }
          );
        });
      }
      y -= 4;
    });
  }
  y -= 6;

  drawSectionTitle(`Currently Checked In (${data.checkedInUsers.length})`);
  if (data.checkedInUsers.length === 0) {
    drawBullet("No users currently checked in.");
  } else {
    data.checkedInUsers.forEach((worker, index) => {
      drawWrapped(
        `${index + 1}. ${worker.name} | ${worker.eventName || "No event linked"} | Clocked in: ${formatDateTime(
          worker.clockedInAt
        )} | Division: ${worker.division || "--"}`,
        { size: 9 }
      );
    });
  }
  y -= 6;

  drawSectionTitle(`Clock-Out Attestations (${data.attestations.length})`);
  if (data.attestations.length === 0) {
    drawBullet("No attestations in the last 24 hours.");
  } else {
    for (const [index, att] of data.attestations.entries()) {
      drawWrapped(`${index + 1}. ${att.name}`, { fontOverride: boldFont, size: 10.5 });
      drawWrapped(
        `Signed At: ${formatDateTime(att.signedAt)} | Valid: ${
          att.isValid ? "Yes" : "No"
        } | IP: ${att.ipAddress} | Form ID: ${att.formId}`,
        { size: 9, x: leftMargin + 12 }
      );

      const signatureRaw = (att.signatureData || "").trim();
      if (!signatureRaw) {
        drawWrapped("Signature: (missing)", { size: 9, x: leftMargin + 12, color: { r: 0.55, g: 0.1, b: 0.1 } });
        y -= 4;
        continue;
      }

      const parsedImage = parseSignatureDataUrl(signatureRaw);
      if (parsedImage) {
        try {
          let embedded = imageCache.get(signatureRaw);
          if (!embedded) {
            embedded =
              parsedImage.format === "png"
                ? await pdfDoc.embedPng(parsedImage.bytes)
                : await pdfDoc.embedJpg(parsedImage.bytes);
            imageCache.set(signatureRaw, embedded);
          }

          const maxSignatureWidth = Math.min(240, contentWidth - 24);
          const maxSignatureHeight = 62;
          const widthRatio = maxSignatureWidth / embedded.width;
          const heightRatio = maxSignatureHeight / embedded.height;
          const scale = Math.min(widthRatio, heightRatio, 1);
          const drawWidth = embedded.width * scale;
          const drawHeight = embedded.height * scale;

          ensureSpace(drawHeight + 16);
          page.drawText("Signature:", {
            x: leftMargin + 12,
            y,
            size: 9,
            font,
            color: rgb(0.35, 0.35, 0.35),
          });
          y -= 10;
          page.drawImage(embedded, {
            x: leftMargin + 12,
            y: y - drawHeight,
            width: drawWidth,
            height: drawHeight,
          });
          y -= drawHeight + 8;
        } catch (imageError) {
          console.warn("Failed to embed attestation signature image", imageError);
          drawWrapped(`Signature (image decode failed)`, {
            size: 9,
            x: leftMargin + 12,
            color: { r: 0.55, g: 0.1, b: 0.1 },
          });
          y -= 4;
        }
      } else {
        drawWrapped(`Signature (${att.signatureType || "text"}): ${signatureRaw}`, {
          size: 9,
          x: leftMargin + 12,
        });
        y -= 4;
      }
    }
  }

  return pdfDoc.save();
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) return jsonError("Not authenticated", 401);

    const { data: userData } = await supabaseAdmin.from("users").select("role").eq("id", user.id).single();
    const role = (userData?.role || "").toString().trim().toLowerCase();
    if (!["admin", "exec", "hr", "manager"].includes(role)) {
      return jsonError("Unauthorized", 403);
    }

    const monitorData = await getMonitorDataWithSignatures();
    const pdfBytes = await createMonitorPdf(monitorData);
    const pdfBuffer = Buffer.from(pdfBytes);
    const datePart = new Date().toISOString().slice(0, 10);

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=\"check-in-monitor-${datePart}.pdf\"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("Error exporting check-in monitor PDF:", err);
    return jsonError(err?.message || "Failed to export PDF", 500);
  }
}
