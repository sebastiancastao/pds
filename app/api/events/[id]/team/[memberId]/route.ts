import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const MANAGE_ROLES = new Set(["exec", "admin", "manager", "supervisor", "supervisor2"]);

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  let { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
    if (!tokenErr && tokenUser?.user?.id) return tokenUser.user as any;
  }

  return null;
}

function isMissingRelationError(error: any): boolean {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || "");
  return code === "42P01" || /relation .* does not exist/i.test(message);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; memberId: string } }
) {
  try {
    const eventId = String(params?.id || "").trim();
    const memberId = String(params?.memberId || "").trim();

    if (!eventId || !memberId) {
      return NextResponse.json({ error: "Event ID and member ID are required" }, { status: 400 });
    }

    const user = await getAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: event, error: eventError } = await supabaseAdmin
      .from("events")
      .select("id, created_by")
      .eq("id", eventId)
      .maybeSingle();

    if (eventError) {
      return NextResponse.json({ error: eventError.message }, { status: 500 });
    }
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const isCreator = event.created_by === user.id;
    if (!isCreator) {
      const { data: requester, error: requesterError } = await supabaseAdmin
        .from("users")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (requesterError) {
        return NextResponse.json({ error: requesterError.message }, { status: 500 });
      }

      const role = String(requester?.role || "").toLowerCase().trim();
      if (!MANAGE_ROLES.has(role)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
    }

    const { data: teamMember, error: teamMemberError } = await supabaseAdmin
      .from("event_teams")
      .select("id, vendor_id")
      .eq("id", memberId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (teamMemberError) {
      return NextResponse.json({ error: teamMemberError.message }, { status: 500 });
    }
    if (!teamMember) {
      return NextResponse.json({ error: "Team member not found for this event" }, { status: 404 });
    }

    const { error: assignmentDeleteError } = await supabaseAdmin
      .from("event_location_assignments")
      .delete()
      .eq("event_id", eventId)
      .eq("vendor_id", teamMember.vendor_id);

    if (assignmentDeleteError && !isMissingRelationError(assignmentDeleteError)) {
      return NextResponse.json({ error: assignmentDeleteError.message }, { status: 500 });
    }

    const { data: deletedRows, error: deleteError } = await supabaseAdmin
      .from("event_teams")
      .delete()
      .eq("id", teamMember.id)
      .eq("event_id", eventId)
      .select("id");

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }
    if (!deletedRows || deletedRows.length === 0) {
      return NextResponse.json({ error: "Team member was not removed" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: "Team member uninvited successfully",
      memberId: teamMember.id,
      vendorId: teamMember.vendor_id,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to uninvite team member" },
      { status: 500 }
    );
  }
}
