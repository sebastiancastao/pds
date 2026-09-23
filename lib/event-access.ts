import { SupabaseClient } from "@supabase/supabase-js";

export type EventAccessAuth = {
  userId: string;
  role: string;
};

type EventAccessEvent = {
  id: string;
  created_by: string | null;
  venue: string | null;
};

const SUPERVISOR_ROLES = new Set(["supervisor", "supervisor2", "supervisor3", "supervisor4"]);

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

async function isUserOnEventTeam(
  supabaseAdmin: SupabaseClient,
  eventId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("event_teams")
    .select("event_id")
    .eq("event_id", eventId)
    .eq("vendor_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}

/**
 * Venues an exec assigned to a supervisor through the supervisor-team venue
 * screen (supervisor3_team_venue_assignments). These are separate from
 * venue_managers rows and must count as the supervisor's own venues.
 */
export async function getSupervisorTeamVenueIds(
  supabaseAdmin: SupabaseClient,
  supervisorId: string
): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("supervisor3_team_venue_assignments")
    .select("venue_id")
    .eq("supervisor_id", supervisorId);

  if (error) {
    // Table may not exist in every environment; treat as no assignments.
    if (error.code === "42P01" || /does not exist/i.test(error.message || "")) {
      return [];
    }
    throw new Error(error.message);
  }

  return (data || [])
    .map((row: any) => normalizeText(row?.venue_id))
    .filter(Boolean);
}

async function getAssignedVenueNames(
  supabaseAdmin: SupabaseClient,
  managerIds: string[],
  extraVenueIds: string[] = []
): Promise<Set<string>> {
  let venueLinks: any[] = [];
  if (managerIds.length > 0) {
    const { data, error: venueLinksError } = await supabaseAdmin
      .from("venue_managers")
      .select("venue_id")
      .in("manager_id", managerIds)
      .eq("is_active", true);

    if (venueLinksError) {
      throw new Error(venueLinksError.message);
    }
    venueLinks = data || [];
  }

  const venueIds = Array.from(
    new Set([
      ...venueLinks.map((row: any) => normalizeText(row?.venue_id)),
      ...extraVenueIds.map(normalizeText),
    ])
  ).filter(Boolean);

  if (venueIds.length === 0) {
    return new Set<string>();
  }

  const { data: venueRefs, error: venueRefsError } = await supabaseAdmin
    .from("venue_reference")
    .select("venue_name")
    .in("id", venueIds);

  if (venueRefsError) {
    throw new Error(venueRefsError.message);
  }

  return new Set(
    (venueRefs || [])
      .map((row: any) => normalizeText(row?.venue_name))
      .filter(Boolean)
  );
}

async function getDirectManagerIds(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<string[]> {
  const { data: teamLinks, error: teamLinksError } = await supabaseAdmin
    .from("manager_team_members")
    .select("manager_id")
    .eq("member_id", userId)
    .eq("is_active", true);

  if (teamLinksError) {
    throw new Error(teamLinksError.message);
  }

  return Array.from(
    new Set(
      (teamLinks || [])
        .map((row: any) => normalizeText(row?.manager_id))
        .filter(Boolean)
    )
  );
}

async function getSupervisorGroupCreatorIds(
  supabaseAdmin: SupabaseClient,
  userId: string,
  managerIds: string[]
): Promise<Set<string>> {
  const allowedCreatorIds = new Set<string>([userId]);
  managerIds.forEach((managerId) => allowedCreatorIds.add(managerId));

  if (managerIds.length === 0) {
    return allowedCreatorIds;
  }

  const { data: groupMembers, error: groupMembersError } = await supabaseAdmin
    .from("manager_team_members")
    .select("member_id")
    .in("manager_id", managerIds)
    .eq("is_active", true);

  if (groupMembersError) {
    throw new Error(groupMembersError.message);
  }

  for (const member of groupMembers || []) {
    const memberId = normalizeText((member as any)?.member_id);
    if (memberId) {
      allowedCreatorIds.add(memberId);
    }
  }

  return allowedCreatorIds;
}

export async function canUserAccessLoadedEvent(
  supabaseAdmin: SupabaseClient,
  event: EventAccessEvent | null | undefined,
  auth: EventAccessAuth
): Promise<boolean> {
  const userId = normalizeText(auth.userId);
  const role = normalizeText(auth.role).toLowerCase();
  const creatorId = normalizeText(event?.created_by);
  const venueName = normalizeText(event?.venue);
  const eventId = normalizeText(event?.id);

  if (!eventId || !userId || !event) {
    return false;
  }

  if (role === "admin" || role === "exec") {
    return true;
  }

  if (creatorId === userId) {
    return true;
  }

  if (role === "manager") {
    if (await isUserOnEventTeam(supabaseAdmin, eventId, userId)) {
      return true;
    }

    if (venueName) {
      const assignedVenueNames = await getAssignedVenueNames(supabaseAdmin, [userId]);
      if (assignedVenueNames.has(venueName)) {
        return true;
      }
    }
  }

  if (SUPERVISOR_ROLES.has(role)) {
    const managerIds = await getDirectManagerIds(supabaseAdmin, userId);
    const allowedCreatorIds = await getSupervisorGroupCreatorIds(supabaseAdmin, userId, managerIds);
    if (creatorId && allowedCreatorIds.has(creatorId)) {
      return true;
    }

    if (await isUserOnEventTeam(supabaseAdmin, eventId, userId)) {
      return true;
    }

    // Supervisors inherit their lead manager(s)' venue assignments too, so they
    // can see events at those venues even when someone else created them —
    // this mirrors the manager's own venue-based access above.
    // Supervisors can also be assigned to venues directly in venue management;
    // the event list (/api/events) already shows them those events, so the
    // per-event check must honor their own assignments as well.
    if (venueName) {
      const supervisorTeamVenueIds = await getSupervisorTeamVenueIds(supabaseAdmin, userId);
      const assignedVenueNames = await getAssignedVenueNames(
        supabaseAdmin,
        [userId, ...managerIds],
        supervisorTeamVenueIds
      );
      if (assignedVenueNames.has(venueName)) {
        return true;
      }
    }
  }

  return false;
}

export async function canUserAccessEventById(
  supabaseAdmin: SupabaseClient,
  eventId: string,
  auth: EventAccessAuth
): Promise<boolean> {
  const normalizedEventId = normalizeText(eventId);
  if (!normalizedEventId) {
    return false;
  }

  const { data: event, error } = await supabaseAdmin
    .from("events")
    .select("id, created_by, venue")
    .eq("id", normalizedEventId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return canUserAccessLoadedEvent(
    supabaseAdmin,
    event
      ? {
          id: normalizeText((event as any).id),
          created_by: normalizeText((event as any).created_by) || null,
          venue: normalizeText((event as any).venue) || null,
        }
      : null,
    auth
  );
}
