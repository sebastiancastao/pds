// app/api/hr/payroll-uploads/route.ts
//
// Payroll spreadsheets uploaded on the /hr-dashboard Payroll tab for a pay
// period, stored for review and editing. This never writes to event payments.
//
// GET  ?start=YYYY-MM-DD&end=YYYY-MM-DD -> uploads whose period overlaps the range
//                                          (the 25 most recent when no range is given)
// POST { periodStart, periodEnd, fileName, sheetName, notes, rows[], active? } -> new upload.
//      It becomes the payroll for its period (replacing any upload used before)
//      unless active is false. System payroll itself is never changed.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { roundMoney } from "@/lib/payroll-upload";
import { supabaseAdmin } from "../payment-cycles/_auth";
import {
  UPLOAD_COLUMNS,
  cleanRows,
  emailsForUserIds,
  fetchAllPages,
  insertRowsInChunks,
  resolveAccounts,
  parseIsoDate,
  requireHr,
  setUploadActive,
} from "./_shared";

export async function GET(req: NextRequest) {
  const auth = await requireHr(req);
  if ("error" in auth) return auth.error;

  const start = parseIsoDate(req.nextUrl.searchParams.get("start"));
  const end = parseIsoDate(req.nextUrl.searchParams.get("end"));

  let query = supabaseAdmin
    .from("payroll_period_uploads")
    .select(UPLOAD_COLUMNS)
    .order("created_at", { ascending: false });
  if (start) query = query.gte("period_end", start);
  if (end) query = query.lte("period_start", end);
  if (!start && !end) query = query.limit(25);

  const { data: uploads, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const list = uploads || [];
  const ids = list.map((u: any) => u.id);
  const totals = new Map<string, { count: number; gross: number; hours: number }>();
  if (ids.length > 0) {
    try {
      const rows = await fetchAllPages<{ upload_id: string; total_gross_pay: number | null; hours: number | null }>((from, to) =>
        supabaseAdmin
          .from("payroll_period_upload_rows")
          .select("upload_id, total_gross_pay, hours")
          .in("upload_id", ids)
          .order("id")
          .range(from, to)
      );
      rows.forEach((r) => {
        const t = totals.get(r.upload_id) || { count: 0, gross: 0, hours: 0 };
        t.count += 1;
        t.gross += Number(r.total_gross_pay || 0);
        t.hours += Number(r.hours || 0);
        totals.set(r.upload_id, t);
      });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "Failed to load upload totals" }, { status: 500 });
    }
  }

  const emails = await emailsForUserIds(list.flatMap((u: any) => [u.uploaded_by, u.reviewed_by]));
  return NextResponse.json({
    uploads: list.map((u: any) => {
      const t = totals.get(u.id) || { count: 0, gross: 0, hours: 0 };
      return {
        ...u,
        uploaded_by_email: u.uploaded_by ? emails.get(u.uploaded_by) || null : null,
        reviewed_by_email: u.reviewed_by ? emails.get(u.reviewed_by) || null : null,
        row_count: t.count,
        total_gross_pay: roundMoney(t.gross),
        total_hours: roundMoney(t.hours),
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireHr(req);
  if ("error" in auth) return auth.error;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const periodStart = parseIsoDate(body?.periodStart);
  const periodEnd = parseIsoDate(body?.periodEnd);
  if (!periodStart || !periodEnd) {
    return NextResponse.json({ error: "Pick the payroll Start and End dates first" }, { status: 400 });
  }
  if (periodEnd < periodStart) {
    return NextResponse.json({ error: "End date is before Start date" }, { status: 400 });
  }

  const cleaned = cleanRows(body?.rows);
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
  if (cleaned.rows.length === 0) {
    return NextResponse.json({ error: "The upload has no payroll lines" }, { status: 400 });
  }

  let accounts: Array<{ userId: string | null; email: string | null }>;
  try {
    accounts = await resolveAccounts(cleaned.rows);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to match employees" }, { status: 500 });
  }

  const { data: upload, error: uploadError } = await supabaseAdmin
    .from("payroll_period_uploads")
    .insert({
      period_start: periodStart,
      period_end: periodEnd,
      // One or more files, comma-separated, when several were combined.
      file_name: typeof body?.fileName === "string" ? body.fileName.slice(0, 1000) : null,
      // One or more sheets, comma-separated, when several were combined.
      sheet_name: typeof body?.sheetName === "string" ? body.sheetName.slice(0, 1000) : null,
      notes: typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 2000) : null,
      uploaded_by: auth.userId,
    })
    .select("id")
    .single();
  if (uploadError || !upload) {
    return NextResponse.json({ error: uploadError?.message || "Failed to save upload" }, { status: 500 });
  }

  const insertRows = cleaned.rows.map((row, index) => {
    const { id: _ignored, sort_order: _sort, from_file: _fromFile, source_file, source_sheet, source_row, extra, ...fields } = row;
    const account = accounts[index];
    if (!fields.email && account.email) {
      fields.email = account.email;
      extra["Email from employee account"] = true;
    }
    return {
      upload_id: upload.id,
      sort_order: index,
      source_file,
      source_sheet,
      source_row,
      user_id: account.userId,
      ...fields,
      extra,
      // The values as uploaded, kept so edits made during review stay visible.
      original: fields,
    };
  });

  try {
    await insertRowsInChunks(insertRows);
  } catch (e: any) {
    // Don't leave a half-saved upload behind.
    await supabaseAdmin.from("payroll_period_uploads").delete().eq("id", upload.id);
    return NextResponse.json({ error: e?.message || "Failed to save payroll lines" }, { status: 500 });
  }

  // The new upload replaces the payroll for its period unless asked not to.
  let active = false;
  let activeError: string | null = null;
  if (body?.active !== false) {
    try {
      await setUploadActive({ id: upload.id, period_start: periodStart, period_end: periodEnd }, true);
      active = true;
    } catch (e: any) {
      activeError = e?.message || "Saved, but couldn't set it as the payroll for this period";
    }
  }

  const matched = insertRows.filter((r) => r.user_id).length;
  return NextResponse.json(
    { id: upload.id, rowCount: insertRows.length, matchedCount: matched, active, activeError },
    { status: 201 }
  );
}
