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
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

type ActorMap = Record<string, { name: string; email: string }>;

function dec(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    return safeDecrypt(value.trim());
  } catch {
    return value.trim();
  }
}

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function getSinceIso(daysParam: string | null) {
  if (!daysParam || daysParam === "all") return null;
  const days = parsePositiveInt(daysParam, 30);
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function escapeForIlike(value: string) {
  return value.replace(/[%_]/g, (match) => `\\${match}`);
}

function isMissingColumnError(error: any, columnName: string) {
  const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return message.includes("column") && message.includes(columnName.toLowerCase());
}

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  let {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id) return user;

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (!token) return null;

  const { data: tokenUser } = await supabase.auth.getUser(token);
  return tokenUser?.user || null;
}

async function getActorMap(userIds: Array<string | null | undefined>): Promise<ActorMap> {
  const ids = [...new Set(userIds.filter((value): value is string => Boolean(value)))];
  if (ids.length === 0) return {};

  const [{ data: users }, { data: profiles }] = await Promise.all([
    supabaseAdmin.from("users").select("id, email").in("id", ids),
    supabaseAdmin.from("profiles").select("user_id, first_name, last_name").in("user_id", ids),
  ]);

  const emailById = new Map<string, string>();
  (users || []).forEach((row: any) => emailById.set(row.id, row.email || ""));

  const nameById = new Map<string, string>();
  (profiles || []).forEach((row: any) => {
    const fullName = [dec(row.first_name), dec(row.last_name)].filter(Boolean).join(" ").trim();
    if (row.user_id) nameById.set(row.user_id, fullName);
  });

  return ids.reduce<ActorMap>((acc, id) => {
    acc[id] = {
      name: nameById.get(id) || emailById.get(id) || id,
      email: emailById.get(id) || "",
    };
    return acc;
  }, {});
}

function buildGeneralCountQuery(filters: {
  userId: string | null;
  action: string | null;
  sinceIso: string | null;
  outcome: string | null;
}) {
  let query = supabaseAdmin.from("audit_logs").select("id", { count: "exact", head: true });

  if (filters.userId) query = query.eq("user_id", filters.userId);
  if (filters.action) query = query.ilike("action", `%${escapeForIlike(filters.action)}%`);
  if (filters.sinceIso) query = query.gte("created_at", filters.sinceIso);
  if (filters.outcome === "success") query = query.eq("success", true);
  if (filters.outcome === "failure") query = query.eq("success", false);

  return query;
}

async function fetchGeneralLogs(filters: {
  page: number;
  pageSize: number;
  userId: string | null;
  action: string | null;
  sinceIso: string | null;
  outcome: string | null;
}) {
  const from = (filters.page - 1) * filters.pageSize;
  const to = from + filters.pageSize - 1;

  let supportsOutcome = true;
  let count = 0;

  const countResult = await buildGeneralCountQuery(filters);
  if (countResult.error && (isMissingColumnError(countResult.error, "success") || isMissingColumnError(countResult.error, "error_message"))) {
    supportsOutcome = false;
    const fallbackCount = await buildGeneralCountQuery({ ...filters, outcome: null });
    if (fallbackCount.error) throw fallbackCount.error;
    count = fallbackCount.count || 0;
  } else if (countResult.error) {
    throw countResult.error;
  } else {
    count = countResult.count || 0;
  }

  let query = supabaseAdmin
    .from("audit_logs")
    .select("id, user_id, action, resource_type, resource_id, ip_address, user_agent, metadata, success, error_message, created_at")
    .order("created_at", { ascending: false })
    .range(from, to);

  if (filters.userId) query = query.eq("user_id", filters.userId);
  if (filters.action) query = query.ilike("action", `%${escapeForIlike(filters.action)}%`);
  if (filters.sinceIso) query = query.gte("created_at", filters.sinceIso);
  if (supportsOutcome && filters.outcome === "success") query = query.eq("success", true);
  if (supportsOutcome && filters.outcome === "failure") query = query.eq("success", false);

  const primaryResult = await query;
  let data: any[] | null = primaryResult.data as any[] | null;
  let error: any = primaryResult.error;

  if (error && (isMissingColumnError(error, "success") || isMissingColumnError(error, "error_message"))) {
    supportsOutcome = false;
    let fallbackQuery = supabaseAdmin
      .from("audit_logs")
      .select("id, user_id, action, resource_type, resource_id, ip_address, user_agent, metadata, created_at")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (filters.userId) fallbackQuery = fallbackQuery.eq("user_id", filters.userId);
    if (filters.action) fallbackQuery = fallbackQuery.ilike("action", `%${escapeForIlike(filters.action)}%`);
    if (filters.sinceIso) fallbackQuery = fallbackQuery.gte("created_at", filters.sinceIso);

    const fallback = await fallbackQuery;
    if (fallback.error) throw fallback.error;
    data = (fallback.data || []) as any[];
    error = null;
  }

  if (error) throw error;

  const actorMap = await getActorMap((data || []).map((row: any) => row.user_id));
  const entries = (data || []).map((row: any) => ({
    id: row.id,
    user_id: row.user_id || null,
    actor_name: row.user_id ? actorMap[row.user_id]?.name || row.user_id : "System",
    actor_email: row.user_id ? actorMap[row.user_id]?.email || "" : "",
    action: row.action || "",
    resource_type: row.resource_type || "",
    resource_id: row.resource_id || "",
    ip_address: row.ip_address || "",
    user_agent: row.user_agent || "",
    metadata: row.metadata || {},
    success: supportsOutcome ? row.success ?? null : null,
    error_message: supportsOutcome ? row.error_message || null : null,
    created_at: row.created_at,
  }));

  return {
    kind: "general" as const,
    page: filters.page,
    pageSize: filters.pageSize,
    total: count,
    supportsOutcome,
    entries,
  };
}

