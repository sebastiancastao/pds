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
  return ["manager", "supervisor", "hr", "exec", "admin"].includes(String(role || ""));
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function listAllAuthUserIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  const perPage = 1000;
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;
    const users = data?.users || [];
    for (const u of users as any[]) {
      if (u?.id) ids.add(String(u.id));
    }
    if (users.length < perPage) break;
  }
  return ids;
}

export async function GET(req: NextRequest) {
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

    const authUserIds = await listAllAuthUserIds();

    const { data: users, error: usersError } = await supabaseAdmin
      .from("users")
      .select("id, email, role, is_active")
      .eq("is_active", true)
      .order("email", { ascending: true });

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 400 });
    }

    const userIds = (users || []).map((u: any) => u.id);
    let profileMap = new Map<string, { profile_id: string; first_name: string; last_name: string; onboarding_completed_at: string | null }>();
    const adminCompletedProfileIds = new Set<string>();
    const latestEmailSentAtByUserId = new Map<string, string>();

    if (userIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabaseAdmin
        .from("profiles")
        .select("id, user_id, first_name, last_name, onboarding_completed_at")
        .in("user_id", userIds);

      if (!profilesError && profiles) {
        profileMap = new Map(
          profiles.map((p: any) => [
            p.user_id,
            {
              profile_id: p.id,
              first_name: safeDecrypt(p.first_name),
              last_name: safeDecrypt(p.last_name),
              onboarding_completed_at: p.onboarding_completed_at || null,
            },
          ])
        );
      }

      // Also check vendor_onboarding_status for admin-marked completion
      const profileIds = (profiles || []).map((p: any) => String(p.id)).filter(Boolean);
      if (profileIds.length > 0) {
        const { data: vendorStatuses } = await supabaseAdmin
          .from("vendor_onboarding_status")
          .select("profile_id")
          .in("profile_id", profileIds)
          .eq("onboarding_completed", true);

        if (vendorStatuses) {
          for (const vs of vendorStatuses as any[]) {
            adminCompletedProfileIds.add(String(vs.profile_id));
          }
        }
      }
    }

    if (userIds.length > 0) {
      const chunks = chunkArray(userIds, 200);
      for (const chunk of chunks) {
        const { data: sendLogs, error: sendLogsError } = await supabaseAdmin
          .from("employee_id_code_email_sends")
          .select("user_id, sent_at")
          .in("user_id", chunk as any)
          .order("sent_at", { ascending: false });

        // Keep this endpoint working in environments where migration 042
        // has not been applied yet.
        if (sendLogsError) {
          console.warn(
            "[checkin-codes/recipients] Unable to read employee_id_code_email_sends:",
            sendLogsError.message
          );
          break;
        }

        for (const row of (sendLogs || []) as any[]) {
          const sentUserId = String(row?.user_id || "");
          const sentAt = String(row?.sent_at || "");
          if (!sentUserId || !sentAt) continue;
          if (!latestEmailSentAtByUserId.has(sentUserId)) {
            latestEmailSentAtByUserId.set(sentUserId, sentAt);
          }
        }
      }
    }

    const recipients = (users || [])
      .filter((u: any) => authUserIds.has(String(u.id)))
      .map((u: any) => {
        const profile = profileMap.get(u.id);
        const onboardingCompleted = Boolean(
          profile?.onboarding_completed_at ||
          (profile?.profile_id && adminCompletedProfileIds.has(profile.profile_id))
        );
        const last_sent_at = latestEmailSentAtByUserId.get(String(u.id)) || null;
        return {
          id: u.id,
          email: u.email,
          role: u.role,
          first_name: profile?.first_name || "",
          last_name: profile?.last_name || "",
          onboarding_completed: onboardingCompleted,
          email_sent: Boolean(last_sent_at),
          last_sent_at,
        };
      })
      .filter((u: any) => Boolean(u.email));

    return NextResponse.json({ users: recipients });
  } catch (err) {
    console.error("Error fetching check-in recipients:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
