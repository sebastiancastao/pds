import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import { safeDecrypt } from "@/lib/encryption";
import {
  EQUIPMENT_REIMBURSEMENT_AMOUNT,
  EQUIPMENT_REIMBURSEMENT_DESCRIPTION,
  EARLIEST_EQUIPMENT_PAY_DATE,
  payPeriodForPayDate,
} from "@/lib/equipment-reimbursement";

// Equipment reimbursement for the HR dashboard Payroll tab: a flat $20 a month
// for each checked onboarded account, paid on a pay date HR picks (any date).
// Worker accounts are the default list; staff accounts (exec, manager,
// supervisor...) carry staff: true and the panel shows them on request.
// Every person carries their profile region so the panel can group by region.
// GET lists the onboarded accounts and who is checked for a pay date; PUT saves
// the checked list for that pay date. A person can be checked for only one pay
// date per month (unique user_id + pay_month, pay_month = month of pay_date).
// Each row also stores the bi-weekly work period the pay date belongs to (the
// latest one that ended before it), which the Payroll tab uses.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const TABLE = "equipment_reimbursement_queue";
const HR_ROLES = new Set(["hr", "exec", "admin"]);
const VENDOR_DIVISIONS = ["vendor", "both", "trailers"];
const QUERY_CHUNK_SIZE = 150;
const INSERT_CHUNK_SIZE = 500;
const PAGE_SIZE = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getAuthenticatedUserId(req: NextRequest): Promise<string | null> {
  const supabase = createRouteHandlerClient({ cookies });
  let {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
    if (token) {
      const { data: tokenUser } = await supabaseAnon.auth.getUser(token);
      if (tokenUser?.user?.id) user = { id: tokenUser.user.id } as any;
    }
  }

  return user?.id || null;
}

async function requireHr(req: NextRequest): Promise<{ userId: string } | NextResponse> {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data, error } = await supabaseAdmin.from("users").select("role").eq("id", userId).single();
  if (error || !HR_ROLES.has(String(data?.role || "").toLowerCase())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  return { userId };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function safeDecryptName(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return safeDecrypt(raw).trim();
  } catch {
    return raw;
  }
}

type RegionShape = { id?: string | null; name?: string | null };
type ProfileShape = {
  id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  state?: string | null;
  onboarding_completed_at?: string | null;
  region_id?: string | null;
  regions?: RegionShape | RegionShape[] | null;
};
type UserRow = {
  id: string;
  email?: string | null;
  role?: string | null;
  division?: string | null;
  is_active?: boolean | null;
  profiles?: ProfileShape | ProfileShape[] | null;
};

type Person = {
  user_id: string;
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  state: string;
  // The profile's region (profiles.region_id), the same one the HR dashboard filters by.
  region_id: string;
  region_name: string;
  // Active and onboarded: may be checked. Others only appear when already
  // checked this month, so HR can see and uncheck them.
  eligible: boolean;
  // Why someone can't be checked: "inactive" (no longer active or onboarded).
  ineligible_reason: "" | "inactive";
  // A staff account (exec, manager, supervisor...), not a worker one. The panel
  // lists worker accounts by default and shows staff accounts on request.
  staff: boolean;
};

// Worker accounts are the default list (user request 2026-10-22). Staff
// accounts can still be checked when HR shows them (user 2026-10-23: some staff
// must be paid too). "employee" is the older name of the worker role (the ADP
// YTD import treats it the same), e.g. Katrina Gonzales's personal account.
const WORKER_ROLES = ["worker", "employee"];

const USER_SELECT =
  "id, email, role, division, is_active, profiles ( id, first_name, last_name, state, onboarding_completed_at, region_id, regions ( id, name ) )";

const profileOf = (u: UserRow): ProfileShape | null => (Array.isArray(u.profiles) ? u.profiles[0] || null : u.profiles || null);
const regionOf = (p: ProfileShape | null): RegionShape | null =>
  !p?.regions ? null : Array.isArray(p.regions) ? p.regions[0] || null : p.regions;

// Profiles an admin marked onboarding-complete in vendor_onboarding_status.
async function loadAdminCompletedProfileIds(profileIds: string[]): Promise<Set<string>> {
  const done = new Set<string>();
  for (const chunk of chunkArray(profileIds, QUERY_CHUNK_SIZE)) {
    const { data, error } = await supabaseAdmin
      .from("vendor_onboarding_status")
      .select("profile_id")
      .in("profile_id", chunk)
      .eq("onboarding_completed", true);
    if (error) throw new Error(error.message || "Failed to load onboarding status");
    for (const row of data || []) if (row?.profile_id) done.add(String(row.profile_id));
  }
  return done;
}

