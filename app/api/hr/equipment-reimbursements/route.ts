import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import { safeDecrypt } from "@/lib/encryption";

// Equipment reimbursement queue for the HR dashboard Payroll tab.
// Equipment reimbursement is paid once a month as an off-cycle payment to
// active vendors and employees. Each row is one person's reimbursement for one
// pay month (first day of the month), queued until HR marks it paid.

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
const QUERY_CHUNK_SIZE = 150;
const INSERT_CHUNK_SIZE = 500;
const PAGE_SIZE = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Vendors are event workers. Employees are staff roles. Execs and admins are
// kept apart so the "queue everyone" action can leave them out by default.
type PersonType = "vendor" | "employee" | "exec" | "other";
const EMPLOYEE_ROLES = new Set([
  "employee", "manager", "supervisor", "supervisor2", "supervisor3", "supervisor4",
  "supervisor5", "supervisor6", "hr", "finance",
]);
const EXEC_ROLES = new Set(["exec", "admin"]);

function personTypeOf(role: string | null | undefined): PersonType {
  const r = String(role || "").trim().toLowerCase();
  if (r === "worker" || r === "vendor") return "vendor";
  if (EMPLOYEE_ROLES.has(r)) return "employee";
  if (EXEC_ROLES.has(r)) return "exec";
  return "other";
}

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

async function hasHrAccess(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from("users").select("role").eq("id", userId).single();
  if (error) return false;
  return HR_ROLES.has(String(data?.role || "").toLowerCase());
}

async function requireHr(req: NextRequest): Promise<{ userId: string } | NextResponse> {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await hasHrAccess(userId))) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
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

type ProfileShape = { first_name?: string | null; last_name?: string | null; state?: string | null; city?: string | null };
type UserRow = {
  id: string;
  email?: string | null;
  role?: string | null;
  is_active?: boolean | null;
  profiles?: ProfileShape | ProfileShape[] | null;
};

type Person = {
  user_id: string;
  name: string;
  email: string;
  role: string;
  type: PersonType;
  state: string;
  is_active: boolean;
};

function toPerson(u: UserRow): Person {
  const profile = Array.isArray(u.profiles) ? u.profiles[0] : u.profiles;
  const first = safeDecryptName(profile?.first_name);
  const last = safeDecryptName(profile?.last_name);
  return {
    user_id: u.id,
    name: `${first} ${last}`.trim() || String(u.email || "Unknown"),
    email: String(u.email || ""),
    role: String(u.role || ""),
    type: personTypeOf(u.role),
    state: String(profile?.state || "").trim().toUpperCase(),
    is_active: u.is_active !== false,
  };
}

// "2026-10" or "2026-10-15" -> "2026-10-01"; anything else -> null.
function parseMonth(value: unknown): string | null {
  const raw = String(value || "").trim();
  const m = raw.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

function parseIsoDate(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) return null;
  return raw;
}

// Until the migration is run the table does not exist; say so plainly.
const MISSING_TABLE_MESSAGE =
  "The equipment reimbursement table is not in the database yet. Run supabase/migrations/20261021000001_create_equipment_reimbursement_queue.sql in Supabase.";

