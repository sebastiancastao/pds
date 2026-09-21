import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createHash } from "crypto";
import { safeDecrypt } from "@/lib/encryption";
import { canUserAccessEventById } from "@/lib/event-access";

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

const SIGNATURE_PREFIX = "data:image/png;base64,";
const MAX_SIGNATURE_LENGTH = 750_000;
const MAX_NOTE_LENGTH = 2000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id) return user;

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
    if (!tokenErr && tokenUser?.user?.id) return tokenUser.user as any;
  }
  return null;
}

async function getRole(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return String(data?.role || "").toLowerCase().trim();
}

function isPngDataUrl(value: string): boolean {
  if (!value.startsWith(SIGNATURE_PREFIX) || value.length > MAX_SIGNATURE_LENGTH) return false;
  // 16 base64 chars decode to the first 12 bytes, enough to check the PNG magic number.
  const head = Buffer.from(value.slice(SIGNATURE_PREFIX.length, SIGNATURE_PREFIX.length + 16), "base64");
  return head.length >= PNG_MAGIC.length && head.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
}

async function resolveSignerName(userId: string): Promise<string> {
  const [{ data: profile }, { data: userRow }] = await Promise.all([
    supabaseAdmin.from("profiles").select("first_name, last_name").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("users").select("email").eq("id", userId).maybeSingle(),
  ]);
  const first = profile?.first_name ? safeDecrypt(profile.first_name) : "";
  const last = profile?.last_name ? safeDecrypt(profile.last_name) : "";
  return [first, last].filter(Boolean).join(" ").trim() || userRow?.email || "Unknown";
}

type SignoffRow = {
  id: string;
  signed_by: string | null;
  signed_by_name: string | null;
  note: string | null;
  signature_data: string;
  signed_at: string;
};

// Only managers and exec can sign, and only they see the signature image and note.
// Everyone else who can open the event only learns whether the timesheet is signed off.
const SIGNER_ROLES = new Set(["manager", "exec"]);

function buildResponse(row: SignoffRow | null, role: string) {
  if (!row) return { signed: false, signedAt: null, signoff: null };
  return {
    signed: true,
    signedAt: row.signed_at,
    signoff:
      SIGNER_ROLES.has(role)
        ? {
            id: row.id,
            signedBy: row.signed_by,
            signedByName: row.signed_by_name,
            note: row.note,
            signatureData: row.signature_data,
            signedAt: row.signed_at,
          }
        : null,
  };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const eventId = params.id;
    if (!eventId) {
      return NextResponse.json({ error: "Event ID is required" }, { status: 400 });
    }

    const role = await getRole(user.id);
    const allowed = await canUserAccessEventById(supabaseAdmin, eventId, { userId: user.id, role });
    if (!allowed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { data, error } = await supabaseAdmin
      .from("event_timesheet_signoffs")
      .select("id, signed_by, signed_by_name, note, signature_data, signed_at")
      .eq("event_id", eventId)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(buildResponse((data as SignoffRow | null) ?? null, role), { status: 200 });
  } catch (err: any) {
    console.error("[timesheet-signoff GET] error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const eventId = params.id;
    if (!eventId) {
      return NextResponse.json({ error: "Event ID is required" }, { status: 400 });
    }

    const role = await getRole(user.id);
    if (!SIGNER_ROLES.has(role)) {
      return NextResponse.json({ error: "Only managers and exec can sign off the timesheet." }, { status: 403 });
    }

    const allowed = await canUserAccessEventById(supabaseAdmin, eventId, { userId: user.id, role });
    if (!allowed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const signature = String(body?.signature || "").trim();
    const note = String(body?.note || "").trim();

    if (!isPngDataUrl(signature)) {
      return NextResponse.json({ error: "A drawn signature is required." }, { status: 400 });
    }
    if (note.length > MAX_NOTE_LENGTH) {
      return NextResponse.json(
        { error: `Notes cannot be longer than ${MAX_NOTE_LENGTH} characters.` },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const ipAddress = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown";
    const userAgent = req.headers.get("user-agent") ?? "";
    const signatureHash = createHash("sha256")
      .update(`${signature}${now}${user.id}${ipAddress}`)
      .digest("hex");
    const signedByName = await resolveSignerName(user.id);

    // event_id is unique, so a second submit (or a race between two signers)
    // fails with 23505 instead of overwriting the first signature.
    const { data, error } = await supabaseAdmin
      .from("event_timesheet_signoffs")
      .insert({
        event_id: eventId,
        signed_by: user.id,
        signed_by_name: signedByName,
        note: note || null,
        signature_data: signature,
        signature_hash: signatureHash,
        ip_address: ipAddress,
        user_agent: userAgent,
        signed_at: now,
      })
      .select("id, signed_by, signed_by_name, note, signature_data, signed_at")
      .single();

    if (error) {
      if ((error as any).code === "23505") {
        return NextResponse.json(
          { error: "This timesheet has already been signed off." },
          { status: 409 }
        );
      }
      console.error("[timesheet-signoff POST] insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(buildResponse(data as SignoffRow, role), { status: 201 });
  } catch (err: any) {
    console.error("[timesheet-signoff POST] error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
