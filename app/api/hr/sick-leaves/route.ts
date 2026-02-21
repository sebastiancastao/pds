import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
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

const HR_ROLES = new Set(["hr", "exec", "admin"]);
const VALID_STATUSES = new Set(["pending", "approved", "denied"]);
const SICK_LEAVE_ACCRUAL_HOURS_WORKED = 30;
const HOURS_PER_WORKDAY = 8;
const QUERY_CHUNK_SIZE = 150;
const QUERY_PAGE_SIZE = 1000;
const MANUAL_USED_HOURS_REASON_MARKER = "HR_MANUAL_USED_HOURS";
const CARRY_OVER_OVERRIDE_REASON_MARKER = "HR_CARRY_OVER_OVERRIDE";
const YEAR_TO_DATE_OVERRIDE_REASON_MARKER = "HR_YEAR_TO_DATE_OVERRIDE";

async function getAuthenticatedUserId(req: NextRequest): Promise<string | null> {
  const supabase = createRouteHandlerClient({ cookies });
  let {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    const authHeader =
      req.headers.get("authorization") || req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.substring(7)
      : undefined;

    if (token) {
      const { data: tokenUser } = await supabaseAnon.auth.getUser(token);
      if (tokenUser?.user?.id) {
        user = { id: tokenUser.user.id } as any;
      }
    }
  }

  return user?.id || null;
}

async function hasHrAccess(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();

  if (error) return false;
  return HR_ROLES.has(String(data?.role || "").toLowerCase());
}

type SickLeaveStatus = "pending" | "approved" | "denied";

type UserWithProfile = {
  id: string;
  email?: string | null;
  created_at?: string | null;
  profiles?:
    | {
        first_name?: string | null;
        last_name?: string | null;
        state?: string | null;
        city?: string | null;
      }
    | Array<{
        first_name?: string | null;
        last_name?: string | null;
        state?: string | null;
        city?: string | null;
      }>
    | null;
};