function tableErrorMessage(error: { code?: string; message?: string } | null, fallback: string): string {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  if (code === "42P01" || code === "PGRST205" || (/equipment_reimbursement_queue/.test(message) && /does not exist|schema cache/i.test(message))) {
    return MISSING_TABLE_MESSAGE;
  }
  return message || fallback;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseAmount(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return round2(n);
}

function cleanText(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s ? s.slice(0, 1000) : null;
}

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

async function loadActivePeople(): Promise<Person[]> {
  const people: Person[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("id, email, role, is_active, profiles ( first_name, last_name, state, city )")
      .eq("is_active", true)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message || "Failed to load active vendors and employees");
    for (const u of (data || []) as UserRow[]) people.push(toPerson(u));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return people.sort((a, b) => a.name.localeCompare(b.name));
}

async function loadPeopleByIds(ids: string[]): Promise<Map<string, Person>> {
  const map = new Map<string, Person>();
  for (const chunk of chunkArray(ids, QUERY_CHUNK_SIZE)) {
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("id, email, role, is_active, profiles ( first_name, last_name, state, city )")
      .in("id", chunk);
    if (error) throw new Error(error.message || "Failed to load profiles");
    for (const u of (data || []) as UserRow[]) map.set(u.id, toPerson(u));
  }
  return map;
}

async function loadMonthRows(payMonth: string) {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("id, user_id, pay_month, amount, description, notes, status, paid_date, paid_by, created_by, created_at, updated_at")
    .eq("pay_month", payMonth)
    .order("created_at", { ascending: true });
  if (error) throw new Error(tableErrorMessage(error, "Failed to load the equipment reimbursement queue"));
  return data || [];
}

async function decorateRows(rows: any[]) {
  const ids = Array.from(
    new Set(rows.flatMap((r) => [r.user_id, r.paid_by, r.created_by]).filter(Boolean).map(String)),
  );
  const people = await loadPeopleByIds(ids);
  return rows
    .map((r) => {
      const p = people.get(r.user_id);
      return {
        id: r.id,
        user_id: r.user_id,
        pay_month: r.pay_month,
        amount: Number(r.amount || 0),
        description: r.description ?? null,
        notes: r.notes ?? null,
        status: r.status as "queued" | "paid",
        paid_date: r.paid_date ?? null,
        paid_by_name: r.paid_by ? people.get(r.paid_by)?.name || null : null,
        created_by_name: r.created_by ? people.get(r.created_by)?.name || null : null,
        created_at: r.created_at,
        updated_at: r.updated_at,
        name: p?.name || "Unknown",
        email: p?.email || "",
        role: p?.role || "",
        type: p?.type || ("other" as PersonType),
        state: p?.state || "",
        is_active: p ? p.is_active : false,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// GET ?month=YYYY-MM -> that month's queue, plus every active vendor and employee
// for the add/queue-everyone controls.
export async function GET(req: NextRequest) {
  try {
    const auth = await requireHr(req);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(req.url);
    const payMonth = parseMonth(searchParams.get("month"));
    if (!payMonth) {
      return NextResponse.json({ error: "A valid month (YYYY-MM) is required" }, { status: 400 });
    }

    const [rows, people] = await Promise.all([loadMonthRows(payMonth), loadActivePeople()]);
    return NextResponse.json({ month: payMonth.slice(0, 7), rows: await decorateRows(rows), people });
  } catch (err: any) {
    console.error("[EQUIPMENT REIMBURSEMENTS][GET]", err);
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
  }
}

// POST: queue people for a month.
//   { month, entries: [{ user_id, amount, description?, notes? }], skip_existing? }
//   { month, copy_from_month }  -> re-queue that month's people (still active and
//                                  not already queued) with the same amounts.
export async function POST(req: NextRequest) {
  try {
    const auth = await requireHr(req);
    if (auth instanceof NextResponse) return auth;

    const body = await req.json().catch(() => ({}));
    const payMonth = parseMonth(body?.month);
    if (!payMonth) {
      return NextResponse.json({ error: "A valid month (YYYY-MM) is required" }, { status: 400 });
    }

    let entries: Array<{ user_id: string; amount: number; description: string | null; notes: string | null }> = [];
    let skipExisting = body?.skip_existing !== false;

    const copyFrom = body?.copy_from_month != null ? parseMonth(body.copy_from_month) : null;
    if (body?.copy_from_month != null) {
      if (!copyFrom) return NextResponse.json({ error: "copy_from_month must be YYYY-MM" }, { status: 400 });
      if (copyFrom === payMonth) return NextResponse.json({ error: "Pick a different month to copy from" }, { status: 400 });
      const source = await loadMonthRows(copyFrom);
      entries = source.map((r: any) => ({
        user_id: String(r.user_id),
        amount: round2(Number(r.amount || 0)),
        description: r.description ?? null,
        notes: null,
      }));
      skipExisting = true;
    } else {
      const raw = Array.isArray(body?.entries) ? body.entries : [];
      for (const e of raw) {
        const userId = String(e?.user_id || "").trim();
        if (!UUID_PATTERN.test(userId)) {
          return NextResponse.json({ error: "Every entry needs a valid user_id" }, { status: 400 });
        }
        const amount = parseAmount(e?.amount);
        if (amount == null) {
          return NextResponse.json({ error: "Every entry needs an amount of 0 or more" }, { status: 400 });
        }
        entries.push({ user_id: userId, amount, description: cleanText(e?.description), notes: cleanText(e?.notes) });
      }
    }

    if (entries.length === 0) {
      return NextResponse.json({ error: "Nothing to queue" }, { status: 400 });
    }

    // Equipment reimbursement is only for active vendors and employees.
    const people = await loadPeopleByIds(Array.from(new Set(entries.map((e) => e.user_id))));
    const inactive: string[] = [];
    const missing: string[] = [];
    entries = entries.filter((e) => {
      const p = people.get(e.user_id);
      if (!p) { missing.push(e.user_id); return false; }
      if (!p.is_active) { inactive.push(p.name); return false; }
      return true;
    });

    let alreadyQueued = 0;
    if (skipExisting) {
      const existing = new Set((await loadMonthRows(payMonth)).map((r: any) => String(r.user_id)));
      const before = entries.length;
      entries = entries.filter((e) => !existing.has(e.user_id));
      alreadyQueued = before - entries.length;
    }

    // One row per person per request, even if the list repeats someone.
    const seen = new Set<string>();
    if (skipExisting) {
      entries = entries.filter((e) => (seen.has(e.user_id) ? false : (seen.add(e.user_id), true)));
    }

    const inserted: any[] = [];
    for (const chunk of chunkArray(entries, INSERT_CHUNK_SIZE)) {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .insert(
          chunk.map((e) => ({
            user_id: e.user_id,
            pay_month: payMonth,
            amount: e.amount,
            description: e.description,
            notes: e.notes,
            status: "queued",
            created_by: auth.userId,
          })),
        )
        .select("id");
      if (error) {
        return NextResponse.json(
          { error: tableErrorMessage(error, "Failed to queue equipment reimbursements"), inserted: inserted.length },
          { status: 500 },
        );
      }
      inserted.push(...(data || []));
    }

    return NextResponse.json({
      success: true,
      inserted: inserted.length,
      already_queued: alreadyQueued,
      skipped_inactive: inactive,
      skipped_missing: missing.length,
    });
  } catch (err: any) {
    console.error("[EQUIPMENT REIMBURSEMENTS][POST]", err);
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
  }
}

// PATCH: { ids: [...], status?: "queued" | "paid", paid_date?, amount?, description?, notes? }
// Amount and description can only change while a row is queued.
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireHr(req);
    if (auth instanceof NextResponse) return auth;

    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body?.ids) ? body.ids.map((v: unknown) => String(v)) : [];
    if (ids.length === 0 || ids.some((id) => !UUID_PATTERN.test(id))) {
      return NextResponse.json({ error: "ids must be a list of row ids" }, { status: 400 });
    }

    const update: Record<string, unknown> = {};
    const status = body?.status != null ? String(body.status) : null;
    if (status != null && status !== "queued" && status !== "paid") {
      return NextResponse.json({ error: "status must be queued or paid" }, { status: 400 });
    }

    if (status === "paid") {
      const paidDate = body?.paid_date != null ? parseIsoDate(body.paid_date) : todayIso();
      if (!paidDate) return NextResponse.json({ error: "paid_date must be YYYY-MM-DD" }, { status: 400 });
      update.status = "paid";
      update.paid_date = paidDate;
      update.paid_by = auth.userId;
    } else if (status === "queued") {
      update.status = "queued";
      update.paid_date = null;
      update.paid_by = null;
    } else if (body?.paid_date !== undefined) {
      const paidDate = parseIsoDate(body.paid_date);
      if (!paidDate) return NextResponse.json({ error: "paid_date must be YYYY-MM-DD" }, { status: 400 });
      update.paid_date = paidDate;
    }

    const editsQueuedFields = body?.amount !== undefined || body?.description !== undefined;
    if (body?.amount !== undefined) {
      const amount = parseAmount(body.amount);
      if (amount == null) return NextResponse.json({ error: "amount must be 0 or more" }, { status: 400 });
      update.amount = amount;
    }
    if (body?.description !== undefined) update.description = cleanText(body.description);
    if (body?.notes !== undefined) update.notes = cleanText(body.notes);

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    if (editsQueuedFields && status !== "queued") {
      const { data: paidRows, error: checkError } = await supabaseAdmin
        .from(TABLE)
        .select("id")
        .in("id", ids)
        .eq("status", "paid");
      if (checkError) return NextResponse.json({ error: tableErrorMessage(checkError, "Failed to check rows") }, { status: 500 });
      if ((paidRows || []).length > 0) {
        return NextResponse.json(
          { error: "Paid rows cannot change amount or description. Move them back to the queue first." },
          { status: 400 },
        );
      }
    }

    // Only a paid row has a paid date to edit on its own.
    let query = supabaseAdmin.from(TABLE).update(update).in("id", ids);
    if (!status && update.paid_date !== undefined) query = query.eq("status", "paid");
    const { data, error } = await query.select("id");
    if (error) return NextResponse.json({ error: tableErrorMessage(error, "Failed to save") }, { status: 500 });

    return NextResponse.json({ success: true, updated: (data || []).length });
  } catch (err: any) {
    console.error("[EQUIPMENT REIMBURSEMENTS][PATCH]", err);
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
  }
}

// DELETE: { ids: [...] } removes queued rows. Paid rows stay as the payment record.
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireHr(req);
    if (auth instanceof NextResponse) return auth;

    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body?.ids) ? body.ids.map((v: unknown) => String(v)) : [];
    if (ids.length === 0 || ids.some((id) => !UUID_PATTERN.test(id))) {
      return NextResponse.json({ error: "ids must be a list of row ids" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .delete()
      .in("id", ids)
      .eq("status", "queued")
      .select("id");
    if (error) return NextResponse.json({ error: tableErrorMessage(error, "Failed to save") }, { status: 500 });

    const removed = (data || []).length;
    return NextResponse.json({ success: true, removed, kept_paid: ids.length - removed });
  } catch (err: any) {
    console.error("[EQUIPMENT REIMBURSEMENTS][DELETE]", err);
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
  }
}
