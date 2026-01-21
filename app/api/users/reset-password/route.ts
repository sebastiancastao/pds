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
  console.log("[RESET-PASSWORD] ====== GET request received (health check) ======");
  return NextResponse.json({ ok: true, route: "/api/users/reset-password", timestamp: new Date().toISOString() });
}

export async function POST(request: NextRequest) {
  console.log("[RESET-PASSWORD] ====== POST request received ======");
  console.log("[RESET-PASSWORD] URL:", request.url);
  console.log("[RESET-PASSWORD] Method:", request.method);

  const clientIP = getClientIP(request.headers);
  const userAgent = getUserAgent(request.headers);
  console.log("[RESET-PASSWORD] Client IP:", clientIP);
  console.log("[RESET-PASSWORD] User Agent:", userAgent);

  try {
    const authHeader = request.headers.get("authorization");
    console.log("[RESET-PASSWORD] Auth header present:", !!authHeader);

    if (!authHeader?.startsWith("Bearer ")) {
      console.log("[RESET-PASSWORD] ERROR: Missing or invalid auth header");
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const token = authHeader.replace("Bearer ", "").trim();
    console.log("[RESET-PASSWORD] Token extracted, length:", token.length);

    const body = await request.json().catch((e) => {
      console.log("[RESET-PASSWORD] ERROR parsing JSON body:", e);
      return null;
    });
    console.log("[RESET-PASSWORD] Request body:", JSON.stringify(body));

    const userId = body?.userId;
    const userEmail = body?.userEmail; // Optional email for fallback lookup
    const sendEmail = Boolean(body?.sendEmail);
    console.log("[RESET-PASSWORD] userId:", userId);
    console.log("[RESET-PASSWORD] userEmail:", userEmail);
    console.log("[RESET-PASSWORD] sendEmail:", sendEmail);

    if (!userId || typeof userId !== "string" || !isValidUUID(userId)) {
      console.log("[RESET-PASSWORD] ERROR: Invalid userId - value:", userId, "isValidUUID:", userId ? isValidUUID(userId) : "N/A");
      return NextResponse.json({ error: "Valid user ID is required" }, { status: 400 });
    }

    console.log("[RESET-PASSWORD] Creating Supabase admin client...");
    const supabase = createSupabaseAdmin();
    console.log("[RESET-PASSWORD] Supabase admin client created successfully");

    // 1) Verify the requester (admin) via JWT
    console.log("[RESET-PASSWORD] Step 1: Verifying admin JWT...");
    const { data: adminAuthData, error: adminAuthError } = await supabase.auth.getUser(token);
    const adminUser = adminAuthData?.user;

    if (adminAuthError || !adminUser) {
      console.log("[RESET-PASSWORD] ERROR: Admin auth failed:", adminAuthError?.message);
      return NextResponse.json({ error: "Authentication failed" }, { status: 401 });
    }
    console.log("[RESET-PASSWORD] Admin authenticated:", adminUser.id, adminUser.email);

    // 2) Confirm admin role (your schema: users.id is uuid)
    console.log("[RESET-PASSWORD] Step 2: Checking admin role...");
    const { data: adminRow, error: adminRowError } = await supabase
      .from("users")
      .select("role")
      .eq("id", adminUser.id)
      .maybeSingle();

    if (adminRowError) {
      console.error("[RESET-PASSWORD] adminRowError:", adminRowError);
      return NextResponse.json({ error: "Failed to verify admin role" }, { status: 500 });
    }
    console.log("[RESET-PASSWORD] Admin role from DB:", adminRow?.role);

    if (!adminRow?.role || !["exec", "admin"].includes(adminRow.role)) {
      console.log("[RESET-PASSWORD] ERROR: User is not admin/exec, role:", adminRow?.role);
      return NextResponse.json(
        { error: "Unauthorized: Admin/Exec access required" },
        { status: 403 }
      );
    }
    console.log("[RESET-PASSWORD] Admin role verified!");

    // 3) Lookup target user in users table
    console.log("[RESET-PASSWORD] Step 3: Looking up target user in DB...", userId);
    console.log("[RESET-PASSWORD] userId type:", typeof userId);
    console.log("[RESET-PASSWORD] userId length:", userId.length);
    console.log("[RESET-PASSWORD] userId trimmed:", userId.trim());

    // First, let's see all users to debug
    const { data: allUsers, error: allUsersError } = await supabase
      .from("users")
      .select("id, email")
      .limit(5);

    console.log("[RESET-PASSWORD] Sample users in DB:", JSON.stringify(allUsers, null, 2));
    if (allUsersError) {
      console.error("[RESET-PASSWORD] Error fetching sample users:", allUsersError);
    }

    const { data: initialTargetUser, error: targetUserError } = await supabase
      .from("users")
      .select("id,email")
      .eq("id", userId)
      .maybeSingle();

    console.log("[RESET-PASSWORD] Query result - initialTargetUser:", initialTargetUser);
    console.log("[RESET-PASSWORD] Query result - targetUserError:", targetUserError);

    if (targetUserError) {
      console.error("[RESET-PASSWORD] targetUserError:", targetUserError);
      return NextResponse.json({ error: "DB lookup failed" }, { status: 500 });
    }

    // If not found by ID, try by email as fallback (similar to send-credentials endpoint)
    let targetUserFinal = initialTargetUser;
    if (!initialTargetUser) {
      console.log("[RESET-PASSWORD] User not found by ID. Trying email lookup as fallback...");
      
      // First, try email lookup if email was provided
      if (userEmail) {
        console.log("[RESET-PASSWORD] Attempting email lookup with provided email:", userEmail);
        const { data: emailLookupUser, error: emailLookupError } = await supabase
          .from("users")
          .select("id,email")
          .eq("email", userEmail.toLowerCase().trim())
          .maybeSingle();
        
        console.log("[RESET-PASSWORD] Email lookup result:", emailLookupUser ? { id: emailLookupUser.id, email: emailLookupUser.email } : null);
        console.log("[RESET-PASSWORD] Email lookup error:", emailLookupError?.message);

        if (emailLookupUser) {
          console.log("[RESET-PASSWORD] ✅ User found by email fallback! Using this user instead.");
          targetUserFinal = emailLookupUser;
        }
      }
      
      // If still not found, check Auth to get email and try again
      if (!targetUserFinal) {
        console.log("[RESET-PASSWORD] User not found by email. Checking if user exists in Supabase Auth...");
        const { data: authCheck, error: authCheckError } = await supabase.auth.admin.getUserById(userId);
        console.log("[RESET-PASSWORD] Auth check result:", authCheck?.user?.email, authCheckError?.message);

        if (authCheck?.user?.email && authCheck.user.email !== userEmail) {
          console.log("[RESET-PASSWORD] Trying email lookup with Auth email:", authCheck.user.email);
          const { data: emailLookupUser, error: emailLookupError } = await supabase
            .from("users")
            .select("id,email")
            .eq("email", authCheck.user.email.toLowerCase().trim())
            .maybeSingle();
          
          if (emailLookupUser) {
            console.log("[RESET-PASSWORD] ✅ User found by Auth email fallback! Using this user instead.");
            targetUserFinal = emailLookupUser;
          }
        }
      }
      
      // If still not found, return error
      if (!targetUserFinal) {
        console.log("[RESET-PASSWORD] ❌ User not found by ID or email.");
        
        return NextResponse.json(
          {
            error: "User not found in users table",
            debug: {
              receivedUserId: userId,
              receivedEmail: userEmail,
              userIdLength: userId.length,
              sampleDbUsers: allUsers?.map(u => ({ id: u.id, email: u.email }))
            },
          },
          { status: 404 }
        );
      }
    }
    
    // Use the final target user (either from ID lookup or email fallback)
    const targetUser = targetUserFinal;
    if (!targetUser) {
      return NextResponse.json(
        { error: "User not found in users table" },
        { status: 404 }
      );
    }
    console.log("[RESET-PASSWORD] Target user found:", targetUser.id, targetUser.email);

    // 4) Ensure that same UUID exists in Supabase Auth
    // Use original userId for Auth lookup (may differ if we used email fallback)
    console.log("[RESET-PASSWORD] Step 4: Verifying user exists in Supabase Auth...");
    // First try with the original userId, then try with targetUser.id if that fails
    let authUserIdToUse = userId;
    let { data: authUserData, error: authUserError } = await supabase.auth.admin.getUserById(userId);
    
    // If original userId not found in Auth but we have targetUser, try with targetUser.id
    if (authUserError && targetUser) {
      console.log("[RESET-PASSWORD] Original userId not found in Auth, trying with targetUser.id...");
      const authCheckRetry = await supabase.auth.admin.getUserById(targetUser.id);
      if (authCheckRetry.data?.user) {
        authUserData = authCheckRetry.data;
        authUserError = authCheckRetry.error;
        authUserIdToUse = targetUser.id;
        console.log("[RESET-PASSWORD] Found user in Auth with targetUser.id");
      }
    }

    if (authUserError) {
      console.error("[RESET-PASSWORD] authUserError:", authUserError);
      return NextResponse.json({ error: "Auth lookup failed" }, { status: 500 });
    }

    if (!authUserData?.user) {
      console.log("[RESET-PASSWORD] ERROR: User not found in Supabase Auth");
      return NextResponse.json(
        {
          error: "User not found in Supabase Auth",
          debug: { receivedUserId: userId },
        },
        { status: 404 }
      );
    }
    console.log("[RESET-PASSWORD] User exists in Supabase Auth:", authUserData.user.id);

    // 5) Get profile name (using targetUser.id - the database user ID)
    console.log("[RESET-PASSWORD] Step 5: Getting profile info...");
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("first_name,last_name")
      .eq("user_id", targetUser.id)
      .maybeSingle();

    if (profileError) {
      console.error("[RESET-PASSWORD] profileError (non-fatal):", profileError);
    }

    const firstName = profile?.first_name || "User";
    const lastName = profile?.last_name || "";
    console.log("[RESET-PASSWORD] Profile name:", firstName, lastName);

    // 6) Generate new temp password + expiry
    console.log("[RESET-PASSWORD] Step 6: Generating temporary password...");
    const temporaryPassword = generateTemporaryPassword();
    const passwordExpiresAt = new Date();
    passwordExpiresAt.setDate(passwordExpiresAt.getDate() + 7);
    console.log("[RESET-PASSWORD] Temp password generated, expires:", passwordExpiresAt.toISOString());

    // 7) Update Auth password (use the Auth user ID we found)
    console.log("[RESET-PASSWORD] Step 7: Updating password in Supabase Auth...");
    const { error: updateAuthError } = await supabase.auth.admin.updateUserById(authUserIdToUse, {
      password: temporaryPassword,
    });

    if (updateAuthError) {
      console.error("[RESET-PASSWORD] updateAuthError:", updateAuthError);
      return NextResponse.json({ error: "Failed to reset password in auth system" }, { status: 500 });
    }
    console.log("[RESET-PASSWORD] Auth password updated successfully!");

    // 8) Update users table flags (use targetUser.id - the database user ID)
    console.log("[RESET-PASSWORD] Step 8: Updating users table flags...");
    const { error: updateUserError } = await supabase
      .from("users")
      .update({
        is_temporary_password: true,
        must_change_password: true,
        password_expires_at: passwordExpiresAt.toISOString(),
        last_password_change: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", targetUser.id);

    if (updateUserError) {
      console.error("[RESET-PASSWORD] updateUserError (non-fatal):", updateUserError);
    } else {
      console.log("[RESET-PASSWORD] Users table flags updated!");
    }

    // 9) Reset MFA in profiles (use targetUser.id - the database user ID)
    console.log("[RESET-PASSWORD] Step 9: Resetting MFA...");
    const { error: resetMfaError } = await supabase
      .from("profiles")
      .update({
        mfa_enabled: false,
        mfa_secret: null,
        backup_codes: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", targetUser.id);

    if (resetMfaError) {
      console.error("[RESET-PASSWORD] resetMfaError (non-fatal):", resetMfaError);
    } else {
      console.log("[RESET-PASSWORD] MFA reset successfully!");
    }

    // 10) Optional send email
    if (sendEmail) {
      console.log("[RESET-PASSWORD] Step 10: Sending credentials email...");
      try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        console.log("[RESET-PASSWORD] Email API URL:", `${baseUrl}/api/auth/send-credentials`);
        const emailResponse = await fetch(`${baseUrl}/api/auth/send-credentials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: targetUser.id, // Use database user ID
            email: targetUser.email,
            firstName,
            lastName,
            temporaryPassword,
          }),
        });

        if (!emailResponse.ok) {
          console.error("[RESET-PASSWORD] Failed to send credentials email, status:", emailResponse.status);
        } else {
          console.log("[RESET-PASSWORD] Credentials email sent successfully!");
        }
      } catch (e) {
        console.error("[RESET-PASSWORD] Email send error:", e);
      }
    } else {
      console.log("[RESET-PASSWORD] Step 10: Skipping email (sendEmail=false)");
    }

    console.log("[RESET-PASSWORD] ====== SUCCESS! Password reset complete ======");
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
    console.error("[RESET-PASSWORD] ====== UNHANDLED ERROR ======");
    console.error("[RESET-PASSWORD] Error:", err);
    console.error("[RESET-PASSWORD] Stack:", err?.stack);
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
  }
}
