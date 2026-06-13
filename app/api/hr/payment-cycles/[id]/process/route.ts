import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, getAuthenticatedUserId, hasHrAccess } from "../../_auth";
import { SAN_DIEGO_BASE_RATE } from "@/lib/san-diego-payroll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_BASE_RATE = 17.28;

function round2(n: number): number {
  return Number((Number.isFinite(n) ? n : 0).toFixed(2));
}

function normalizeState(s?: string | null): string {
  return String(s || "").toUpperCase().trim();
}

// POST: auto-fill queued sick_leave_paysheets for a cycle.
// Hours/rate are recomputed server-side (client values are not trusted).
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!(await hasHrAccess(userId))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const cycleId = String(params?.id || "").trim();
    if (!cycleId) {
      return NextResponse.json({ error: "Cycle id is required" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const requestedUserIds: string[] | null = Array.isArray(body?.userIds)
      ? body.userIds.map((u: any) => String(u || "").trim()).filter(Boolean)
      : null;

    const { data: cycle, error: cycleError } = await supabaseAdmin
      .from("payment_cycles")
      .select("id, start_date, end_date, pay_date")
      .eq("id", cycleId)
      .maybeSingle();

    if (cycleError) {
      return NextResponse.json(
        { error: cycleError.message || "Failed to load cycle" },
        { status: 500 }
      );
    }
    if (!cycle) {
      return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
    }

    const startDate: string = (cycle as any).start_date;
    const endDate: string = (cycle as any).end_date;
    const payDate: string = (cycle as any).pay_date;

    // Approved sick-leave usage overlapping the window.
    const { data: leaves, error: leavesError } = await supabaseAdmin
      .from("sick_leaves")
      .select("user_id, duration_hours, event_id")
      .eq("status", "approved")
      .lte("start_date", endDate)
      .gte("end_date", startDate);

    if (leavesError) {
      return NextResponse.json(
        { error: leavesError.message || "Failed to load sick leave usage" },
        { status: 500 }
      );
    }

    const sickHoursByUser = new Map<string, number>();
    // Distinct events linked to the user's leaves in the window; attribute the paysheet
    // to that event only when it is unambiguous (exactly one linked event).
    const eventsByUser = new Map<string, Set<string>>();
    for (const row of (leaves || []) as any[]) {
      const uid = String(row.user_id || "");
      if (!uid) continue;
      sickHoursByUser.set(uid, (sickHoursByUser.get(uid) || 0) + Number(row.duration_hours || 0));
      if (row.event_id) {
        const set = eventsByUser.get(uid) ?? new Set<string>();
        set.add(String(row.event_id));
        eventsByUser.set(uid, set);
      }
    }
    const eventForUser = (uid: string): string | null => {
      const set = eventsByUser.get(uid);
      return set && set.size === 1 ? [...set][0] : null;
    };

    // Target users: requested subset (intersected with those who have usage) or all.
    let targetIds = [...sickHoursByUser.keys()];
    if (requestedUserIds) {
      const requested = new Set(requestedUserIds);
      targetIds = targetIds.filter((id) => requested.has(id));
    }
    if (targetIds.length === 0) {
      return NextResponse.json(
        { error: "No employees with sick-leave usage in this cycle." },
        { status: 400 }
      );
    }

    // Skip users that already have a paysheet for this cycle (no duplicates).
    const { data: existing } = await supabaseAdmin
      .from("sick_leave_paysheets")
      .select("user_id")
      .eq("cycle_id", cycleId)
      .in("user_id", targetIds);
    const skip = new Set(((existing || []) as any[]).map((r) => String(r.user_id || "")));
    const toCreate = targetIds.filter((id) => !skip.has(id));

    if (toCreate.length === 0) {
      return NextResponse.json(
        { message: "All selected employees already have a paysheet for this cycle.", created: 0, skipped: targetIds.length },
        { status: 200 }
      );
    }

    // Profiles for rate (state/city).
    const profileById = new Map<string, { state: string; city: string }>();
    const { data: users } = await supabaseAdmin
      .from("users")
      .select("id, profiles ( city, state )")
      .in("id", toCreate);
    for (const u of (users || []) as any[]) {
      const p = Array.isArray(u.profiles) ? u.profiles[0] : u.profiles;
      profileById.set(u.id, { state: normalizeState(p?.state), city: String(p?.city || "") });
    }

    // State base rates.
    const { data: rates } = await supabaseAdmin
      .from("state_rates")
      .select("state_code, base_rate");
    const baseRateByState = new Map<string, number>();
    for (const r of (rates || []) as any[]) {
      const st = normalizeState(r.state_code);
      const rate = Number(r.base_rate || 0);
      if (st && rate > 0) baseRateByState.set(st, rate);
    }
    const rateFor = (state: string, city: string): number => {
      if (state === "CA" && /san\s*diego/i.test(city)) return SAN_DIEGO_BASE_RATE;
      const configured = baseRateByState.get(state) || 0;
      return configured > 0 ? configured : DEFAULT_BASE_RATE;
    };

    const inserts = toCreate.map((uid) => {
      const profile = profileById.get(uid) || { state: "", city: "" };
      const hours = round2(sickHoursByUser.get(uid) || 0);
      const rate = round2(rateFor(profile.state, profile.city));
      return {
        user_id: uid,
        event_id: eventForUser(uid),
        hours,
        rate,
        amount: round2(hours * rate),
        payment_date: payDate,
        status: "queued",
        notes: "Auto-filled from payment cycle",
        created_by: userId,
        cycle_id: cycleId,
      };
    });

    const { data: created, error: insertError } = await supabaseAdmin
      .from("sick_leave_paysheets")
      .insert(inserts)
      .select("id");

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message || "Failed to create paysheets" },
        { status: 500 }
      );
    }

    await supabaseAdmin
      .from("payment_cycles")
      .update({ status: "processed" })
      .eq("id", cycleId);

    return NextResponse.json(
      {
        message: `Queued ${created?.length || 0} sick-leave paysheet${(created?.length || 0) !== 1 ? "s" : ""}.`,
        created: created?.length || 0,
        skipped: skip.size,
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[PAYMENT CYCLES][PROCESS] error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
