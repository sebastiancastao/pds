import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const allowedRoles = new Set(["admin", "exec", "hr", "hr_admin"]);

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error } = await supabaseAnon.auth.getUser(token);
    if (!error && tokenUser?.user?.id) return tokenUser.user;
  }
  return null;
}

async function checkRole(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("users").select("role").eq("id", userId).maybeSingle();
  return !!data && allowedRoles.has(String(data.role).toLowerCase());
}

function normalizeName(value: string): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// Convert "LastName, MI FirstName" or "LastName, FirstName MI" → "FirstName MI LastName"
function toDisplayName(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed.includes(",")) return trimmed;
  const commaIndex = trimmed.indexOf(",");
  const lastName = trimmed.slice(0, commaIndex).trim();
  const afterComma = trimmed.slice(commaIndex + 1).trim();
  const tokens = afterComma.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return `${afterComma} ${lastName}`.trim();
  // Separate initials (single letter, optional trailing period) from name parts
  const initials = tokens.filter((t) => /^[A-Za-z]\.?$/.test(t));
  const nameParts = tokens.filter((t) => !/^[A-Za-z]\.?$/.test(t));
  if (nameParts.length > 0) {
    return [...nameParts, ...initials, lastName].join(" ").trim();
  }
  return `${afterComma} ${lastName}`.trim();
}

function firstLastKey(value: string): string {
  const tokens = normalizeName(value).split(" ").filter(Boolean);
  if (tokens.length < 2) return tokens[0] ?? "";
  return `${tokens[0]} ${tokens[tokens.length - 1]}`;
}

type UserEntry = { userId: string; email: string; fullName: string };

export async function POST(req: NextRequest) {
  const user = await getAuthedUser(req);
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await checkRole(user.id))) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const { safeDecrypt } = await import("@/lib/encryption");

  const body = await req.json() as { names: string[]; dryRun: boolean };
  const { names, dryRun = true } = body;

  if (!Array.isArray(names) || names.length === 0) {
    return NextResponse.json({ error: "names array is required" }, { status: 400 });
  }

  // Paginate through all active users with profile names
  const allUsers: any[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("id, email, profiles!inner(user_id, first_name, last_name)")
      .eq("is_active", true)
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
    if (!data?.length) break;
    allUsers.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  // Build lookup maps keyed by normalized name variants
  const byNormalized = new Map<string, UserEntry[]>();
  const byFirstLast = new Map<string, UserEntry[]>();

  for (const u of allUsers) {
    const profile = Array.isArray(u.profiles) ? u.profiles[0] : u.profiles;
    if (!profile) continue;
    const firstName = safeDecrypt(profile.first_name ?? "").trim();
    const lastName = safeDecrypt(profile.last_name ?? "").trim();
    const fullName = `${firstName} ${lastName}`.trim();
    if (!fullName) continue;

    const entry: UserEntry = { userId: u.id, email: u.email, fullName };

    const normalized = normalizeName(fullName);
    const existing = byNormalized.get(normalized) ?? [];
    existing.push(entry);
    byNormalized.set(normalized, existing);

    const fl = firstLastKey(fullName);
    if (fl) {
      const flExisting = byFirstLast.get(fl) ?? [];
      flExisting.push(entry);
      byFirstLast.set(fl, flExisting);
    }
  }

  // Match each incoming name
  type MatchResult = { officialName: string; userId: string; email: string; matchedName: string; strategy: string };
  type AmbiguousResult = { officialName: string; candidates: { userId: string; email: string; name: string }[] };

  const matched: MatchResult[] = [];
  const unmatched: string[] = [];
  const ambiguous: AmbiguousResult[] = [];

  for (const rawName of names) {
    if (!rawName?.trim()) continue;
    const displayName = toDisplayName(rawName);
    const normalized = normalizeName(displayName);

    let candidates = byNormalized.get(normalized) ?? [];
    let strategy = "exact";

    if (candidates.length === 0) {
      const fl = firstLastKey(displayName);
      candidates = byFirstLast.get(fl) ?? [];
      strategy = "first+last";
    }

    if (candidates.length === 0) {
      unmatched.push(rawName.trim());
    } else if (candidates.length === 1) {
      matched.push({
        officialName: displayName,
        userId: candidates[0].userId,
        email: candidates[0].email,
        matchedName: candidates[0].fullName,
        strategy,
      });
    } else {
      ambiguous.push({
        officialName: displayName,
        candidates: candidates.slice(0, 5).map((c) => ({ userId: c.userId, email: c.email, name: c.fullName })),
      });
    }
  }

  // Apply updates if not a dry run
  let updated = 0;
  if (!dryRun && matched.length > 0) {
    const BATCH = 250;
    for (let i = 0; i < matched.length; i += BATCH) {
      const batch = matched.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map((m) =>
          supabaseAdmin
            .from("profiles")
            .update({ official_name: m.officialName })
            .eq("user_id", m.userId)
        )
      );
      for (const result of results) {
        if (result.status === "fulfilled" && !(result.value as any).error) updated++;
      }
    }
  }

  return NextResponse.json({
    matched: matched.length,
    unmatched: unmatched.length,
    ambiguous: ambiguous.length,
    updated,
    dryRun,
    details: { matched, unmatched, ambiguous },
  });
}