async function toPeople(users: UserRow[]): Promise<Person[]> {
  const profileIds = users.map((u) => profileOf(u)?.id).filter((id): id is string => Boolean(id));
  const adminCompleted = await loadAdminCompletedProfileIds(profileIds);
  return users.map((u) => {
    const profile = profileOf(u);
    const onboarded = Boolean(profile?.onboarding_completed_at) || Boolean(profile?.id && adminCompleted.has(profile.id));
    const firstName = safeDecryptName(profile?.first_name);
    const lastName = safeDecryptName(profile?.last_name);
    const name = `${firstName} ${lastName}`.trim();
    const region = regionOf(profile);
    const activeOnboarded =
      u.is_active !== false && VENDOR_DIVISIONS.includes(String(u.division || "").toLowerCase()) && onboarded;
    const isWorker = WORKER_ROLES.includes(String(u.role || "").trim().toLowerCase());
    return {
      user_id: u.id,
      name: name || String(u.email || "Unknown"),
      first_name: firstName,
      last_name: lastName,
      email: String(u.email || ""),
      role: String(u.role || ""),
      state: String(profile?.state || "").trim().toUpperCase(),
      region_id: String(profile?.region_id || region?.id || ""),
      region_name: String(region?.name || "").trim(),
      eligible: activeOnboarded,
      ineligible_reason: activeOnboarded ? "" : "inactive",
      staff: !isWorker,
    };
  });
}

// Every active account in a vendor division who has finished onboarding,
// worker and staff accounts alike (the panel decides which ones to show).
async function loadOnboardedVendors(): Promise<Person[]> {
  const users: UserRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("users")
      .select(USER_SELECT)
      .eq("is_active", true)
      .in("division", VENDOR_DIVISIONS)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message || "Failed to load vendors");
    users.push(...((data || []) as UserRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return (await toPeople(users)).filter((p) => p.eligible);
}

async function loadPeopleByIds(ids: string[]): Promise<Person[]> {
  const users: UserRow[] = [];
  for (const chunk of chunkArray(ids, QUERY_CHUNK_SIZE)) {
    const { data, error } = await supabaseAdmin.from("users").select(USER_SELECT).in("id", chunk);
    if (error) throw new Error(error.message || "Failed to load profiles");
    users.push(...((data || []) as UserRow[]));
  }
  return toPeople(users);
}

type MonthRow = { id: string; user_id: string; pay_date: string; pay_period_start: string; pay_period_end: string; amount: number };

async function loadMonthRows(month: string): Promise<MonthRow[]> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("id, user_id, pay_date, pay_period_start, pay_period_end, amount")
    .eq("pay_month", `${month}-01`);
  if (error) throw new Error(error.message || "Failed to load equipment reimbursements");
  return (data || []).map((r: any) => ({
    id: String(r.id),
    user_id: String(r.user_id),
    pay_date: String(r.pay_date),
    pay_period_start: String(r.pay_period_start),
    pay_period_end: String(r.pay_period_end),
    amount: Number(r.amount || 0),
  }));
}

