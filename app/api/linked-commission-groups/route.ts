import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { fetchLinkedCommissionGroups } from "@/lib/linked-commission-groups";

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

async function getAuthedUserId(req: NextRequest): Promise<string | null> {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user.id;
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (!token) return null;
  const { data: tokenUser, error } = await supabaseAnon.auth.getUser(token);
  if (error || !tokenUser?.user?.id) return null;
  return tokenUser.user.id;
}

// GET /api/linked-commission-groups?event_ids=a,b,c
// Returns every event that shares a commission pool with any of the given events
// (whole groups, not just the direct partner), so payroll screens can load the full
// group even when some members fall outside the pay period they are viewing.
export async function GET(req: NextRequest) {
  try {
    const userId = await getAuthedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const groups = await fetchLinkedCommissionGroups(supabaseAdmin, searchParams.get("event_ids") || "");
    return NextResponse.json(groups, { status: 200 });
  } catch (err: any) {
    console.error("[LINKED-COMMISSION-GROUPS] error:", err);
    return NextResponse.json({ error: err?.message || "Failed to load linked commission groups" }, { status: 500 });
  }
}
