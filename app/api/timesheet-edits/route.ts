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

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const ALLOWED_ROLES = new Set([
  "admin",
  "exec",
  "hr",
  "manager",
  "supervisor",
  "supervisor2",
  "supervisor3",
]);

type ParsedEditNote = {
  editedByRole: string | null;
  reason: string | null;
  signatureId: string | null;
};

const parseEditNote = (note: unknown): ParsedEditNote | null => {
  if (typeof note !== "string") return null;
  const trimmed = note.trim();
  if (!trimmed) return null;
  if (!/^manual edit by /i.test(trimmed)) return null;

  const roleMatch = trimmed.match(/^manual edit by\s+([^|]+?)\s*\|/i);
  const reasonMatch = trimmed.match(/\|\s*Reason:\s*(.+?)\s*\|\s*Signature:/i);
  const sigMatch = trimmed.match(/\|\s*Signature:\s*([0-9a-f-]{36})/i);

  return {
    editedByRole: roleMatch?.[1]?.trim() || null,
    reason: reasonMatch?.[1]?.trim() || null,
    signatureId: sigMatch?.[1]?.trim() || null,
  };
};

const buildDisplayName = (
  profile: { first_name: string | null; last_name: string | null } | undefined,
  email: string | null | undefined,
  fallback: string
) => {
  const first = profile?.first_name ? safeDecrypt(profile.first_name) : "";
  const last = profile?.last_name ? safeDecrypt(profile.last_name) : "";
  const fullName = [first, last].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  if (email) return email;
  return fallback;
};

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  let {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.id) return user;

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
    if (!tokenErr && tokenUser?.user?.id) {
      return tokenUser.user as any;
    }
  }

  return null;
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: requester, error: requesterError } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (requesterError) {
      return NextResponse.json({ error: requesterError.message }, { status: 500 });
    }

    const requesterRole = String(requester?.role || "").toLowerCase().trim();
    if (!ALLOWED_ROLES.has(requesterRole)) {
      return NextResponse.json(
        { error: "Access denied. You do not have permission to view timesheet edit history." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const eventId = String(searchParams.get("eventId") || "").trim();
    const action = String(searchParams.get("action") || "").trim();
    const limitRaw = Number(searchParams.get("limit") || "500");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 1000) : 500;

    let query = supabaseAdmin
      .from("time_entries")
      .select("id, event_id, user_id, action, timestamp, notes")
      .not("notes", "is", null)
      .ilike("notes", "Manual edit by %")
      .order("timestamp", { ascending: false })
      .limit(limit);

    if (eventId) query = query.eq("event_id", eventId);
    if (action) query = query.eq("action", action);

    const { data: rawEntries, error: entriesError } = await query;
    if (entriesError) {
      return NextResponse.json({ error: entriesError.message }, { status: 500 });
    }

    const entries = (rawEntries || []).filter((row) => parseEditNote(row.notes));
    if (entries.length === 0) {
      return NextResponse.json({ entries: [], count: 0 });
    }

    const parsedByEntryId: Record<string, ParsedEditNote> = {};
    const signatureIds = new Set<string>();
    const eventIds = new Set<string>();
    const workerUserIds = new Set<string>();

    for (const row of entries) {
      const parsed = parseEditNote(row.notes);
      if (!parsed) continue;
      parsedByEntryId[row.id] = parsed;
      if (parsed.signatureId) signatureIds.add(parsed.signatureId);
      if (row.event_id) eventIds.add(row.event_id);
      if (row.user_id) workerUserIds.add(row.user_id);
    }

    const [signaturesRes, eventsRes] = await Promise.all([
      signatureIds.size > 0
        ? supabaseAdmin
            .from("form_signatures")
            .select("id, user_id, signed_at")
            .in("id", [...signatureIds])
        : Promise.resolve({ data: [], error: null } as any),
      eventIds.size > 0
        ? supabaseAdmin
            .from("events")
            .select("id, event_name, event_date, venue, city, state")
            .in("id", [...eventIds])
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    if (signaturesRes.error) {
      return NextResponse.json({ error: signaturesRes.error.message }, { status: 500 });
    }
    if (eventsRes.error) {
      return NextResponse.json({ error: eventsRes.error.message }, { status: 500 });
    }

    const signatureRows = signaturesRes.data || [];
    const editorUserIds = new Set<string>();
    const signaturesById: Record<string, { user_id: string | null; signed_at: string | null }> = {};
    for (const row of signatureRows) {
      signaturesById[row.id] = { user_id: row.user_id || null, signed_at: row.signed_at || null };
      if (row.user_id) editorUserIds.add(row.user_id);
    }

    const allUserIds = [...new Set([...workerUserIds, ...editorUserIds])];

    const [usersRes, profilesRes] = await Promise.all([
      allUserIds.length > 0
        ? supabaseAdmin.from("users").select("id, email").in("id", allUserIds)
        : Promise.resolve({ data: [], error: null } as any),
      allUserIds.length > 0
        ? supabaseAdmin
            .from("profiles")
            .select("user_id, first_name, last_name")
            .in("user_id", allUserIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    if (usersRes.error) {
      return NextResponse.json({ error: usersRes.error.message }, { status: 500 });
    }
    if (profilesRes.error) {
      return NextResponse.json({ error: profilesRes.error.message }, { status: 500 });
    }

    const usersById: Record<string, { id: string; email: string | null }> = {};
    for (const row of usersRes.data || []) {
      usersById[row.id] = row;
    }

    const profilesByUserId: Record<string, { first_name: string | null; last_name: string | null }> = {};
    for (const row of profilesRes.data || []) {
      profilesByUserId[row.user_id] = {
        first_name: row.first_name || null,
        last_name: row.last_name || null,
      };
    }

    const eventsById: Record<
      string,
      {
        id: string;
        event_name: string | null;
        event_date: string | null;
        venue: string | null;
        city: string | null;
        state: string | null;
      }
    > = {};
    for (const event of eventsRes.data || []) {
      eventsById[event.id] = event;
    }

    const rows = entries.map((entry) => {
      const parsed = parsedByEntryId[entry.id] || { editedByRole: null, reason: null, signatureId: null };
      const signatureMeta = parsed.signatureId ? signaturesById[parsed.signatureId] : null;
      const editorUserId = signatureMeta?.user_id || null;
      const event = entry.event_id ? eventsById[entry.event_id] : null;

      const workerUser = usersById[entry.user_id];
      const workerName = buildDisplayName(
        profilesByUserId[entry.user_id],
        workerUser?.email,
        entry.user_id
      );

      const editorUser = editorUserId ? usersById[editorUserId] : null;
      const editorName = editorUserId
        ? buildDisplayName(profilesByUserId[editorUserId], editorUser?.email, editorUserId)
        : null;

      return {
        timeEntryId: entry.id,
        eventId: entry.event_id || null,
        eventName: event?.event_name || "(No event)",
        eventDate: event?.event_date || null,
        venue: event?.venue || null,
        city: event?.city || null,
        state: event?.state || null,
        workerUserId: entry.user_id,
        workerName,
        workerEmail: workerUser?.email || null,
        action: entry.action,
        entryTimestamp: entry.timestamp,
        editedByRole: parsed.editedByRole,
        editReason: parsed.reason,
        signatureId: parsed.signatureId,
        editedByUserId: editorUserId,
        editedByName: editorName,
        editedByEmail: editorUser?.email || null,
        editedAt: signatureMeta?.signed_at || null,
        rawNote: entry.notes,
      };
    });

    rows.sort((a, b) => {
      const aTs = new Date(a.editedAt || a.entryTimestamp).getTime();
      const bTs = new Date(b.editedAt || b.entryTimestamp).getTime();
      return bTs - aTs;
    });

    return NextResponse.json({ entries: rows, count: rows.length }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unhandled error" }, { status: 500 });
  }
}