const BAD_PAY_DATE = `pay_date must be a date (YYYY-MM-DD) on or after ${EARLIEST_EQUIPMENT_PAY_DATE}`;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Everyone with an equipment reimbursement in a pay period that lies fully
// inside [rangeStart, rangeEnd], for the Payroll tab views and exports.
async function getForPayrollRange(rangeStart: string, rangeEnd: string) {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("id, user_id, pay_date, pay_period_start, pay_period_end, amount")
    .gte("pay_period_start", rangeStart)
    .lte("pay_period_end", rangeEnd)
    .order("pay_period_start", { ascending: true });
  if (error) throw new Error(error.message || "Failed to load equipment reimbursements");
  const rows = data || [];
  const people = rows.length ? await loadPeopleByIds(Array.from(new Set(rows.map((r: any) => String(r.user_id))))) : [];
  const byId = new Map(people.map((p) => [p.user_id, p] as const));
  return rows
    .map((r: any) => {
      const p = byId.get(String(r.user_id));
      return {
        id: String(r.id),
        user_id: String(r.user_id),
        name: p?.name || "Unknown",
        first_name: p?.first_name || "",
        last_name: p?.last_name || "",
        email: p?.email || "",
        state: p?.state || "",
        role: p?.role || "",
        region_name: p?.region_name || "",
        pay_date: String(r.pay_date),
        pay_period_start: String(r.pay_period_start),
        pay_period_end: String(r.pay_period_end),
        amount: Number(r.amount || 0),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.pay_date.localeCompare(b.pay_date));
}

// GET ?pay_date=YYYY-MM-DD (any date; required, nothing is preselected)
// GET ?range_start=YYYY-MM-DD&range_end=YYYY-MM-DD -> { rows } for the payroll dates
export async function GET(req: NextRequest) {
  try {
    const auth = await requireHr(req);
    if (auth instanceof NextResponse) return auth;

    const params = new URL(req.url).searchParams;
    if (params.has("range_start") || params.has("range_end")) {
      const rangeStart = String(params.get("range_start") || "");
      const rangeEnd = String(params.get("range_end") || "");
      if (!ISO_DATE.test(rangeStart) || !ISO_DATE.test(rangeEnd) || rangeStart > rangeEnd) {
        return NextResponse.json({ error: "range_start and range_end must be YYYY-MM-DD, start first" }, { status: 400 });
      }
      return NextResponse.json({ rows: await getForPayrollRange(rangeStart, rangeEnd) });
    }

    const period = payPeriodForPayDate(String(params.get("pay_date") || "").trim());
    if (!period) return NextResponse.json({ error: BAD_PAY_DATE }, { status: 400 });

    const [vendors, monthRows] = await Promise.all([loadOnboardedVendors(), loadMonthRows(period.month)]);

    // People checked this month who are no longer active or onboarded still show,
    // so HR can see them and uncheck them.
    const listed = new Set(vendors.map((v) => v.user_id));
    const extraIds = Array.from(new Set(monthRows.map((r) => r.user_id).filter((id) => !listed.has(id))));
    const extras = extraIds.length ? (await loadPeopleByIds(extraIds)).filter((p) => !listed.has(p.user_id)) : [];

    const people = [...vendors, ...extras].sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      amount: EQUIPMENT_REIMBURSEMENT_AMOUNT,
      period,
      people,
      month_rows: monthRows,
    });
  } catch (err: any) {
    console.error("[EQUIPMENT REIMBURSEMENTS][GET]", err);
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
  }
}

// PUT { pay_date, user_ids: [...] } saves who is checked for that pay date.
// Newly checked people get a $20 row; unchecked people lose this pay date's row.
// People already checked for another pay date of the same month are skipped.
export async function PUT(req: NextRequest) {
  try {
    const auth = await requireHr(req);
    if (auth instanceof NextResponse) return auth;

    const body = await req.json().catch(() => ({}));
    const period = payPeriodForPayDate(String(body?.pay_date || "").trim());
    if (!period) return NextResponse.json({ error: BAD_PAY_DATE }, { status: 400 });
    const rawIds: unknown[] = Array.isArray(body?.user_ids) ? body.user_ids : [];
    const wanted = Array.from(new Set(rawIds.map((v) => String(v))));
    if (wanted.some((id) => !UUID_PATTERN.test(id))) {
      return NextResponse.json({ error: "user_ids must be a list of user ids" }, { status: 400 });
    }

    const monthRows = await loadMonthRows(period.month);
    const thisPeriod = monthRows.filter((r) => r.pay_date === period.payDate);
    const otherPeriod = new Map(
      monthRows.filter((r) => r.pay_date !== period.payDate).map((r) => [r.user_id, r] as const),
    );
    const wantedSet = new Set(wanted);
    const current = new Set(thisPeriod.map((r) => r.user_id));

    const toRemove = thisPeriod.filter((r) => !wantedSet.has(r.user_id)).map((r) => r.id);
    const addCandidates = wanted.filter((id) => !current.has(id));

    const people = addCandidates.length ? await loadPeopleByIds(addCandidates) : [];
    const personById = new Map(people.map((p) => [p.user_id, p] as const));
    const skippedOtherPeriod: string[] = [];
    const skippedIneligible: string[] = [];
    const toAdd: string[] = [];
    for (const id of addCandidates) {
      const person = personById.get(id);
      if (!person || !person.eligible) {
        skippedIneligible.push(person?.name || id);
      } else if (otherPeriod.has(id)) {
        skippedOtherPeriod.push(person.name);
      } else {
        toAdd.push(id);
      }
    }

    let removed = 0;
    if (toRemove.length) {
      const { data, error } = await supabaseAdmin.from(TABLE).delete().in("id", toRemove).select("id");
      if (error) return NextResponse.json({ error: error.message || "Failed to uncheck vendors" }, { status: 500 });
      removed = (data || []).length;
    }

    let added = 0;
    for (const chunk of chunkArray(toAdd, INSERT_CHUNK_SIZE)) {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .insert(
          chunk.map((userId) => ({
            user_id: userId,
            pay_month: `${period.month}-01`,
            pay_date: period.payDate,
            pay_period_start: period.start,
            pay_period_end: period.end,
            amount: EQUIPMENT_REIMBURSEMENT_AMOUNT,
            description: EQUIPMENT_REIMBURSEMENT_DESCRIPTION,
            status: "queued",
            created_by: auth.userId,
          })),
        )
        .select("id");
      if (error) {
        const duplicate = String(error.code || "") === "23505";
        return NextResponse.json(
          {
            error: duplicate
              ? "Someone in the list was already checked for another pay date this month. Refresh and try again."
              : error.message || "Failed to check vendors",
            added,
            removed,
          },
          { status: duplicate ? 409 : 500 },
        );
      }
      added += (data || []).length;
    }

    return NextResponse.json({
      success: true,
      added,
      removed,
      skipped_other_period: skippedOtherPeriod,
      skipped_ineligible: skippedIneligible,
    });
  } catch (err: any) {
    console.error("[EQUIPMENT REIMBURSEMENTS][PUT]", err);
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
  }
}

