import { NextResponse, type NextRequest } from "next/server";
import { isViewOnlyAllowedWritePath, isViewOnlyRole, normalizeRole } from "@/lib/roles";

// Server-side guard for view-only roles (see lib/roles.ts). Any API request
// that is not a read (GET/HEAD/OPTIONS) is refused when the caller's role is
// view-only, unless the path is one of the sign-in / own-paperwork endpoints.
//
// Everyone else passes straight through. The guard fails open: if the role
// cannot be looked up, the route handler's own auth decides as it always has.

export const config = {
  matcher: "/api/:path*",
};

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ROLE_CACHE_TTL_MS = 30_000;
const ROLE_CACHE_MAX_ENTRIES = 1000;
const ROLE_LOOKUP_TIMEOUT_MS = 4000;
const MAX_TOKENS_CHECKED = 4;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// user id -> role. Written only after Supabase accepted that user's own token,
// so an entry always reflects the real role of that id.
const roleCache = new Map<string, { role: string; expiresAt: number }>();

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function getTokenUserId(token: string): string | null {
  try {
    const payload = JSON.parse(base64UrlDecode(token.split(".")[1] || ""));
    const sub = typeof payload?.sub === "string" ? payload.sub : "";
    return UUID_PATTERN.test(sub) ? sub : null;
  } catch {
    return null;
  }
}

function addTokensFrom(text: string, tokens: Set<string>) {
  const matches = text.match(JWT_PATTERN);
  if (matches) matches.forEach((token) => tokens.add(token));
}

// Every access token the request presents: the Bearer header the app sends,
// plus any Supabase session cookie (route handlers accept those too). Cookies
// may be URI-encoded, "base64-" prefixed and/or split into .0/.1 chunks.
function collectAccessTokens(req: NextRequest): string[] {
  const tokens = new Set<string>();

  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    addTokensFrom(authHeader.slice(7).trim(), tokens);
  }

  const cookieGroups = new Map<string, Array<{ index: number; value: string }>>();
  for (const cookie of req.cookies.getAll()) {
    if (!cookie.name.startsWith("sb-")) continue;
    const match = /^(.*?)(?:\.(\d+))?$/.exec(cookie.name);
    const baseName = match?.[1] || cookie.name;
    const index = match?.[2] !== undefined ? Number(match[2]) : -1;
    const group = cookieGroups.get(baseName) || [];
    group.push({ index, value: cookie.value || "" });
    cookieGroups.set(baseName, group);
  }

  for (const group of Array.from(cookieGroups.values())) {
    const joined = group
      .sort((a, b) => a.index - b.index)
      .map((part) => part.value)
      .join("");
    const candidates = [joined];
    try {
      candidates.push(decodeURIComponent(joined));
    } catch {
      // not URI-encoded
    }
    for (const candidate of candidates.slice()) {
      if (candidate.startsWith("base64-")) {
        try {
          candidates.push(base64UrlDecode(candidate.slice("base64-".length)));
        } catch {
          // not valid base64
        }
      }
    }
    candidates.forEach((candidate) => addTokensFrom(candidate, tokens));
  }

  return Array.from(tokens).slice(0, MAX_TOKENS_CHECKED);
}

async function lookupRole(token: string, userId: string): Promise<string | null> {
  const cached = roleCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.role;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ROLE_LOOKUP_TIMEOUT_MS);
  try {
    // Uses the caller's own token: Supabase rejects forged or expired tokens,
    // and RLS ("Users can view own record") only returns the caller's own row.
    const res = await fetch(
      `${supabaseUrl}/rest/v1/users?select=role&id=eq.${encodeURIComponent(userId)}`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: controller.signal,
      }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const role = normalizeRole(rows[0]?.role);

    if (roleCache.size >= ROLE_CACHE_MAX_ENTRIES) roleCache.clear();
    roleCache.set(userId, { role, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
    return role;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function middleware(req: NextRequest) {
  if (READ_METHODS.has(req.method.toUpperCase())) return NextResponse.next();
  if (isViewOnlyAllowedWritePath(req.nextUrl.pathname)) return NextResponse.next();

  const tokens = collectAccessTokens(req);
  if (tokens.length === 0) return NextResponse.next();

  for (const token of tokens) {
    const userId = getTokenUserId(token);
    if (!userId) continue;
    const role = await lookupRole(token, userId);
    if (role && isViewOnlyRole(role)) {
      return NextResponse.json(
        { error: "View-only access: your role can view but not make changes." },
        { status: 403 }
      );
    }
  }

  return NextResponse.next();
}
