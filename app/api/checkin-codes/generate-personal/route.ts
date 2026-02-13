import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { safeDecrypt } from "@/lib/encryption";
import { deriveCheckinInitials, generateCheckinCode } from "@/lib/checkin-code";

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

type Audience = "all" | "one";

async function getAuthenticatedUserId(req: NextRequest): Promise<string | null> {
  const supabase = createRouteHandlerClient({ cookies });
  let { data: { user } } = await supabase.auth.getUser();

  if (!user || !user.id) {
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

function canManageCodes(role: string | null | undefined) {
  return ["manager", "hr", "exec", "admin"].includes(String(role || ""));
}

async function listAllAuthUsers(): Promise<Map<string, string>> {
  const authMap = new Map<string, string>();
  const perPage = 1000;
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;
    const users = data?.users || [];
    for (const u of users as any[]) {
      if (!u?.id) continue;
      const email = String(u.email || "").trim();
      if (email) authMap.set(String(u.id), email);
    }
    if (users.length < perPage) break;
  }
  return authMap;
}

function isValidUuid(id: unknown) {
  if (typeof id !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id
  );
}

async function generateUniqueCodes(params: {
  recipients: Array<{
    id: string;
    email: string;
    first_name: string;
    last_name: string;
  }>;
  existingActiveCodes: Set<string>;
}) {
  const { recipients, existingActiveCodes } = params;
  const codes: string[] = [];
  const used = new Set<string>();

  const maxAttemptsPerRecipient = 10000;

  for (const recipient of recipients) {
    const initials = deriveCheckinInitials({
      firstName: recipient.first_name,
      lastName: recipient.last_name,
      email: recipient.email,
      fallback: recipient.id,
    });

    let attempts = 0;
    let code = "";
    while (attempts < maxAttemptsPerRecipient) {
      attempts += 1;
      code = generateCheckinCode(initials);
      if (existingActiveCodes.has(code)) continue;
      if (used.has(code)) continue;
      break;
    }

    if (!code || existingActiveCodes.has(code) || used.has(code)) {
      throw new Error("Failed to generate unique codes");
    }

    used.add(code);
    codes.push(code);
  }

  return codes;
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", userId)
      .single();

    if (!canManageCodes(userData?.role as any)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const audience = (body.audience || "all") as Audience;
    const recipientUserId = body.recipientUserId;
    const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : null;

    if (audience === "one" && !isValidUuid(recipientUserId)) {
      return NextResponse.json(
        { error: "recipientUserId is required for audience=one" },
        { status: 400 }
      );
    }

    let recipients: Array<{
      id: string;
      email: string;
      first_name: string;
      last_name: string;
    }> = [];

    const authUsers = await listAllAuthUsers();

    if (audience === "one") {
      if (!authUsers.has(String(recipientUserId))) {
        return NextResponse.json(
          { error: "Recipient does not have an auth account (auth.users)" },
          { status: 400 }
        );
      }

      const { data: u, error: uErr } = await supabaseAdmin
        .from("users")
        .select("id, email, is_active")
        .eq("id", recipientUserId)
        .single();

      if (uErr || !u?.email || u.is_active !== true) {
        return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
      }

      const { data: p } = await supabaseAdmin
        .from("profiles")
        .select("first_name, last_name")
        .eq("user_id", u.id)
        .single();

      recipients = [
        {
          id: u.id,
          email: String(u.email || "").trim() || authUsers.get(String(u.id)) || "",
          first_name: p?.first_name ? safeDecrypt(p.first_name) : "",
          last_name: p?.last_name ? safeDecrypt(p.last_name) : "",
        },
      ];
    } else {
      const { data: users, error: usersErr } = await supabaseAdmin
        .from("users")
        .select("id, email, is_active")
        .eq("is_active", true)
        .order("email", { ascending: true });

      if (usersErr) {
        return NextResponse.json({ error: usersErr.message }, { status: 400 });
      }

      const userIds = (users || [])
        .map((u: any) => String(u.id))
        .filter((id: string) => authUsers.has(id));

      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("user_id, first_name, last_name")
        .in("user_id", userIds);

      const profileMap = new Map(
        (profiles || []).map((p: any) => [
          p.user_id,
          {
            first_name: p.first_name ? safeDecrypt(p.first_name) : "",
            last_name: p.last_name ? safeDecrypt(p.last_name) : "",
          },
        ])
      );

      recipients = (users || [])
        .filter((u: any) => Boolean(u.email))
        .filter((u: any) => authUsers.has(String(u.id)))
        .map((u: any) => {
          const profile = profileMap.get(u.id);
          return {
            id: u.id,
            email: String(u.email || "").trim() || authUsers.get(String(u.id)) || "",
            first_name: profile?.first_name || "",
            last_name: profile?.last_name || "",
          };
        });
    }

    const validRecipients = recipients.filter((r) => r.email && authUsers.has(String(r.id)));
    const skippedCount = recipients.length - validRecipients.length;

    if (validRecipients.length === 0) {
      return NextResponse.json(
        { error: "No recipients found (must exist in auth.users and have email)" },
        { status: 400 }
      );
    }

    // Ensure only one active personal code per user by deactivating previous personal codes
    const deactivateChunkSize = 200;
    for (let i = 0; i < validRecipients.length; i += deactivateChunkSize) {
      const chunkIds = validRecipients.slice(i, i + deactivateChunkSize).map((r) => r.id);
      const { error: deactivateError } = await supabaseAdmin
        .from("checkin_codes")
        .update({ is_active: false })
        .in("target_user_id", chunkIds as any)
        .eq("is_active", true);

      if (deactivateError) {
        console.error("Error deactivating previous personal codes:", deactivateError);
      }
    }

    const { data: existingCodes } = await supabaseAdmin
      .from("checkin_codes")
      .select("code")
      .eq("is_active", true);

    const existingActiveCodes = new Set(
      (existingCodes || []).map((r: any) => String(r.code))
    );

    const codes = await generateUniqueCodes({
      recipients: validRecipients,
      existingActiveCodes,
    });

    const rows = validRecipients.map((r, idx) => ({
      code: codes[idx],
      created_by: userId,
      target_user_id: r.id,
      is_active: true,
      label,
      expires_at: "9999-12-31T23:59:59.999Z",
    }));

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("checkin_codes")
      .insert(rows as any)
      .select("id, code, target_user_id");

    if (insertError) {
      console.error("Error creating personal Employee ID Codes:", insertError);
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      generatedCount: inserted?.length || validRecipients.length,
      skippedCount,
    });
  } catch (err: any) {
    console.error("Error generating personal Employee ID Codes:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