// PATCH { from_pay_date, to_pay_date } moves everyone saved for one pay date to
// another (HR 2026-10-23: the pay date is provisional, accounting may pay on a
// different day). Each row gets the new pay date with its month and work period.
// Within the same month nobody can clash (one row per person per month). Moving
// into another month skips anyone who already has a row in that month.
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireHr(req);
    if (auth instanceof NextResponse) return auth;

    const body = await req.json().catch(() => ({}));
    const from = payPeriodForPayDate(String(body?.from_pay_date || "").trim());
    const to = payPeriodForPayDate(String(body?.to_pay_date || "").trim());
    if (!from || !to) {
      return NextResponse.json(
        { error: `from_pay_date and to_pay_date must be dates (YYYY-MM-DD) on or after ${EARLIEST_EQUIPMENT_PAY_DATE}` },
        { status: 400 },
      );
    }
    if (from.payDate === to.payDate) {
      return NextResponse.json({ error: "The new pay date is the same as the current one" }, { status: 400 });
    }

    const { data: fromRows, error: fromError } = await supabaseAdmin
      .from(TABLE)
      .select("id, user_id")
      .eq("pay_date", from.payDate);
    if (fromError) throw new Error(fromError.message || "Failed to load equipment reimbursements");
    const rows = (fromRows || []).map((r: any) => ({ id: String(r.id), user_id: String(r.user_id) }));
    if (!rows.length) {
      return NextResponse.json({ error: "Nobody is saved for that pay date" }, { status: 404 });
    }

    // Moving into another month: people already paid in that month keep their
    // current pay date.
    const taken = new Set<string>();
    if (to.month !== from.month) {
      for (const r of await loadMonthRows(to.month)) taken.add(r.user_id);
    }
    const movable = rows.filter((r) => !taken.has(r.user_id));
    const skippedIds = rows.filter((r) => taken.has(r.user_id)).map((r) => r.user_id);

    let moved = 0;
    for (const chunk of chunkArray(movable.map((r) => r.id), QUERY_CHUNK_SIZE)) {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .update({
          pay_date: to.payDate,
          pay_month: `${to.month}-01`,
          pay_period_start: to.start,
          pay_period_end: to.end,
        })
        .in("id", chunk)
        .eq("pay_date", from.payDate)
        .select("id");
      if (error) {
        const duplicate = String(error.code || "") === "23505";
        return NextResponse.json(
          {
            error: duplicate
              ? "Someone in the list is already paid in that month. Refresh and try again."
              : error.message || "Failed to change the pay date",
            moved,
          },
          { status: duplicate ? 409 : 500 },
        );
      }
      moved += (data || []).length;
    }

    const skipped = skippedIds.length ? (await loadPeopleByIds(skippedIds)).map((p) => p.name) : [];
    return NextResponse.json({ success: true, moved, skipped_already_paid_that_month: skipped, to: to.payDate });
  } catch (err: any) {
    console.error("[EQUIPMENT REIMBURSEMENTS][PATCH]", err);
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
  }
}
