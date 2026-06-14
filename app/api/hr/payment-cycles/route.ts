import { NextRequest, NextResponse } from "next/server";
import {
  supabaseAdmin,
  getAuthenticatedUserId,
  hasHrAccess,
} from "./_auth";
import {
  CYCLE_FREQUENCIES,
  CycleFrequency,
  generateCycleWindows,
} from "@/lib/payment-cycles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!ISO_DATE.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.toISOString().slice(0, 10) !== raw) return null;
  return raw;
}

// GET: active cadence config + generated cycles (with per-cycle paysheet counts)
export async function GET(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!(await hasHrAccess(userId))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { data: config } = await supabaseAdmin
      .from("payment_cycle_config")
      .select("id, frequency, anchor_date, pay_offset_days, is_active, updated_at")
      .eq("is_active", true)
      .maybeSingle();

    const { data: cycles, error: cyclesError } = await supabaseAdmin
      .from("payment_cycles")
      .select("id, label, start_date, end_date, pay_date, frequency, status, created_at")
      .order("start_date", { ascending: false });

    if (cyclesError) {
      return NextResponse.json(
        { error: cyclesError.message || "Failed to load payment cycles" },
        { status: 500 }
      );
    }

    const cycleRows = cycles || [];
    const cycleIds = cycleRows.map((c: any) => c.id);
    const countByCycle = new Map<string, number>();
    if (cycleIds.length > 0) {
      const { data: paysheets } = await supabaseAdmin
        .from("sick_leave_paysheets")
        .select("cycle_id")
        .in("cycle_id", cycleIds);
      for (const row of (paysheets || []) as any[]) {
        if (!row.cycle_id) continue;
        countByCycle.set(row.cycle_id, (countByCycle.get(row.cycle_id) || 0) + 1);
      }
    }

    return NextResponse.json(
      {
        config: config || null,
        cycles: cycleRows.map((c: any) => ({
          ...c,
          paysheet_count: countByCycle.get(c.id) || 0,
        })),
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[PAYMENT CYCLES][GET] error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// POST: save cadence config + (re)generate the rolling window of cycles
export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!(await hasHrAccess(userId))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const frequency = String(body?.frequency || "").toLowerCase() as CycleFrequency;
    const anchorDate = parseIsoDate(body?.anchorDate);
    const payOffsetDays = Math.max(0, Math.trunc(Number(body?.payOffsetDays ?? 0)) || 0);

    if (!CYCLE_FREQUENCIES.includes(frequency)) {
      return NextResponse.json(
        { error: "frequency must be one of: weekly, biweekly, semimonthly, monthly" },
        { status: 400 }
      );
    }
    if (!anchorDate) {
      return NextResponse.json(
        { error: "A valid anchorDate (YYYY-MM-DD) is required" },
        { status: 400 }
      );
    }

    // Single active config: deactivate any existing, then insert the new one.
    await supabaseAdmin
      .from("payment_cycle_config")
      .update({ is_active: false })
      .eq("is_active", true);

    const { data: config, error: configError } = await supabaseAdmin
      .from("payment_cycle_config")
      .insert({
        frequency,
        anchor_date: anchorDate,
        pay_offset_days: payOffsetDays,
        is_active: true,
        updated_by: userId,
      })
      .select("id, frequency, anchor_date, pay_offset_days, is_active, updated_at")
      .single();

    if (configError) {
      return NextResponse.json(
        { error: configError.message || "Failed to save cadence config" },
        { status: 500 }
      );
    }

    // Materialize the rolling window of cycles (idempotent on UNIQUE(start_date, end_date)).
    const windows = generateCycleWindows({
      frequency,
      anchor_date: anchorDate,
      pay_offset_days: payOffsetDays,
    });

    if (windows.length > 0) {
      const { error: upsertError } = await supabaseAdmin
        .from("payment_cycles")
        .upsert(
          windows.map((w) => ({
            label: w.label,
            start_date: w.start_date,
            end_date: w.end_date,
            pay_date: w.pay_date,
            frequency: w.frequency,
            created_by: userId,
          })),
          { onConflict: "start_date,end_date", ignoreDuplicates: true }
        );

      if (upsertError) {
        return NextResponse.json(
          { error: upsertError.message || "Failed to generate cycles" },
          { status: 500 }
        );
      }
    }

    const { data: cycles } = await supabaseAdmin
      .from("payment_cycles")
      .select("id, label, start_date, end_date, pay_date, frequency, status, created_at")
      .order("start_date", { ascending: false });

    return NextResponse.json(
      {
        message: "Payment cadence saved",
        config,
        cycles: (cycles || []).map((c: any) => ({ ...c, paysheet_count: 0 })),
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[PAYMENT CYCLES][POST] error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE: remove a cycle that has not been processed yet
export async function DELETE(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!(await hasHrAccess(userId))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = String(searchParams.get("id") || "").trim();
    if (!id) {
      return NextResponse.json({ error: "Cycle id is required" }, { status: 400 });
    }

    const { count } = await supabaseAdmin
      .from("sick_leave_paysheets")
      .select("id", { count: "exact", head: true })
      .eq("cycle_id", id);

    if ((count || 0) > 0) {
      return NextResponse.json(
        { error: "Cannot delete a cycle that already has paysheets. Remove the paysheets first." },
        { status: 409 }
      );
    }

    const { error } = await supabaseAdmin
      .from("payment_cycles")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to delete cycle" },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: "Cycle removed" }, { status: 200 });
  } catch (err: any) {
    console.error("[PAYMENT CYCLES][DELETE] error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