type ProfileSummary = {
  employee_name: string;
  employee_email: string;
  employee_state: string | null;
  employee_city: string | null;
  hire_date: string | null;
};

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0 || items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function toDateSafe(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function hoursBetween(clock_in: string | null, clock_out: string | null) {
  const a = toDateSafe(clock_in);
  const b = toDateSafe(clock_out);
  if (!a || !b) return 0;
  const ms = b.getTime() - a.getTime();
  return ms > 0 ? ms / (1000 * 60 * 60) : 0;
}

function fullMonthsBetween(start?: string | null, end = new Date()) {
  if (!start) return 0;
  const startDate = toDateSafe(start);
  if (!startDate) return 0;
  const endDate = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  const startUTC = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
  let months =
    (endDate.getUTCFullYear() - startUTC.getUTCFullYear()) * 12 +
    (endDate.getUTCMonth() - startUTC.getUTCMonth());
  if (endDate.getUTCDate() < startUTC.getUTCDate()) {
    months -= 1;
  }
  return Math.max(0, months);
}

function upsertProfile(profileMap: Map<string, ProfileSummary>, user: UserWithProfile) {
  if (!user?.id) return;
  const profile = Array.isArray(user.profiles) ? user.profiles[0] : user.profiles;
  const firstName = profile?.first_name ? safeDecrypt(profile.first_name) : "";
  const lastName = profile?.last_name ? safeDecrypt(profile.last_name) : "";
  const fullName = `${firstName} ${lastName}`.trim() || String(user.email || "Unknown");
  profileMap.set(user.id, {
    employee_name: fullName,
    employee_email: String(user.email || ""),
    employee_state: profile?.state ?? null,
    employee_city: profile?.city ?? null,
    hire_date: user.created_at ?? null,
  });
}

function normalizeStatus(raw: unknown): SickLeaveStatus {
  const normalized = String(raw || "pending").toLowerCase();
  if (normalized === "approved") return "approved";
  if (normalized === "denied") return "denied";
  return "pending";
}

function hasReasonMarker(reason: unknown, marker: string): boolean {
  return String(reason || "").toUpperCase().includes(marker.toUpperCase());
}

function getAccrualOverrideFieldFromReason(
  reason: unknown
): "carry_over" | "year_to_date" | null {
  if (hasReasonMarker(reason, CARRY_OVER_OVERRIDE_REASON_MARKER)) return "carry_over";
  if (hasReasonMarker(reason, YEAR_TO_DATE_OVERRIDE_REASON_MARKER)) return "year_to_date";
  return null;
}

function isAccrualOverrideReason(reason: unknown): boolean {
  return getAccrualOverrideFieldFromReason(reason) !== null;
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const authorized = await hasHrAccess(userId);
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const requestedStatus = String(searchParams.get("status") || "").toLowerCase();

    let query = supabaseAdmin
      .from("sick_leaves")
      .select(
        "id, user_id, start_date, end_date, duration_hours, status, reason, approved_by, approved_at, created_at, updated_at"
      )
      .order("start_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (VALID_STATUSES.has(requestedStatus)) {
      query = query.eq("status", requestedStatus);
    }

    const { data: sickLeaves, error: sickLeaveError } = await query;
    if (sickLeaveError) {
      return NextResponse.json(
        { error: sickLeaveError.message || "Failed to fetch sick leave records" },
        { status: 500 }
      );
    }

    const profileMap = new Map<string, ProfileSummary>();
    const { data: activeUsers, error: activeUsersError } = await supabaseAdmin
      .from("users")
      .select(
        `
          id,
          email,
          created_at,
          profiles (
            first_name,
            last_name,
            state,
            city
          )
        `
      )
      .eq("is_active", true);

    if (activeUsersError) {
      return NextResponse.json(
        { error: activeUsersError.message || "Failed to fetch active users" },
        { status: 500 }
      );
    }

    for (const user of (activeUsers || []) as UserWithProfile[]) {
      upsertProfile(profileMap, user);
    }

    const visibleSickLeaves = (sickLeaves || []).filter(
      (row: any) => !isAccrualOverrideReason(row?.reason)
    );

    const recordUserIds = [
      ...new Set(visibleSickLeaves.map((row: any) => String(row.user_id || "")).filter(Boolean)),
    ];
    const missingRecordUserIds = recordUserIds.filter((id) => !profileMap.has(id));
    for (const chunk of chunkArray(missingRecordUserIds, QUERY_CHUNK_SIZE)) {
      const { data: missingUsers, error: missingUsersError } = await supabaseAdmin
        .from("users")
        .select(
          `
            id,
            email,
            created_at,
            profiles (
              first_name,
              last_name,
              state,
              city
            )
          `
        )
        .in("id", chunk);

      if (missingUsersError) {
        return NextResponse.json(
          { error: missingUsersError.message || "Failed to fetch employee profiles" },
          { status: 500 }
        );
      }
      for (const user of (missingUsers || []) as UserWithProfile[]) {
        upsertProfile(profileMap, user);
      }
    }

    const records = visibleSickLeaves.map((row: any) => {
      const profile = profileMap.get(row.user_id);
      return {
        id: row.id,
        user_id: row.user_id,
        start_date: row.start_date,
        end_date: row.end_date,
        duration_hours: Number(row.duration_hours || 0),
        status: normalizeStatus(row.status),
        reason: row.reason ?? null,
        approved_by: row.approved_by ?? null,
        approved_at: row.approved_at ?? null,
        created_at: row.created_at ?? null,
        updated_at: row.updated_at ?? null,
        employee_name: profile?.employee_name || "Unknown",
        employee_email: profile?.employee_email || "",
        employee_state: profile?.employee_state ?? null,
        employee_city: profile?.employee_city ?? null,
      };
    });

    const stats = records.reduce(
      (acc, row) => {
        acc.total += 1;
        acc.total_hours += Number(row.duration_hours || 0);
        if (row.status === "pending") acc.pending += 1;
        if (row.status === "approved") acc.approved += 1;
        if (row.status === "denied") acc.denied += 1;
        return acc;
      },
      { total: 0, pending: 0, approved: 0, denied: 0, total_hours: 0 }
    );

    stats.total_hours = Number(stats.total_hours.toFixed(2));

    const now = new Date();
    const currentYearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));

    const activeUserIds = [
      ...new Set((activeUsers || []).map((u: any) => String(u.id || "")).filter(Boolean)),
    ];
    const vendorEventIdsByUser = new Map<string, Set<string>>();
    for (const chunk of chunkArray(activeUserIds, QUERY_CHUNK_SIZE)) {
      let from = 0;
      while (true) {
        const { data: teams, error: teamsError } = await supabaseAdmin
          .from("event_teams")
          .select("vendor_id, event_id")
          .in("vendor_id", chunk)
          .range(from, from + QUERY_PAGE_SIZE - 1);

        if (teamsError) {
          return NextResponse.json(
            { error: teamsError.message || "Failed to fetch event team data" },
            { status: 500 }
          );
        }
        if (!teams || teams.length === 0) break;

        for (const team of teams as Array<{ vendor_id: string; event_id: string | null }>) {
          if (!team.vendor_id || !team.event_id) continue;
          const existing = vendorEventIdsByUser.get(team.vendor_id) ?? new Set<string>();
          existing.add(team.event_id);
          vendorEventIdsByUser.set(team.vendor_id, existing);
        }

        if (teams.length < QUERY_PAGE_SIZE) break;
        from += QUERY_PAGE_SIZE;
      }
    }

    const usersWithEventTeams = activeUserIds.filter((id) => {
      const ids = vendorEventIdsByUser.get(id);
      return !!ids && ids.size > 0;
    });

    const entriesByUserEvent = new Map<string, Array<{ action: string; timestamp: string }>>();
    for (const chunk of chunkArray(usersWithEventTeams, QUERY_CHUNK_SIZE)) {
      let from = 0;
      while (true) {
        const { data: timeRows, error: timeRowsError } = await supabaseAdmin
          .from("time_entries")
          .select("user_id, event_id, action, timestamp")
          .in("user_id", chunk)
          .in("action", ["clock_in", "clock_out"])
          .order("timestamp", { ascending: true })
          .range(from, from + QUERY_PAGE_SIZE - 1);

        if (timeRowsError) {
          return NextResponse.json(
            { error: timeRowsError.message || "Failed to fetch time entries" },
            { status: 500 }
          );
        }
        if (!timeRows || timeRows.length === 0) break;

        for (const row of timeRows as Array<{
          user_id: string | null;
          event_id: string | null;
          action: string | null;
          timestamp: string | null;
        }>) {
          if (!row.user_id || !row.event_id || !row.timestamp || !row.action) continue;
          const userEventIds = vendorEventIdsByUser.get(row.user_id);
          if (!userEventIds?.has(row.event_id)) continue;

          const action = String(row.action).toLowerCase();
          if (action !== "clock_in" && action !== "clock_out") continue;

          const key = `${row.user_id}::${row.event_id}`;
          const existing = entriesByUserEvent.get(key) ?? [];
          existing.push({ action, timestamp: row.timestamp });
          entriesByUserEvent.set(key, existing);
        }

        if (timeRows.length < QUERY_PAGE_SIZE) break;
        from += QUERY_PAGE_SIZE;
      }
    }

    const workedHoursByUser = new Map<string, number>();
    const workedHoursYtdByUser = new Map<string, number>();
    for (const [key, entries] of entriesByUserEvent.entries()) {
      const [entryUserId] = key.split("::");
      entries.sort((a, b) => {
        const aTime = new Date(a.timestamp).getTime();
        const bTime = new Date(b.timestamp).getTime();
        if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0;
        return aTime - bTime;
      });

      let clockIn: string | null = null;
      let totalForUserEvent = 0;
      let totalForUserEventYtd = 0;
      for (const row of entries) {
        if (row.action === "clock_in") {
          clockIn = row.timestamp;
          continue;
        }
        if (row.action === "clock_out" && clockIn) {
          const shiftHours = hoursBetween(clockIn, row.timestamp);
          totalForUserEvent += shiftHours;
          const clockOutAt = toDateSafe(row.timestamp);
          if (clockOutAt && clockOutAt >= currentYearStart) {
            totalForUserEventYtd += shiftHours;
          }
          clockIn = null;
        }
      }

      workedHoursByUser.set(
        entryUserId,
        (workedHoursByUser.get(entryUserId) || 0) + totalForUserEvent
      );
      workedHoursYtdByUser.set(
        entryUserId,
        (workedHoursYtdByUser.get(entryUserId) || 0) + totalForUserEventYtd
      );
    }

    const sickHoursByUser = new Map<string, number>();
    const sickHoursBeforeYearByUser = new Map<string, number>();
    const sickRequestCountByUser = new Map<string, number>();
    const carryOverOverrideByUser = new Map<string, { hours: number; ts: number }>();
    const yearToDateOverrideByUser = new Map<string, { hours: number; ts: number }>();
    for (const chunk of chunkArray(activeUserIds, QUERY_CHUNK_SIZE)) {
      let from = 0;
      while (true) {
        const { data: sickRows, error: sickRowsError } = await supabaseAdmin
          .from("sick_leaves")
          .select("user_id, duration_hours, status, start_date, approved_at, created_at, updated_at, reason")
          .in("user_id", chunk)
          .range(from, from + QUERY_PAGE_SIZE - 1);

        if (sickRowsError) {
          return NextResponse.json(
            { error: sickRowsError.message || "Failed to fetch sick leave totals" },
            { status: 500 }
          );
        }
        if (!sickRows || sickRows.length === 0) break;

        for (const row of sickRows as Array<{
          user_id: string | null;
          duration_hours: number | string | null;
          status: string | null;
          start_date: string | null;
          approved_at: string | null;
          created_at: string | null;
          updated_at: string | null;
          reason: string | null;
        }>) {
          if (!row.user_id) continue;

          const overrideField = getAccrualOverrideFieldFromReason(row.reason);
          if (overrideField) {
            const overrideHours = Number(row.duration_hours || 0);
            const ts =
              toDateSafe(row.updated_at)?.getTime() ||
              toDateSafe(row.created_at)?.getTime() ||
              toDateSafe(row.approved_at)?.getTime() ||
              toDateSafe(row.start_date)?.getTime() ||
              0;
            const targetMap =
              overrideField === "carry_over"
                ? carryOverOverrideByUser
                : yearToDateOverrideByUser;
            const prev = targetMap.get(row.user_id);
            if (!prev || ts >= prev.ts) {
              targetMap.set(row.user_id, { hours: Number(overrideHours.toFixed(2)), ts });
            }
            continue;
          }

          sickRequestCountByUser.set(row.user_id, (sickRequestCountByUser.get(row.user_id) || 0) + 1);
          if (normalizeStatus(row.status) !== "approved") continue;

          const duration = Number(row.duration_hours || 0);
          sickHoursByUser.set(row.user_id, (sickHoursByUser.get(row.user_id) || 0) + duration);
          const usedAt =
            toDateSafe(row.start_date) ||
            toDateSafe(row.approved_at) ||
            toDateSafe(row.created_at);
          if (!usedAt || usedAt < currentYearStart) {
            sickHoursBeforeYearByUser.set(
              row.user_id,
              (sickHoursBeforeYearByUser.get(row.user_id) || 0) + duration
            );
          }
        }

        if (sickRows.length < QUERY_PAGE_SIZE) break;
        from += QUERY_PAGE_SIZE;
      }
    }

    const accruals = activeUserIds
      .map((id) => {
        const profile = profileMap.get(id);
        const worked_hours = Number((workedHoursByUser.get(id) || 0).toFixed(3));
        const worked_hours_ytd = Number((workedHoursYtdByUser.get(id) || 0).toFixed(3));
        const worked_hours_before_year = Number(Math.max(0, worked_hours - worked_hours_ytd).toFixed(3));
        const base_year_to_date_hours = Number(
          (worked_hours_ytd / SICK_LEAVE_ACCRUAL_HOURS_WORKED).toFixed(2)
        );
        const accrued_hours_before_year = Number(
          (worked_hours_before_year / SICK_LEAVE_ACCRUAL_HOURS_WORKED).toFixed(2)
        );
        const used_hours = Number((sickHoursByUser.get(id) || 0).toFixed(2));
        const used_hours_before_year = Number((sickHoursBeforeYearByUser.get(id) || 0).toFixed(2));
        const base_carry_over_hours = Number(
          Math.max(0, accrued_hours_before_year - used_hours_before_year).toFixed(2)
        );
        const carry_over_hours = Number(
          Math.max(0, carryOverOverrideByUser.get(id)?.hours ?? base_carry_over_hours).toFixed(2)
        );
        const year_to_date_hours = Number(
          Math.max(0, yearToDateOverrideByUser.get(id)?.hours ?? base_year_to_date_hours).toFixed(2)
        );
        const accrued_hours = Number(
          (carry_over_hours + year_to_date_hours).toFixed(2)
        );
        const balance_hours = Number(Math.max(0, accrued_hours - used_hours).toFixed(2));
        const accrued_days = Number((accrued_hours / HOURS_PER_WORKDAY).toFixed(2));
        const year_to_date_days = Number((year_to_date_hours / HOURS_PER_WORKDAY).toFixed(2));
        const carry_over_days = Number((carry_over_hours / HOURS_PER_WORKDAY).toFixed(2));
        const used_days = Number((used_hours / HOURS_PER_WORKDAY).toFixed(2));
        const balance_days = Number((balance_hours / HOURS_PER_WORKDAY).toFixed(2));
        const accrued_months = fullMonthsBetween(profile?.hire_date || null);
        return {
          user_id: id,
          employee_name: profile?.employee_name || "Unknown",
          employee_email: profile?.employee_email || "",
          employee_state: profile?.employee_state ?? null,
          employee_city: profile?.employee_city ?? null,
          worked_hours,
          accrued_months,
          accrued_hours,
          accrued_days,
          carry_over_hours,
          carry_over_days,
          year_to_date_hours,
          year_to_date_days,
          used_hours,
          used_days,
          balance_hours,
          balance_days,
          request_count: sickRequestCountByUser.get(id) || 0,
        };
      })
      .filter((row) => row.accrued_hours > 0)
      .sort((a, b) =>
        a.employee_name.localeCompare(b.employee_name, undefined, { sensitivity: "base" })
      );

    const accrual_stats = accruals.reduce(
      (acc, row) => {
        acc.employees_with_earned_hours += 1;
        acc.total_accrued_hours += row.accrued_hours;
        acc.total_balance_hours += row.balance_hours;
        return acc;
      },
      {
        employees_with_earned_hours: 0,
        total_accrued_hours: 0,
        total_balance_hours: 0,
      }
    );
    accrual_stats.total_accrued_hours = Number(accrual_stats.total_accrued_hours.toFixed(2));
    accrual_stats.total_balance_hours = Number(accrual_stats.total_balance_hours.toFixed(2));

    return NextResponse.json({ records, stats, accruals, accrual_stats }, { status: 200 });
  } catch (err: any) {
    console.error("[HR SICK LEAVES][GET] error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const authorized = await hasHrAccess(userId);
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await req.json();
    const id = String(body?.id || "").trim();
    const rawStatus = String(body?.status || "").toLowerCase();

    if (!id) {
      return NextResponse.json({ error: "Sick leave id is required" }, { status: 400 });
    }

    if (!VALID_STATUSES.has(rawStatus)) {
      return NextResponse.json(
        { error: "Invalid status. Allowed: pending, approved, denied" },
        { status: 400 }
      );
    }

    const status = rawStatus as SickLeaveStatus;

    const updates: Record<string, any> = { status };
    if (status === "approved") {
      updates.approved_by = userId;
      updates.approved_at = new Date().toISOString();
    } else {
      updates.approved_by = null;
      updates.approved_at = null;
    }

    const { data, error } = await supabaseAdmin
      .from("sick_leaves")
      .update(updates)
      .eq("id", id)
      .select("id, user_id, status, approved_by, approved_at, updated_at")
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to update sick leave record" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        message: "Sick leave status updated",
        record: data,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[HR SICK LEAVES][PATCH] error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const authorized = await hasHrAccess(userId);
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await req.json();
    const targetUserId = String(body?.user_id || "").trim();
    const operationRaw = String(body?.operation || "add").toLowerCase();
    const operation =
      operationRaw === "remove"
        ? "remove"
        : operationRaw === "set_adjustment"
          ? "set_adjustment"
          : "add";

    if (!targetUserId) {
      return NextResponse.json({ error: "user_id is required" }, { status: 400 });
    }

    if (operation === "set_adjustment") {
      const adjustmentFieldRaw = String(
        body?.adjustment_field || body?.field || ""
      ).toLowerCase();
      if (adjustmentFieldRaw !== "carry_over" && adjustmentFieldRaw !== "year_to_date") {
        return NextResponse.json(
          { error: "adjustment_field must be one of: carry_over, year_to_date" },
          { status: 400 }
        );
      }

      const targetHoursRaw = Number(
        body?.target_hours ?? body?.hours ?? body?.duration_hours ?? 0
      );
      const targetHours = Number(targetHoursRaw.toFixed(2));
      if (!Number.isFinite(targetHours) || targetHours < 0) {
        return NextResponse.json(
          { error: "target_hours must be a number greater than or equal to 0" },
          { status: 400 }
        );
      }

      const marker =
        adjustmentFieldRaw === "carry_over"
          ? CARRY_OVER_OVERRIDE_REASON_MARKER
          : YEAR_TO_DATE_OVERRIDE_REASON_MARKER;
      const today = new Date().toISOString().slice(0, 10);
      const nowIso = new Date().toISOString();

      const { error: deleteError } = await supabaseAdmin
        .from("sick_leaves")
        .delete()
        .eq("user_id", targetUserId)
        .ilike("reason", `%${marker}%`);

      if (deleteError) {
        return NextResponse.json(
          { error: deleteError.message || "Failed to clear previous accrual override" },
          { status: 500 }
        );
      }

      if (targetHours > 0) {
        const reason = `${marker}: Manual accrual override from HR dashboard`;
        const { error: insertError } = await supabaseAdmin.from("sick_leaves").insert({
          user_id: targetUserId,
          start_date: today,
          end_date: today,
          duration_hours: targetHours,
          status: "approved",
          reason,
          approved_by: userId,
          approved_at: nowIso,
        });

        if (insertError) {
          return NextResponse.json(
            { error: insertError.message || "Failed to save accrual override" },
            { status: 500 }
          );
        }
      }

      return NextResponse.json(
        {
          message: "Sick leave accrual override saved",
          user_id: targetUserId,
          adjustment_field: adjustmentFieldRaw,
          target_hours: targetHours,
        },
        { status: 200 }
      );
    }

    const rawHours = Number(body?.duration_hours ?? body?.hours ?? 0);
    const durationHours = Number(rawHours.toFixed(2));
    const reasonRaw = String(body?.reason || "").trim();
    const reasonBase =
      reasonRaw.length > 0 ? reasonRaw : "Manual used-hours entry from HR dashboard";
    const reason = `${MANUAL_USED_HOURS_REASON_MARKER}: ${reasonBase}`;

    if (!Number.isFinite(durationHours) || durationHours <= 0) {
      return NextResponse.json(
        { error: "duration_hours must be a positive number" },
        { status: 400 }
      );
    }

    if (operation === "remove") {
      const { data: manualRows, error: manualRowsError } = await supabaseAdmin
        .from("sick_leaves")
        .select("id, duration_hours, created_at, reason")
        .eq("user_id", targetUserId)
        .eq("status", "approved")
        .or(
          `reason.ilike.%${MANUAL_USED_HOURS_REASON_MARKER}%,reason.ilike.%Manual used-hours entry from HR dashboard%`
        )
        .order("created_at", { ascending: false });

      if (manualRowsError) {
        return NextResponse.json(
          { error: manualRowsError.message || "Failed to load manual used-hour entries" },
          { status: 500 }
        );
      }

      const availableManualHours = Number(
        (manualRows || []).reduce((sum: number, row: any) => sum + Number(row.duration_hours || 0), 0).toFixed(2)
      );

      if (availableManualHours + 1e-9 < durationHours) {
        return NextResponse.json(
          {
            error: `Cannot remove ${durationHours.toFixed(2)} hours. Only ${availableManualHours.toFixed(2)} manually added used hours are available to remove.`,
          },
          { status: 400 }
        );
      }

      let remainingToRemove = durationHours;
      for (const row of manualRows || []) {
        if (remainingToRemove <= 0) break;
        const rowHours = Number(row.duration_hours || 0);
        if (!Number.isFinite(rowHours) || rowHours <= 0) continue;

        if (rowHours <= remainingToRemove + 1e-9) {
          const { error: deleteError } = await supabaseAdmin
            .from("sick_leaves")
            .delete()
            .eq("id", row.id);

          if (deleteError) {
            return NextResponse.json(
              { error: deleteError.message || "Failed to remove used-hour entry" },
              { status: 500 }
            );
          }
          remainingToRemove = Number(Math.max(0, remainingToRemove - rowHours).toFixed(2));
          continue;
        }

        const updatedDuration = Number((rowHours - remainingToRemove).toFixed(2));
        const { error: updateError } = await supabaseAdmin
          .from("sick_leaves")
          .update({
            duration_hours: updatedDuration,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);

        if (updateError) {
          return NextResponse.json(
            { error: updateError.message || "Failed to update used-hour entry" },
            { status: 500 }
          );
        }

        remainingToRemove = 0;
        break;
      }

      if (remainingToRemove > 0) {
        return NextResponse.json(
          { error: "Failed to fully remove requested used hours. Please retry." },
          { status: 500 }
        );
      }

      return NextResponse.json(
        {
          message: "Used sick leave hours removed",
          removed_hours: durationHours,
        },
        { status: 200 }
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("sick_leaves")
      .insert({
        user_id: targetUserId,
        start_date: today,
        end_date: today,
        duration_hours: durationHours,
        status: "approved",
        reason,
        approved_by: userId,
        approved_at: nowIso,
      })
      .select(
        "id, user_id, start_date, end_date, duration_hours, status, reason, approved_by, approved_at, created_at, updated_at"
      )
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to add used sick leave hours" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: "Used sick leave hours added", record: data },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[HR SICK LEAVES][POST] error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
