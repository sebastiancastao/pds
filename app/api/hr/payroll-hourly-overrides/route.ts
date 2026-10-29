// app/api/hr/payroll-hourly-overrides/route.ts
//
// "Pay hourly instead of commission" toggle on the /hr-dashboard Payroll tab
// (see supabase/migrations/20261029000001_create_payroll_hourly_overrides.sql).
//
// POST { action: "list", event_ids }
//   -> { overrides: [{ event_id, user_id, hourly_rate }] } for those events.
// POST { action: "set", user_id, event_ids, enabled }
//   enabled = true: the vendor is paid hourly on each of those events, at the rate for the
//   event's state (California $28.50, other states $25.92, lib/hourly-pay-override).
//   enabled = false: back to commission on those events.
// HR, exec and admin only.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../payment-cycles/_auth";
import { requireHr, UUID_RE } from "../payroll-uploads/_shared";
import { getHourlyOverrideRate } from "@/lib/hourly-pay-override";

const MAX_EVENT_IDS = 2000;
// Keeps each .in() filter's URL well under PostgREST's limit.
const ID_BATCH = 100;

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const cleanIds = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const ids = Array.from(new Set(value.map((v) => String(v || "").trim()).filter(Boolean)));
  if (ids.length > MAX_EVENT_IDS || ids.some((id) => !UUID_RE.test(id))) return null;
  return ids;
};

export async function POST(req: NextRequest) {
  const auth = await requireHr(req);
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const action = String(body?.action || "");
  const eventIds = cleanIds(body?.event_ids);
  if (!eventIds) {
    return NextResponse.json({ error: "event_ids must be a list of event ids" }, { status: 400 });
  }

  if (action === "list") {
    const overrides: Array<{ event_id: string; user_id: string; hourly_rate: number }> = [];
    for (const ids of chunk(eventIds, ID_BATCH)) {
      const { data, error } = await supabaseAdmin
        .from("payroll_hourly_overrides")
        .select("event_id, user_id, hourly_rate")
        .in("event_id", ids);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      (data || []).forEach((row: any) =>
        overrides.push({ event_id: row.event_id, user_id: row.user_id, hourly_rate: Number(row.hourly_rate) })
      );
    }
    return NextResponse.json({ overrides });
  }

  if (action !== "set") {
    return NextResponse.json({ error: "action must be list or set" }, { status: 400 });
  }

  const userId = String(body?.user_id || "").trim();
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
  }
  if (eventIds.length === 0) return NextResponse.json({ ok: true, count: 0 });

  if (!body.enabled) {
    let removed = 0;
    for (const ids of chunk(eventIds, ID_BATCH)) {
      const { data, error } = await supabaseAdmin
        .from("payroll_hourly_overrides")
        .delete()
        .eq("user_id", userId)
        .in("event_id", ids)
        .select("id");
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      removed += (data || []).length;
    }
    return NextResponse.json({ ok: true, count: removed });
  }

  // The rate comes from each event's state, never from the request.
  const rows: Array<{ event_id: string; user_id: string; hourly_rate: number; set_by: string }> = [];
  for (const ids of chunk(eventIds, ID_BATCH)) {
    const { data, error } = await supabaseAdmin.from("events").select("id, state").in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    (data || []).forEach((ev: any) =>
      rows.push({ event_id: ev.id, user_id: userId, hourly_rate: getHourlyOverrideRate(ev.state), set_by: auth.userId })
    );
  }
  if (rows.length !== eventIds.length) {
    return NextResponse.json({ error: "Some events were not found" }, { status: 400 });
  }
  for (const batch of chunk(rows, ID_BATCH)) {
    const { error } = await supabaseAdmin
      .from("payroll_hourly_overrides")
      .upsert(batch, { onConflict: "event_id,user_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, count: rows.length });
}
