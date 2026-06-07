import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, getAuthenticatedUserId, hasHrAccess } from "../../_auth";
import { safeDecrypt } from "@/lib/encryption";
import { computeWorkedHoursByUser, RawTimeEntry } from "@/lib/time-entry-hours";
import { SAN_DIEGO_BASE_RATE } from "@/lib/san-diego-payroll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_BASE_RATE = 17.28;
const QUERY_CHUNK_SIZE = 150;

function round2(n: number): number {
  return Number((Number.isFinite(n) ? n : 0).toFixed(2));
}

function normalizeState(s?: string | null): string {
  return String(s || "").toUpperCase().trim();
}

function safeName(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return safeDecrypt(raw).trim();
  } catch {
    return raw;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0 || items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// GET: preview per-employee sick-leave + worked hours for a cycle window.
export async function GET(
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

    const { data: cycle, error: cycleError } = await supabaseAdmin
      .from("payment_cycles")
      .select("id, label, start_date, end_date, pay_date, status")
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

    // ---- Sick-leave hours used within the window (approved leaves that overlap) ----
    const { data: leaves, error: leavesError } = await supabaseAdmin
      .from("sick_leaves")
      .select("user_id, duration_hours, start_date, end_date, status")
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
    for (const row of (leaves || []) as any[]) {
      const uid = String(row.user_id || "");
      if (!uid) continue;
      sickHoursByUser.set(uid, (sickHoursByUser.get(uid) || 0) + Number(row.duration_hours || 0));
    }

    const userIds = [...sickHoursByUser.keys()];
    if (userIds.length === 0) {
      return NextResponse.json({ cycle, rows: [] }, { status: 200 });
    }

    // ---- Existing paysheets for this cycle (to flag already-created) ----
    const { data: existing } = await supabaseAdmin
      .from("sick_leave_paysheets")
      .select("user_id")
      .eq("cycle_id", cycleId);
    const alreadyHasPaysheet = new Set(
      ((existing || []) as any[]).map((r) => String(r.user_id || ""))
    );

    // ---- Profiles (name, city, state) + email for rate + display ----
    const profileById = new Map<
      string,
      { name: string; email: string; state: string; city: string }
    >();
    for (const ids of chunk(userIds, QUERY_CHUNK_SIZE)) {
      const { data: users } = await supabaseAdmin
        .from("users")
        .select("id, email, profiles ( first_name, last_name, city, state )")
        .in("id", ids);
      for (const u of (users || []) as any[]) {
        const p = Array.isArray(u.profiles) ? u.profiles[0] : u.profiles;
        const name =
          `${safeName(p?.first_name)} ${safeName(p?.last_name)}`.trim() ||
          String(u.email || "Unknown");
        profileById.set(u.id, {
          name,
          email: String(u.email || ""),
          state: normalizeState(p?.state),
          city: String(p?.city || ""),
        });
      }
    }

    // ---- State base rates ----
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

    // ---- Worked hours within the window ----
    const { data: entries } = await supabaseAdmin
      .from("time_entries")
      .select("id, user_id, action, timestamp")
      .in("user_id", userIds)
      .gte("timestamp", `${startDate}T00:00:00Z`)
      .lte("timestamp", `${endDate}T23:59:59.999Z`);
    const workedByUser = computeWorkedHoursByUser((entries || []) as RawTimeEntry[]);

    const rows = userIds
      .map((uid) => {
        const profile = profileById.get(uid);
        const sickHours = round2(sickHoursByUser.get(uid) || 0);
        const state = profile?.state || "";
        const city = profile?.city || "";
        const rate = round2(rateFor(state, city));
        return {
          user_id: uid,
          name: profile?.name || "Unknown",
          email: profile?.email || "",
          state,
          sick_hours: sickHours,
          worked_hours: round2(workedByUser.get(uid) || 0),
          rate,
          amount: round2(sickHours * rate),
          already_has_paysheet: alreadyHasPaysheet.has(uid),
        };
      })
      .filter((r) => r.sick_hours > 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ cycle, rows }, { status: 200 });
  } catch (err: any) {
    console.error("[PAYMENT CYCLES][RETRIEVE] error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
