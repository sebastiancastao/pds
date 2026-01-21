import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";

function isValidUUID(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function generateTemporaryPassword(): string {
  const length = 16;
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowercase = "abcdefghijkmnopqrstuvwxyz";
  const numbers = "23456789";
  const special = "!@#$%&*";

  let password = "";
  password += uppercase[crypto.randomInt(0, uppercase.length)];
  password += lowercase[crypto.randomInt(0, lowercase.length)];
  password += numbers[crypto.randomInt(0, numbers.length)];
  password += special[crypto.randomInt(0, special.length)];

  const allChars = uppercase + lowercase + numbers + special;
  for (let i = password.length; i < length; i++) {
    password += allChars[crypto.randomInt(0, allChars.length)];
  }

  return password
    .split("")
    .sort(() => crypto.randomInt(0, 3) - 1)
    .join("");
}

function getClientIP(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}

function getUserAgent(headers: Headers): string {
  return headers.get("user-agent") || "unknown";
}

function createSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL).");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Optional: quick sanity check
 * GET /api/users/reset-password -> 200 if route exists
 */
export async function GET() {
  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest) {
  const clientIP = getClientIP(request.headers);
  const userAgent = getUserAgent(request.headers);

  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const token = authHeader.replace("Bearer ", "").trim();

    const body = await request.json().catch(() => null);
    const userId = body?.userId;
    const sendEmail = Boolean(body?.sendEmail);

    if (!userId || typeof userId !== "string" || !isValidUUID(userId)) {
      return NextResponse.json({ error: "Valid user ID is required" }, { status: 400 });
    }

    const supabase = createSupabaseAdmin();

    // 1) Verify the requester (admin) via JWT
    const { data: adminAuthData, error: adminAuthError } = await supabase.auth.getUser(token);
    const adminUser = adminAuthData?.user;

    if (adminAuthError || !adminUser) {
      return NextResponse.json({ error: "Authentication failed" }, { status: 401 });
    }

    // 2) Confirm admin role (your schema: users.id is uuid)
    const { data: adminRow, error: adminRowError } = await supabase
      .from("users")
      .select("role")
      .eq("id", adminUser.id)
      .maybeSingle();

    if (adminRowError) {
      console.error("[RESET-PASSWORD] adminRowError:", adminRowError);
      return NextResponse.json({ error: "Failed to verify admin role" }, { status: 500 });
    }

    if (!adminRow?.role || !["exec", "admin"].includes(adminRow.role)) {
      return NextResponse.json(
        { error: "Unauthorized: Admin/Exec access required" },
        { status: 403 }
      );
    }

    // 3) Lookup target user in users table
    const { data: targetUser, error: targetUserError } = await supabase
      .from("users")
      .select("id,email")
      .eq("id", userId)
      .maybeSingle();

    if (targetUserError) {
      console.error("[RESET-PASSWORD] targetUserError:", targetUserError);
      return NextResponse.json({ error: "DB lookup failed" }, { status: 500 });
    }

    if (!targetUser) {
      // IMPORTANT: this tells you it’s the DB lookup failing (not routing)
      return NextResponse.json(
        {
          error: "User not found in users table",
          debug: { receivedUserId: userId },
        },
        { status: 404 }
      );
    }

    // 4) Ensure that same UUID exists in Supabase Auth
    const { data: authUserData, error: authUserError } = await supabase.auth.admin.getUserById(userId);

    if (authUserError) {
      console.error("[RESET-PASSWORD] authUserError:", authUserError);
      return NextResponse.json({ error: "Auth lookup failed" }, { status: 500 });
    }

    if (!authUserData?.user) {
      return NextResponse.json(
        {
          error: "User not found in Supabase Auth",
          debug: { receivedUserId: userId },
        },
        { status: 404 }
      );
    }

    // 5) Get profile name (assuming profiles.user_id is the auth UUID)
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("first_name,last_name")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileError) {
      // not fatal
      console.error("[RESET-PASSWORD] profileError:", profileError);
    }

    const firstName = profile?.first_name || "User";
    const lastName = profile?.last_name || "";

    // 6) Generate new temp password + expiry
    const temporaryPassword = generateTemporaryPassword();
    const passwordExpiresAt = new Date();
    passwordExpiresAt.setDate(passwordExpiresAt.getDate() + 7);

    // 7) Update Auth password
    const { error: updateAuthError } = await supabase.auth.admin.updateUserById(userId, {
      password: temporaryPassword,
    });

    if (updateAuthError) {
      console.error("[RESET-PASSWORD] updateAuthError:", updateAuthError);
      return NextResponse.json({ error: "Failed to reset password in auth system" }, { status: 500 });
    }

    // 8) Update users table flags
    const { error: updateUserError } = await supabase
      .from("users")
      .update({
        is_temporary_password: true,
        must_change_password: true,
        password_expires_at: passwordExpiresAt.toISOString(),
        last_password_change: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (updateUserError) {
      console.error("[RESET-PASSWORD] updateUserError:", updateUserError);
      // don't fail since auth password already changed
    }

    // 9) Reset MFA in profiles (assuming profiles.user_id)
    const { error: resetMfaError } = await supabase
      .from("profiles")
      .update({
        mfa_enabled: false,
        mfa_secret: null,
        backup_codes: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (resetMfaError) {
      console.error("[RESET-PASSWORD] resetMfaError:", resetMfaError);
    }

    // 10) Optional send email
    if (sendEmail) {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        const emailResponse = await fetch(`${baseUrl}/api/auth/send-credentials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            email: targetUser.email,
            firstName,
            lastName,
            temporaryPassword,
          }),
        });

        if (!emailResponse.ok) {
          console.error("[RESET-PASSWORD] Failed to send credentials email");
        }
      } catch (e) {
        console.error("[RESET-PASSWORD] Email send error:", e);
      }
    }

    return NextResponse.json({
      success: true,
      message: "Password reset successfully",
      temporaryPassword,
      email: targetUser.email,
      firstName,
      lastName,
      expiresAt: passwordExpiresAt.toISOString(),
      meta: { requester: adminUser.id, ipAddress: clientIP, userAgent },
    });
  } catch (err: any) {
    console.error("[RESET-PASSWORD] Unhandled error:", err);
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
  }
}
