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

type AuthContext = {
  user: { id: string };
  role: string;
};

const MANAGE_ROLES = new Set(["exec", "admin", "manager", "supervisor", "supervisor2"]);

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
    if (!tokenErr && tokenUser?.user?.id) return tokenUser.user as any;
  }
  return null;
}

async function getAuthContext(req: NextRequest): Promise<AuthContext | null> {
  const user = await getAuthedUser(req);
  if (!user?.id) return null;

  const { data: requester, error: requesterError } = await supabaseAdmin
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (requesterError) {
    throw new Error(requesterError.message);
  }

  return {
    user: { id: user.id },
    role: String(requester?.role || "").toLowerCase().trim(),
  };
}

async function canAccessEvent(eventId: string, auth: AuthContext): Promise<boolean> {
  const { data: event, error: eventError } = await supabaseAdmin
    .from("events")
    .select("id, created_by")
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) {
    throw new Error(eventError.message);
  }

  if (!event) return false;
  if (auth.role === "exec" || auth.role === "admin") return true;
  if (event.created_by === auth.user.id) return true;

  if (auth.role === "supervisor" || auth.role === "supervisor2") {
    const { data: links, error: linksError } = await supabaseAdmin
      .from("manager_team_members")
      .select("manager_id")
      .eq("member_id", auth.user.id)
      .eq("is_active", true);

    if (linksError) {
      throw new Error(linksError.message);
    }

    if ((links || []).some((row) => row.manager_id === event.created_by)) return true;
  }

  return false;
}

