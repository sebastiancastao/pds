// app/api/reports/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { safeDecrypt } from "@/lib/encryption";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ALLOWED_ROLES = ["manager", "supervisor", "supervisor2", "hr", "exec"];

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  let { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser } = await supabase.auth.getUser(token);
    if (tokenUser?.user?.id) return tokenUser.user;
  }
  return null;
}

function dec(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try { return safeDecrypt(value.trim()); } catch { return value.trim(); }
}

/**
 * GET /api/reports
 * Query params:
 *   section  = users | events | time | background | all  (default: all)
 *   from     = YYYY-MM-DD  (event/time filter start)
 *   to       = YYYY-MM-DD  (event/time filter end)
 *   state    = state code filter
 */
export async function GET(req: NextRequest) {
  try {
    const authedUser = await getAuthedUser(req);
    if (!authedUser?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Role check
    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", authedUser.id)
      .maybeSingle();

    const role = (userData?.role || "").toLowerCase().trim();
    if (!ALLOWED_ROLES.includes(role)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const section = searchParams.get("section") || "all";
    const fromDate = searchParams.get("from") || null;
    const toDate = searchParams.get("to") || null;
    const stateFilter = searchParams.get("state") || null;

    const result: Record<string, any> = {};

    // ─────────────────────────────────────────────
    // USERS SECTION
    // ─────────────────────────────────────────────
    if (section === "all" || section === "users") {
      let usersQuery = supabaseAdmin
        .from("users")
        .select(`
          id,
          email,
          role,
          division,
          is_active,
          created_at,
          background_check_completed,
          profiles (
            id,
            first_name,
            last_name,
            phone,
            city,
            state,
            zip_code,
            address,
            region_id,
            latitude,
            longitude,
            onboarding_completed_at
          )
        `)
        .order("created_at", { ascending: false });

      if (stateFilter && stateFilter !== "all") {
        usersQuery = usersQuery.eq("profiles.state", stateFilter);
      }

      const { data: users, error: usersError } = await usersQuery;
      if (usersError) throw new Error(usersError.message);

      // Build profile_id -> user_id map from the users we already fetched
      const profileIdToUserId = new Map<string, string>();
      (users || []).forEach((u: any) => {
        const p = Array.isArray(u.profiles) ? u.profiles[0] : u.profiles;
        if (p?.id) profileIdToUserId.set(p.id, u.id);
      });

      // Background checks — keyed by profile_id
      const { data: bgChecks } = await supabaseAdmin
        .from("vendor_background_checks")
        .select("profile_id, background_check_completed, completed_date, notes, updated_at");

      const bgByUser = new Map<string, any>();
      (bgChecks || []).forEach((b: any) => {
        const uid = profileIdToUserId.get(b.profile_id);
        if (uid) bgByUser.set(uid, b);
      });

      // Onboarding status — vendor_onboarding_status keyed by profile_id
      const { data: onboardingRows } = await supabaseAdmin
        .from("vendor_onboarding_status")
        .select("profile_id, onboarding_completed, completed_date");

      const onboardingByUser = new Map<string, any>();
      (onboardingRows || []).forEach((o: any) => {
        const uid = profileIdToUserId.get(o.profile_id);
        if (uid && !onboardingByUser.has(uid)) onboardingByUser.set(uid, o);
      });

      // Attestation data — driven by time_entries.attestation_accepted (same source as the UI).
      // attestation_rejections is used only to enrich rejected rows with reason/notes.
      const allUserIds = (users || []).map((u: any) => u.id).filter(Boolean);
      const attestationsByUser = new Map<string, any[]>();

      if (allUserIds.length > 0) {
        // All clock-outs with an explicit attestation decision
        const { data: attestEntries } = await supabaseAdmin
          .from("time_entries")
          .select("id, user_id, event_id, timestamp, attestation_accepted")
          .in("user_id", allUserIds)
          .eq("action", "clock_out")
          .not("attestation_accepted", "is", null);

        const attestEntryIds = (attestEntries || [])
          .filter((e: any) => e.attestation_accepted === false)
          .map((e: any) => e.id)
          .filter(Boolean);

        // Fetch rejection reasons for the rejected entries
        const rejectionByEntryId = new Map<string, any>();
        if (attestEntryIds.length > 0) {
          const { data: rejections } = await supabaseAdmin
            .from("attestation_rejections")
            .select("time_entry_id, rejection_reason, rejection_notes")
            .in("time_entry_id", attestEntryIds);
          (rejections || []).forEach((r: any) => {
            if (r.time_entry_id) rejectionByEntryId.set(r.time_entry_id, r);
          });
        }

        (attestEntries || []).forEach((entry: any) => {
          if (!entry.user_id) return;
          if (!attestationsByUser.has(entry.user_id)) attestationsByUser.set(entry.user_id, []);
          const isRejected = entry.attestation_accepted === false;
          const rejection = isRejected ? rejectionByEntryId.get(entry.id) : undefined;
          attestationsByUser.get(entry.user_id)!.push({
            time_entry_id: entry.id,
            event_id: entry.event_id || null,
            timestamp: entry.timestamp,
            accepted: !isRejected,
            rejection_reason: rejection?.rejection_reason || null,
            rejection_notes: rejection?.rejection_notes || null,
          });
        });
      }

      const mappedUsers = (users || []).map((u: any) => {
        const profile = Array.isArray(u.profiles) ? u.profiles[0] : u.profiles;
        const bg = bgByUser.get(u.id);
        const onboarding = onboardingByUser.get(u.id);
        const attestations = attestationsByUser.get(u.id) || [];
        const attestationAcceptedCount = attestations.filter((a: any) => a.accepted === true).length;
        const attestationRejectedCount = attestations.filter((a: any) => a.accepted === false).length;
        return {
          id: u.id,
          email: u.email || "",
          role: u.role || "",
          division: u.division || "",
          is_active: u.is_active,
          created_at: u.created_at,
          first_name: dec(profile?.first_name),
          last_name: dec(profile?.last_name),
          phone: dec(profile?.phone),
          city: dec(profile?.city),
          state: dec(profile?.state),
          zip_code: dec(profile?.zip_code),
          address: dec(profile?.address),
          region_id: profile?.region_id || null,
          has_coordinates: !!(profile?.latitude && profile?.longitude),
          background_check_completed: u.background_check_completed || bg?.background_check_completed || false,
          background_check_date: bg?.completed_date || null,
          onboarding_submitted: !!(profile?.onboarding_completed_at),
          onboarding_approved: onboarding?.onboarding_completed || false,
          onboarding_submitted_at: profile?.onboarding_completed_at || null,
          onboarding_approved_at: onboarding?.completed_date || null,
          attestation_total: attestations.length,
          attestation_accepted_count: attestationAcceptedCount,
          attestation_rejected_count: attestationRejectedCount,
          attestations,
        };
      });

      // Aggregate stats
      const byRole: Record<string, number> = {};
      const byState: Record<string, number> = {};
      const byDivision: Record<string, number> = {};
      let activeCount = 0;
      let inactiveCount = 0;
      let bgCompleted = 0;
      let onboardingApproved = 0;
      let usersWithRejections = 0;

      for (const u of mappedUsers) {
        byRole[u.role || "unknown"] = (byRole[u.role || "unknown"] || 0) + 1;
        if (u.state) byState[u.state] = (byState[u.state] || 0) + 1;
        if (u.division) byDivision[u.division] = (byDivision[u.division] || 0) + 1;
        if (u.is_active) activeCount++; else inactiveCount++;
        if (u.background_check_completed) bgCompleted++;
        if (u.onboarding_approved) onboardingApproved++;
        if (u.attestation_rejected_count > 0) usersWithRejections++;
      }

      result.users = {
        total: mappedUsers.length,
        active: activeCount,
        inactive: inactiveCount,
        background_check_completed: bgCompleted,
        onboarding_approved: onboardingApproved,
        users_with_attestation_rejections: usersWithRejections,
        by_role: byRole,
        by_state: byState,
        by_division: byDivision,
        rows: mappedUsers,
      };
    }

    // ─────────────────────────────────────────────
    // EVENTS SECTION
    // ─────────────────────────────────────────────
    if (section === "all" || section === "events") {
      let eventsQuery = supabaseAdmin
        .from("events")
        .select(`
          id,
          event_name,
          artist,
          venue,
          city,
          state,
          event_date,
          start_time,
          end_time,
          ends_next_day,
          ticket_sales,
          ticket_count,
          artist_share_percent,
          venue_share_percent,
          pds_share_percent,
          commission_pool,
          required_staff,
          confirmed_staff,
          is_active,
          created_at,
          tax_rate_percent
        `)
        .order("event_date", { ascending: false });

      if (fromDate) eventsQuery = eventsQuery.gte("event_date", fromDate);
      if (toDate) eventsQuery = eventsQuery.lte("event_date", toDate);
      if (stateFilter && stateFilter !== "all") eventsQuery = eventsQuery.eq("state", stateFilter);

      const { data: events, error: eventsError } = await eventsQuery;
      if (eventsError) throw new Error(eventsError.message);

      // Get team sizes per event
      const eventIds = (events || []).map((e: any) => e.id).filter(Boolean);
      let teamCounts = new Map<string, number>();

      if (eventIds.length > 0) {
        const { data: teamRows } = await supabaseAdmin
          .from("event_teams")
          .select("event_id, vendor_id, status")
          .in("event_id", eventIds);

        (teamRows || []).forEach((r: any) => {
          if (!r.event_id) return;
          teamCounts.set(r.event_id, (teamCounts.get(r.event_id) || 0) + 1);
        });
      }

      const mappedEvents = (events || []).map((e: any) => ({
        id: e.id,
        event_name: e.event_name || "",
        artist: e.artist || "",
        venue: e.venue || "",
        city: e.city || "",
        state: e.state || "",
        event_date: e.event_date || "",
        start_time: e.start_time || "",
        end_time: e.end_time || "",
        ends_next_day: e.ends_next_day || false,
        ticket_sales: e.ticket_sales ?? null,
        ticket_count: e.ticket_count ?? null,
        artist_share_percent: e.artist_share_percent ?? 0,
        venue_share_percent: e.venue_share_percent ?? 0,
        pds_share_percent: e.pds_share_percent ?? 0,
        commission_pool: e.commission_pool ?? null,
        tax_rate_percent: e.tax_rate_percent ?? null,
        required_staff: e.required_staff ?? null,
        confirmed_staff: e.confirmed_staff ?? null,
        assigned_staff: teamCounts.get(e.id) || 0,
        is_active: e.is_active,
        created_at: e.created_at,
      }));

      const totalRevenue = mappedEvents.reduce((sum: number, e: any) => sum + (e.ticket_sales || 0), 0);
      const totalCommission = mappedEvents.reduce((sum: number, e: any) => sum + (e.commission_pool || 0), 0);

      result.events = {
        total: mappedEvents.length,
        active: mappedEvents.filter((e: any) => e.is_active).length,
        total_ticket_sales: totalRevenue,
        total_commission_pool: totalCommission,
        rows: mappedEvents,
      };
    }

    // ─────────────────────────────────────────────
    // TIME ENTRIES SECTION
    // ─────────────────────────────────────────────
    if (section === "all" || section === "time") {
      // Mirror the vendor-payments API exactly:
      //   1. Filter EVENTS by event_date (same axis as HR dashboard payroll tab)
      //   2. For each (user, event): prefer freshly computed timesheet hours
      //   3. Fall back to stored actual_hours from event_vendor_payments when no time entries exist
      const GATE_PHONE_OFFSET_MS = 30 * 60 * 1000;

      // Step 1: events in the date range
      let eventsForTimeQuery = supabaseAdmin
        .from("events")
        .select("id")
        .order("event_date", { ascending: true });
      if (fromDate) eventsForTimeQuery = eventsForTimeQuery.gte("event_date", fromDate);
      if (toDate)   eventsForTimeQuery = eventsForTimeQuery.lte("event_date", toDate);
      if (stateFilter && stateFilter !== "all") eventsForTimeQuery = eventsForTimeQuery.eq("state", stateFilter);

      const { data: eventsForTime, error: eventsForTimeErr } = await eventsForTimeQuery;
      if (eventsForTimeErr) throw new Error(eventsForTimeErr.message);

      const scopedEventIds = (eventsForTime || []).map((e: any) => e.id).filter(Boolean);

      const hoursByUser    = new Map<string, number>();
      const shiftsByUser   = new Map<string, number>();
      const hoursByEvent   = new Map<string, number>();
      const workersByEvent = new Map<string, Set<string>>();
      let totalShifts = 0;

      if (scopedEventIds.length > 0) {
        // Step 2: fetch payment records + time entries for those events in parallel
        const [payRes, teRes] = await Promise.all([
          supabaseAdmin
            .from("event_vendor_payments")
            .select("event_id, user_id, actual_hours, regular_hours, overtime_hours, doubletime_hours")
            .in("event_id", scopedEventIds),
          supabaseAdmin
            .from("time_entries")
            .select("id, user_id, event_id, action, timestamp")
            .in("event_id", scopedEventIds)
            .in("action", ["clock_in", "clock_out", "meal_start", "meal_end"])
            .order("timestamp", { ascending: true }),
        ]);
        if (payRes.error)  throw new Error(payRes.error.message);
        if (teRes.error)   throw new Error(teRes.error.message);

        const paymentRows = payRes.data || [];
        const timeEntries = teRes.data  || [];

        // Step 3: group time entries by (user, event) and compute timesheet hours
        const entriesBySession = new Map<string, any[]>();
        for (const row of timeEntries) {
          if (!row.user_id || !row.event_id) continue;
          const k = `${row.user_id}||${row.event_id}`;
          if (!entriesBySession.has(k)) entriesBySession.set(k, []);
          entriesBySession.get(k)!.push(row);
        }

        const computedBySession = new Map<string, number>();
        for (const [key, rows] of entriesBySession.entries()) {
          const sorted = [...rows].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
          const mealStarts = sorted.filter(r => r.action === "meal_start");
          const mealEnds   = sorted.filter(r => r.action === "meal_end");

          let apiTotalMs = 0;
          const workIntervals: Array<{ start: Date; end: Date }> = [];
          let curIn: string | null = null;
          for (const row of sorted) {
            if (row.action === "clock_in") {
              if (!curIn) curIn = row.timestamp;
            } else if (row.action === "clock_out" && curIn) {
              const s = new Date(curIn).getTime();
              const e = new Date(row.timestamp).getTime();
              if (e > s) { apiTotalMs += e - s; workIntervals.push({ start: new Date(curIn), end: new Date(row.timestamp) }); }
              curIn = null;
            }
          }

          if (workIntervals.length === 0) { computedBySession.set(key, 0); continue; }

          workIntervals.sort((a, b) => a.start.getTime() - b.start.getTime());
          const firstInMs = workIntervals[0].start.getTime();
          const lastOutMs = workIntervals[workIntervals.length - 1].end.getTime();

          let mealMs = 0;
          if (mealStarts.length > 0 || mealEnds.length > 0) {
            for (let i = 0; i < Math.min(mealStarts.length, mealEnds.length, 3); i++) {
              const ms = new Date(mealStarts[i].timestamp).getTime();
              const me = new Date(mealEnds[i].timestamp).getTime();
              if (me > ms) mealMs += me - ms;
            }
          } else if (workIntervals.length >= 2) {
            for (let i = 0; i < workIntervals.length - 1 && i < 3; i++) {
              const g = workIntervals[i + 1].start.getTime() - workIntervals[i].end.getTime();
              if (g > 0) mealMs += g;
            }
          }

          let spanNetMs = lastOutMs > firstInMs ? Math.max(lastOutMs - firstInMs - mealMs, 0) : 0;
          let finalMs = 0;
          if (apiTotalMs > 0 && spanNetMs > 0) finalMs = Math.min(apiTotalMs, spanNetMs);
          else if (spanNetMs > 0) finalMs = spanNetMs;
          else if (apiTotalMs > 0) finalMs = Math.max(apiTotalMs - mealMs, 0);

          if (finalMs > 0) finalMs += GATE_PHONE_OFFSET_MS;
          computedBySession.set(key, Math.round(Math.max(finalMs, 0) / 3600000 * 100) / 100);
        }

        // Step 4: build payment lookup; helper mirrors getEffectiveHoursFromPaymentRow
        const payByKey = new Map<string, any>();
        for (const row of paymentRows) {
          if (!row.user_id || !row.event_id) continue;
          payByKey.set(`${row.user_id}||${row.event_id}`, row);
        }
        function storedHours(row: any): number {
          const a = Number(row?.actual_hours  ?? 0); if (a > 0) return a;
          const s = Number(row?.regular_hours ?? 0) + Number(row?.overtime_hours ?? 0) + Number(row?.doubletime_hours ?? 0);
          return s > 0 ? s : 0;
        }

        // Step 5: merge — union of payment records and sessions with time entries
        const allKeys = new Set([...payByKey.keys(), ...entriesBySession.keys()]);
        for (const key of allKeys) {
          const [userId, eventId] = key.split("||");
          let finalHours: number;

          if (entriesBySession.has(key)) {
            // Time entries exist → use computed value (mirrors vendor-payments override)
            finalHours = computedBySession.get(key) ?? 0;
          } else {
            // No time entries → fall back to stored payment hours
            const row = payByKey.get(key);
            finalHours = row ? storedHours(row) : 0;
          }

          if (finalHours <= 0) continue;

          const numClockOuts = (entriesBySession.get(key) || []).filter((r: any) => r.action === "clock_out").length;
          const shifts = numClockOuts || 1;
          totalShifts += shifts;
          shiftsByUser.set(userId, (shiftsByUser.get(userId) || 0) + shifts);
          hoursByUser.set(userId,  (hoursByUser.get(userId)  || 0) + finalHours);
          hoursByEvent.set(eventId, (hoursByEvent.get(eventId) || 0) + finalHours);
          if (!workersByEvent.has(eventId)) workersByEvent.set(eventId, new Set());
          workersByEvent.get(eventId)!.add(userId);
        }
      }

      const totalHours = Array.from(hoursByUser.values()).reduce((sum, h) => sum + h, 0);
      result.time = {
        total_shifts: totalShifts,
        total_hours: Math.round(totalHours * 100) / 100,
        unique_workers: hoursByUser.size,
        hours_by_user: Object.fromEntries(
          Array.from(hoursByUser.entries()).map(([uid, h]) => [uid, Math.round(h * 100) / 100])
        ),
        shifts_by_user: Object.fromEntries(Array.from(shiftsByUser.entries())),
        hours_by_event: Object.fromEntries(
          Array.from(hoursByEvent.entries()).map(([eid, h]) => [eid, Math.round(h * 100) / 100])
        ),
        workers_by_event: Object.fromEntries(
          Array.from(workersByEvent.entries()).map(([eid, s]) => [eid, s.size])
        ),
      };
    }

    // ─────────────────────────────────────────────
    // BACKGROUND CHECKS SECTION
    // ─────────────────────────────────────────────
    if (section === "all" || section === "background") {
      const { data: bgRows, error: bgError } = await supabaseAdmin
        .from("vendor_background_checks")
        .select("id, profile_id, background_check_completed, completed_date, notes, updated_at")
        .order("updated_at", { ascending: false });

      if (bgError) throw new Error(bgError.message);

      const completed = (bgRows || []).filter((r: any) => r.background_check_completed).length;
      const pending = (bgRows || []).length - completed;

      result.background = {
        total: (bgRows || []).length,
        completed,
        pending,
        rows: bgRows || [],
      };
    }

    // ─────────────────────────────────────────────
    // LOGINS SECTION
    // ─────────────────────────────────────────────
    if (section === "all" || section === "login") {
      // Fetch all auth users (paginated, up to 1000)
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000, page: 1 });
      if (authError) throw new Error(authError.message);

      // Fetch profiles for names and roles
      const { data: profileRows } = await supabaseAdmin
        .from("users")
        .select("id, role, is_active, profiles(first_name, last_name)");

      const profileByAuthId = new Map<string, any>();
      (profileRows || []).forEach((u: any) => {
        const p = Array.isArray(u.profiles) ? u.profiles[0] : u.profiles;
        profileByAuthId.set(u.id, { role: u.role, is_active: u.is_active, profile: p });
      });

      const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;

      const loginRows = (authData?.users || []).map((au: any) => {
        const userData = profileByAuthId.get(au.id);
        const profile = userData?.profile;
        return {
          id: au.id,
          email: au.email || "",
          first_name: dec(profile?.first_name) || "",
          last_name: dec(profile?.last_name) || "",
          role: userData?.role || "",
          is_active: userData?.is_active ?? true,
          last_sign_in_at: au.last_sign_in_at || null,
          created_at: au.created_at || null,
        };
      }).sort((a: any, b: any) => {
        if (!a.last_sign_in_at) return 1;
        if (!b.last_sign_in_at) return -1;
        return new Date(b.last_sign_in_at).getTime() - new Date(a.last_sign_in_at).getTime();
      });

      result.logins = {
        total: loginRows.length,
        logged_in_recently: loginRows.filter((r: any) => r.last_sign_in_at && new Date(r.last_sign_in_at).getTime() > sevenDaysAgo).length,
        rows: loginRows,
      };
    }

    // ─────────────────────────────────────────────
    // REGIONS (always included for context)
    // ─────────────────────────────────────────────
    const { data: regions } = await supabaseAdmin
      .from("regions")
      .select("id, name, is_active")
      .order("name");

    result.regions = regions || [];

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error("[REPORTS] Error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