function buildFormCountQuery(filters: {
  userId: string | null;
  action: string | null;
  formType: string | null;
  sinceIso: string | null;
  timeColumn: "created_at" | "timestamp";
}) {
  let query = supabaseAdmin.from("form_audit_trail").select("id", { count: "exact", head: true });

  if (filters.userId) query = query.eq("user_id", filters.userId);
  if (filters.action) query = query.ilike("action", `%${escapeForIlike(filters.action)}%`);
  if (filters.formType) query = query.ilike("form_type", `%${escapeForIlike(filters.formType)}%`);
  if (filters.sinceIso) query = query.gte(filters.timeColumn, filters.sinceIso);

  return query;
}

async function fetchFormLogs(filters: {
  page: number;
  pageSize: number;
  userId: string | null;
  action: string | null;
  formType: string | null;
  sinceIso: string | null;
}) {
  const from = (filters.page - 1) * filters.pageSize;
  const to = from + filters.pageSize - 1;

  let timeColumn: "created_at" | "timestamp" = "created_at";
  let count = 0;

  const countResult = await buildFormCountQuery({ ...filters, timeColumn });
  if (countResult.error && isMissingColumnError(countResult.error, "created_at")) {
    timeColumn = "timestamp";
    const fallbackCount = await buildFormCountQuery({ ...filters, timeColumn });
    if (fallbackCount.error) throw fallbackCount.error;
    count = fallbackCount.count || 0;
  } else if (countResult.error) {
    throw countResult.error;
  } else {
    count = countResult.count || 0;
  }

  let query = supabaseAdmin
    .from("form_audit_trail")
    .select(`id, user_id, form_id, form_type, action, action_details, field_changed, old_value, new_value, ip_address, user_agent, ${timeColumn}`)
    .order(timeColumn, { ascending: false })
    .range(from, to);

  if (filters.userId) query = query.eq("user_id", filters.userId);
  if (filters.action) query = query.ilike("action", `%${escapeForIlike(filters.action)}%`);
  if (filters.formType) query = query.ilike("form_type", `%${escapeForIlike(filters.formType)}%`);
  if (filters.sinceIso) query = query.gte(timeColumn, filters.sinceIso);

  const { data, error } = await query;
  if (error) throw error;

  const actorMap = await getActorMap((data || []).map((row: any) => row.user_id));
  const entries = (data || []).map((row: any) => ({
    id: row.id,
    user_id: row.user_id || null,
    actor_name: row.user_id ? actorMap[row.user_id]?.name || row.user_id : "System",
    actor_email: row.user_id ? actorMap[row.user_id]?.email || "" : "",
    form_id: row.form_id || "",
    form_type: row.form_type || "",
    action: row.action || "",
    action_details: row.action_details || {},
    field_changed: row.field_changed || "",
    old_value: row.old_value || "",
    new_value: row.new_value || "",
    ip_address: row.ip_address || "",
    user_agent: row.user_agent || "",
    created_at: row[timeColumn],
  }));

  return {
    kind: "forms" as const,
    page: filters.page,
    pageSize: filters.pageSize,
    total: count,
    timeColumn,
    entries,
  };
}

export async function GET(req: NextRequest) {
  try {
    const authedUser = await getAuthedUser(req);
    if (!authedUser?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

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
    const kind = searchParams.get("kind") === "forms" ? "forms" : "general";
    const page = parsePositiveInt(searchParams.get("page"), 1);
    const pageSize = Math.min(parsePositiveInt(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const action = searchParams.get("action")?.trim() || null;
    const userId = searchParams.get("userId")?.trim() || null;
    const sinceIso = getSinceIso(searchParams.get("days"));

    if (kind === "forms") {
      const formType = searchParams.get("formType")?.trim() || null;
      const response = await fetchFormLogs({
        page,
        pageSize,
        userId,
        action,
        formType,
        sinceIso,
      });
      return NextResponse.json(response);
    }

    const outcome = searchParams.get("outcome")?.trim() || null;
    const response = await fetchGeneralLogs({
      page,
      pageSize,
      userId,
      action,
      sinceIso,
      outcome,
    });

    return NextResponse.json(response);
  } catch (err: any) {
    console.error("[AUDIT-LOGS]", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