async function getLocationsAndAssignments(eventId: string) {
  const [locationsResult, assignmentsResult] = await Promise.all([
    supabaseAdmin
      .from("event_locations")
      .select("id, event_id, name, notes, display_order, created_at, updated_at")
      .eq("event_id", eventId)
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("event_location_assignments")
      .select("id, event_id, location_id, vendor_id, created_at, updated_at")
      .eq("event_id", eventId),
  ]);

  if (locationsResult.error) throw new Error(locationsResult.error.message);
  if (assignmentsResult.error) throw new Error(assignmentsResult.error.message);

  return {
    locations: locationsResult.data || [],
    assignments: assignmentsResult.data || [],
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const eventId = params.id;
    if (!eventId) {
      return NextResponse.json({ error: "Event ID is required" }, { status: 400 });
    }

    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const allowed = await canAccessEvent(eventId, auth);
    if (!allowed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const result = await getLocationsAndAssignments(eventId);
    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to load locations" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const eventId = params.id;
    if (!eventId) {
      return NextResponse.json({ error: "Event ID is required" }, { status: 400 });
    }

    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const allowed = await canAccessEvent(eventId, auth);
    if (!allowed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    if (!MANAGE_ROLES.has(auth.role)) {
      return NextResponse.json({ error: "You do not have permission to manage locations" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const name = normalizeText(body?.name);
    const notes = normalizeText(body?.notes) || null;

    if (!name) {
      return NextResponse.json({ error: "Location name is required" }, { status: 400 });
    }
    if (name.length > 120) {
      return NextResponse.json({ error: "Location name is too long (max 120 chars)" }, { status: 400 });
    }

    const { data: existingLocations, error: existingError } = await supabaseAdmin
      .from("event_locations")
      .select("id, name")
      .eq("event_id", eventId);

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    const duplicate = (existingLocations || []).find(
      (loc) => String(loc.name || "").trim().toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      return NextResponse.json({ error: "A location with this name already exists for this event" }, { status: 409 });
    }

    const maxDisplayOrder = (existingLocations || []).length;
    const { data: location, error: insertError } = await supabaseAdmin
      .from("event_locations")
      .insert({
        event_id: eventId,
        name,
        notes,
        display_order: maxDisplayOrder,
        created_by: auth.user.id,
      })
      .select("id, event_id, name, notes, display_order, created_at, updated_at")
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, location }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to create location" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const eventId = params.id;
    if (!eventId) {
      return NextResponse.json({ error: "Event ID is required" }, { status: 400 });
    }

    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const allowed = await canAccessEvent(eventId, auth);
    if (!allowed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    if (!MANAGE_ROLES.has(auth.role)) {
      return NextResponse.json({ error: "You do not have permission to manage locations" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const locationId = normalizeText(body?.locationId);
    const teamMemberIdsRaw: unknown[] | null = Array.isArray(body?.teamMemberIds) ? body.teamMemberIds : null;
    const name = body?.name !== undefined ? normalizeText(body?.name) : undefined;
    const notes = body?.notes !== undefined ? normalizeText(body?.notes) : undefined;

    if (!locationId) {
      return NextResponse.json({ error: "locationId is required" }, { status: 400 });
    }

    const { data: existingLocation, error: existingLocationError } = await supabaseAdmin
      .from("event_locations")
      .select("id, event_id, name")
      .eq("id", locationId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (existingLocationError) {
      return NextResponse.json({ error: existingLocationError.message }, { status: 500 });
    }
    if (!existingLocation) {
      return NextResponse.json({ error: "Location not found for this event" }, { status: 404 });
    }

    if (name !== undefined || notes !== undefined) {
      const updatePayload: Record<string, any> = {};
      if (name !== undefined) {
        if (!name) {
          return NextResponse.json({ error: "Location name cannot be empty" }, { status: 400 });
        }
        if (name.length > 120) {
          return NextResponse.json({ error: "Location name is too long (max 120 chars)" }, { status: 400 });
        }

        const { data: locationsWithSameName, error: sameNameError } = await supabaseAdmin
          .from("event_locations")
          .select("id, name")
          .eq("event_id", eventId);
        if (sameNameError) {
          return NextResponse.json({ error: sameNameError.message }, { status: 500 });
        }

        const duplicate = (locationsWithSameName || []).find((loc) => {
          if (loc.id === locationId) return false;
          return String(loc.name || "").trim().toLowerCase() === name.toLowerCase();
        });
        if (duplicate) {
          return NextResponse.json({ error: "A location with this name already exists for this event" }, { status: 409 });
        }

        updatePayload.name = name;
      }
      if (notes !== undefined) {
        updatePayload.notes = notes || null;
      }

      if (Object.keys(updatePayload).length > 0) {
        const { error: updateLocationError } = await supabaseAdmin
          .from("event_locations")
          .update(updatePayload)
          .eq("id", locationId)
          .eq("event_id", eventId);
        if (updateLocationError) {
          return NextResponse.json({ error: updateLocationError.message }, { status: 500 });
        }
      }
    }

    if (teamMemberIdsRaw !== null) {
      const uniqueMemberIds = Array.from(
        new Set(teamMemberIdsRaw.map((id) => normalizeText(id)).filter(Boolean))
      );

      if (uniqueMemberIds.length > 0) {
        const { data: validTeamMembers, error: teamMembersError } = await supabaseAdmin
          .from("event_teams")
          .select("vendor_id")
          .eq("event_id", eventId)
          .in("vendor_id", uniqueMemberIds);

        if (teamMembersError) {
          return NextResponse.json({ error: teamMembersError.message }, { status: 500 });
        }

        const validSet = new Set((validTeamMembers || []).map((row) => row.vendor_id));
        const invalidIds = uniqueMemberIds.filter((id) => !validSet.has(id));
        if (invalidIds.length > 0) {
          return NextResponse.json(
            { error: "Some users are not part of this event team", invalidIds },
            { status: 400 }
          );
        }
      }

      const { data: currentAssignments, error: currentAssignmentsError } = await supabaseAdmin
        .from("event_location_assignments")
        .select("vendor_id")
        .eq("event_id", eventId)
        .eq("location_id", locationId);

      if (currentAssignmentsError) {
        return NextResponse.json({ error: currentAssignmentsError.message }, { status: 500 });
      }

      const currentMemberIds = (currentAssignments || []).map((row) => row.vendor_id);
      const toRemove = currentMemberIds.filter((id) => !uniqueMemberIds.includes(id));
      if (toRemove.length > 0) {
        const { error: removeError } = await supabaseAdmin
          .from("event_location_assignments")
          .delete()
          .eq("event_id", eventId)
          .eq("location_id", locationId)
          .in("vendor_id", toRemove);
        if (removeError) {
          return NextResponse.json({ error: removeError.message }, { status: 500 });
        }
      }

      if (uniqueMemberIds.length > 0) {
        const now = new Date().toISOString();
        const upsertPayload = uniqueMemberIds.map((vendorId) => ({
          event_id: eventId,
          location_id: locationId,
          vendor_id: vendorId,
          assigned_by: auth.user.id,
          updated_at: now,
        }));

        const { error: upsertError } = await supabaseAdmin
          .from("event_location_assignments")
          .upsert(upsertPayload, { onConflict: "event_id,vendor_id" });
        if (upsertError) {
          return NextResponse.json({ error: upsertError.message }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to update location" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const eventId = params.id;
    if (!eventId) {
      return NextResponse.json({ error: "Event ID is required" }, { status: 400 });
    }

    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const allowed = await canAccessEvent(eventId, auth);
    if (!allowed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    if (!MANAGE_ROLES.has(auth.role)) {
      return NextResponse.json({ error: "You do not have permission to manage locations" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const locationId = normalizeText(body?.locationId);
    if (!locationId) {
      return NextResponse.json({ error: "locationId is required" }, { status: 400 });
    }

    const { error: deleteError } = await supabaseAdmin
      .from("event_locations")
      .delete()
      .eq("id", locationId)
      .eq("event_id", eventId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to delete location" }, { status: 500 });
  }
}
