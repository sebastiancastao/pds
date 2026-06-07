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
const VALID_STATUSES = new Set(["queued", "paid"]);
const QUERY_CHUNK_SIZE = 150;

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

type UserWithProfile = {
  id: string;
  email?: string | null;
  profiles?:
    | { first_name?: string | null; last_name?: string | null }
    | Array<{ first_name?: string | null; last_name?: string | null }>
    | null;
};

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0 || items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
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

function buildEmployeeName(user: UserWithProfile): string {
  const profile = Array.isArray(user.profiles) ? user.profiles[0] : user.profiles;
  const first = safeDecryptName(profile?.first_name);
  const last = safeDecryptName(profile?.last_name);
  return `${first} ${last}`.trim() || String(user.email || "Unknown");
}

function parseIsoDate(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.toISOString().slice(0, 10) !== raw) return null;
  return raw;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

// GET: list sick-leave paysheets (optionally filtered by user / date range / status)
export async function GET(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!(await hasHrAccess(userId))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const filterUserId = String(searchParams.get("user_id") || "").trim();
    const requestedStatus = String(searchParams.get("status") || "").toLowerCase();
    const startDate = parseIsoDate(searchParams.get("start_date"));
    const endDate = parseIsoDate(searchParams.get("end_date"));

    let query = supabaseAdmin
      .from("sick_leave_paysheets")
      .select(
        "id, user_id, hours, rate, amount, payment_date, status, notes, created_by, created_at, updated_at"
      )
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (filterUserId) query = query.eq("user_id", filterUserId);
    if (VALID_STATUSES.has(requestedStatus)) query = query.eq("status", requestedStatus);
    if (startDate) query = query.gte("payment_date", startDate);
    if (endDate) query = query.lte("payment_date", endDate);

    const { data: rows, error } = await query;
    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to fetch sick leave paysheets" },
        { status: 500 }
      );
    }

    const records = rows || [];
    const recordUserIds = [
      ...new Set(records.map((r: any) => String(r.user_id || "")).filter(Boolean)),
    ];

    const nameById = new Map<string, { name: string; email: string }>();
    for (const chunk of chunkArray(recordUserIds, QUERY_CHUNK_SIZE)) {
      const { data: users, error: usersError } = await supabaseAdmin
        .from("users")
        .select("id, email, profiles ( first_name, last_name )")
        .in("id", chunk);
      if (usersError) {
        return NextResponse.json(
          { error: usersError.message || "Failed to fetch employee profiles" },
          { status: 500 }
        );
      }
      for (const u of (users || []) as UserWithProfile[]) {
        nameById.set(u.id, {
          name: buildEmployeeName(u),
          email: String(u.email || ""),
        });
      }
    }

    const paysheets = records.map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      hours: Number(row.hours || 0),
      rate: Number(row.rate || 0),
      amount: Number(row.amount || 0),
      payment_date: row.payment_date,
      status: row.status,
      notes: row.notes ?? null,
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
      employee_name: nameById.get(row.user_id)?.name || "Unknown",
      employee_email: nameById.get(row.user_id)?.email || "",
    }));

    const stats = paysheets.reduce(
      (acc, row) => {
        acc.total += 1;
        acc.total_hours += row.hours;
        acc.total_amount += row.amount;
        if (row.status === "queued") acc.queued += 1;
        if (row.status === "paid") acc.paid += 1;
        return acc;
      },
      { total: 0, queued: 0, paid: 0, total_hours: 0, total_amount: 0 }
    );
    stats.total_hours = round2(stats.total_hours);
    stats.total_amount = round2(stats.total_amount);

    return NextResponse.json({ paysheets, stats }, { status: 200 });
  } catch (err: any) {
    console.error("[HR SICK LEAVE PAYSHEETS][GET] error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// POST: create a sick-leave paysheet (queued for payroll)
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
    const targetUserId = String(body?.user_id || "").trim();
    const paymentDate = parseIsoDate(body?.payment_date);
    const hours = round2(Number(body?.hours ?? 0));
    const rate = round2(Number(body?.rate ?? 0));
    const amount =
      body?.amount != null && Number.isFinite(Number(body.amount))
        ? round2(Number(body.amount))
        : round2(hours * rate);
    const notes = String(body?.notes || "").trim() || null;

    if (!targetUserId) {
      return NextResponse.json({ error: "user_id is required" }, { status: 400 });
    }
    if (!paymentDate) {
      return NextResponse.json(
        { error: "A valid payment_date (YYYY-MM-DD) is required" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(hours) || hours <= 0) {
      return NextResponse.json(
        { error: "hours must be a positive number" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(rate) || rate < 0) {
      return NextResponse.json(
        { error: "rate must be a number greater than or equal to 0" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("sick_leave_paysheets")
      .insert({
        user_id: targetUserId,
        hours,
        rate,
        amount,
        payment_date: paymentDate,
        status: "queued",
        notes,
        created_by: userId,
      })
      .select(
        "id, user_id, hours, rate, amount, payment_date, status, notes, created_at, updated_at"
      )
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to create sick leave paysheet" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: "Sick leave paysheet queued", paysheet: data },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[HR SICK LEAVE PAYSHEETS][POST] error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// PATCH: update a paysheet status or payment date
export async function PATCH(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!(await hasHrAccess(userId))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || "").trim();
    if (!id) {
      return NextResponse.json({ error: "Paysheet id is required" }, { status: 400 });
    }

    const updates: Record<string, any> = {};
    if (body?.status != null) {
      const status = String(body.status).toLowerCase();
      if (!VALID_STATUSES.has(status)) {
        return NextResponse.json(
          { error: "Invalid status. Allowed: queued, paid" },
          { status: 400 }
        );
      }
      updates.status = status;
    }
    if (body?.payment_date != null) {
      const paymentDate = parseIsoDate(body.payment_date);
      if (!paymentDate) {
        return NextResponse.json(
          { error: "A valid payment_date (YYYY-MM-DD) is required" },
          { status: 400 }
        );
      }
      updates.payment_date = paymentDate;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "Nothing to update. Provide status and/or payment_date." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("sick_leave_paysheets")
      .update(updates)
      .eq("id", id)
      .select(
        "id, user_id, hours, rate, amount, payment_date, status, notes, updated_at"
      )
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to update sick leave paysheet" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: "Sick leave paysheet updated", paysheet: data },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[HR SICK LEAVE PAYSHEETS][PATCH] error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE: remove a queued paysheet
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
      return NextResponse.json({ error: "Paysheet id is required" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("sick_leave_paysheets")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to delete sick leave paysheet" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: "Sick leave paysheet removed" },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[HR SICK LEAVE PAYSHEETS][DELETE] error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
