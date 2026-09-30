// app/api/hr/payroll-uploads/active/route.ts
//
// GET ?start=YYYY-MM-DD&end=YYYY-MM-DD
//   -> { upload, rows } for the upload used as the payroll for exactly that
//      period, or { upload: null, rows: [] } when the period uses system payroll.
//      `overlapping` lists uploads in use for other periods that overlap these
//      dates, so the Payroll tab can point HR to them.
// Used by "Load Payments" on the /hr-dashboard Payroll tab.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../payment-cycles/_auth";
import { loadUploadWithRows, parseIsoDate, requireHr } from "../_shared";

export async function GET(req: NextRequest) {
  const auth = await requireHr(req);
  if ("error" in auth) return auth.error;

  const start = parseIsoDate(req.nextUrl.searchParams.get("start"));
  const end = parseIsoDate(req.nextUrl.searchParams.get("end"));
  if (!start || !end) {
    return NextResponse.json({ error: "start and end dates are required" }, { status: 400 });
  }

  const { data: active, error } = await supabaseAdmin
    .from("payroll_period_uploads")
    .select("id, period_start, period_end, file_name")
    .eq("is_active", true)
    .lte("period_start", end)
    .gte("period_end", start)
    .order("period_start", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const exact = (active || []).find((u: any) => u.period_start === start && u.period_end === end);
  const overlapping = (active || []).filter((u: any) => u !== exact);

  if (!exact) return NextResponse.json({ upload: null, rows: [], overlapping });

  try {
    const result = await loadUploadWithRows(exact.id);
    if (!result) return NextResponse.json({ upload: null, rows: [], overlapping });
    return NextResponse.json({ ...result, overlapping });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to load uploaded payroll" }, { status: 500 });
  }
}
