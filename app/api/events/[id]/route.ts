import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { deleteEventAssociations } from "@/lib/event-associations";
import { MAX_NON_EVENT_TIMESHEET_DAYS, getMaxNonEventEndDate } from "@/lib/non-event-timesheets";
import { canUserAccessEventById } from "@/lib/event-access";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    // Try cookie-based session first
    let { data: { user } } = await supabase.auth.getUser();

    // Fallback to Authorization: Bearer <access_token>
    if (!user || !user.id) {
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
        if (!tokenErr && tokenUser?.user?.id) {
          user = { id: tokenUser.user.id } as any;
        }
      }
    }

    if (!user || !user.id) {
      console.error("No authenticated user");
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const eventId = params.id;
    if (!eventId) {
      return NextResponse.json({ error: "Event ID is required" }, { status: 400 });
    }

    // Check user role - admin and exec can view any event
    const { data: userData, error: userError } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    const userRole = userData?.role as string;
    const isAdminOrExec = userRole === "admin" || userRole === "exec";

    // For supervisors/supervisor2/supervisor3, look up their lead manager(s) and group members to grant access
    let allowedCreatorIds: string[] = [user.id];
    if (userRole === "supervisor" || userRole === "supervisor2" || userRole === "supervisor3") {
      const { data: teamLinks } = await supabaseAdmin
        .from("manager_team_members")
        .select("manager_id")
        .eq("member_id", user.id)
        .eq("is_active", true);
      if (teamLinks) {
        const managerIds: string[] = [];
        for (const link of teamLinks) {
          if (!allowedCreatorIds.includes(link.manager_id)) {
            allowedCreatorIds.push(link.manager_id);
            managerIds.push(link.manager_id);
          }
        }
        // Also include co-supervisors (other active members under the same managers)
        if (managerIds.length > 0) {
          const { data: groupMembers } = await supabaseAdmin
            .from("manager_team_members")
            .select("member_id")
            .in("manager_id", managerIds)
            .eq("is_active", true);
          if (groupMembers) {
            for (const member of groupMembers) {
              if (!allowedCreatorIds.includes(member.member_id)) {
                allowedCreatorIds.push(member.member_id);
              }
            }
          }
        }
      }
    }

    // For managers: check if the event is at one of their assigned venues
    let managerAssignedVenueNames: string[] = [];
    if (userRole === "manager") {
      const { data: venueLinks } = await supabaseAdmin
        .from("venue_managers")
        .select("venue_id")
        .eq("manager_id", user.id)
        .eq("is_active", true);

      if (venueLinks && venueLinks.length > 0) {
        const venueIds = venueLinks.map((v: any) => v.venue_id);
        const { data: venueRefs } = await supabaseAdmin
          .from("venue_reference")
          .select("venue_name")
          .in("id", venueIds);

        if (venueRefs) {
          managerAssignedVenueNames = venueRefs.map((v: any) => v.venue_name).filter(Boolean);
        }
      }
    }

    // Build query - admin/exec can see any event, supervisors see own + manager's, others only their own
    let data: any = null;
    let error: any = null;

    if (isAdminOrExec) {
      ({ data, error } = await supabaseAdmin
        .from("events")
        .select("*")
        .eq("id", eventId)
        .single());
    } else if (managerAssignedVenueNames.length > 0) {
      // Manager: access if they created it OR the event is at one of their assigned venues
      // Use two queries to avoid PostgREST escaping issues with venue names
      const [byCreator, byVenue] = await Promise.all([
        supabaseAdmin.from("events").select("*").eq("id", eventId).in("created_by", allowedCreatorIds).maybeSingle(),
        supabaseAdmin.from("events").select("*").eq("id", eventId).in("venue", managerAssignedVenueNames).maybeSingle(),
      ]);
      if (byCreator.error) { error = byCreator.error; }
      else if (byVenue.error) { error = byVenue.error; }
      else { data = byCreator.data ?? byVenue.data ?? null; }
      if (!data && !error) {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }
    } else {
      ({ data, error } = await supabaseAdmin
        .from("events")
        .select("*")
        .eq("id", eventId)
        .in("created_by", allowedCreatorIds)
        .single());
    }

    if (error) {
      console.error("SUPABASE SELECT ERROR:", error);
      if (error.code === "PGRST116") {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }
      return NextResponse.json({ error: error.message || error.code || (error as any) }, { status: 500 });
    }

    // Load merchandise (if exists)
    const { data: merch, error: merchErr } = await supabaseAdmin
      .from("event_merchandise")
      .select("apparel_gross,apparel_tax_rate,apparel_cc_fee_rate,apparel_artist_percent,other_gross,other_tax_rate,other_cc_fee_rate,other_artist_percent,music_gross,music_tax_rate,music_cc_fee_rate,music_artist_percent")
      .eq("event_id", eventId)
      .single();

    if (merchErr && merchErr.code !== 'PGRST116') {
      console.error("Load merchandise error:", merchErr);
    }

    return NextResponse.json({ event: data, merchandise: merch || null }, { status: 200 });
  } catch (err: any) {
    console.error("SERVER ERROR in event get:", err);
    return NextResponse.json({ error: err.message || (err as any) }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    // Try cookie-based session first
    let { data: { user } } = await supabase.auth.getUser();

    // Fallback to Authorization: Bearer <access_token>
    if (!user || !user.id) {
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
        if (!tokenErr && tokenUser?.user?.id) {
          user = { id: tokenUser.user.id } as any;
        }
      }
    }

    if (!user || !user.id) {
      console.error("No authenticated user");
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const eventId = params.id;
    if (!eventId) {
      return NextResponse.json({ error: "Event ID is required" }, { status: 400 });
    }

    // Check user role - admin and exec can edit any event
    const { data: userData, error: userError } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    const userRole = userData?.role as string;
    const isAdminOrExec = userRole === "admin" || userRole === "exec";

    // For supervisors, look up their lead manager(s) and group members to grant edit access
    let allowedCreatorIds: string[] = [user.id];
    if (userRole === "supervisor" || userRole === "supervisor2" || userRole === "supervisor3") {
      const { data: teamLinks } = await supabaseAdmin
        .from("manager_team_members")
        .select("manager_id")
        .eq("member_id", user.id)
        .eq("is_active", true);
      if (teamLinks) {
        const managerIds: string[] = [];
        for (const link of teamLinks) {
          if (!allowedCreatorIds.includes(link.manager_id)) {
            allowedCreatorIds.push(link.manager_id);
            managerIds.push(link.manager_id);
          }
        }
        if (managerIds.length > 0) {
          const { data: groupMembers } = await supabaseAdmin
            .from("manager_team_members")
            .select("member_id")
            .in("manager_id", managerIds)
            .eq("is_active", true);
          if (groupMembers) {
            for (const member of groupMembers) {
              if (!allowedCreatorIds.includes(member.member_id)) {
                allowedCreatorIds.push(member.member_id);
              }
            }
          }
        }
      }
    }

    // For managers: check if the event is at one of their assigned venues
    let managerAssignedVenueNames: string[] = [];
    if (userRole === "manager") {
      const { data: venueLinks } = await supabaseAdmin
        .from("venue_managers")
        .select("venue_id")
        .eq("manager_id", user.id)
        .eq("is_active", true);

      if (venueLinks && venueLinks.length > 0) {
        const venueIds = venueLinks.map((v: any) => v.venue_id);
        const { data: venueRefs } = await supabaseAdmin
          .from("venue_reference")
          .select("venue_name")
          .in("id", venueIds);

        if (venueRefs) {
          managerAssignedVenueNames = venueRefs.map((v: any) => v.venue_name).filter(Boolean);
        }
      }
    }

    const getAccessibleEvent = async (
      candidateEventId: string,
      selectClause = "*"
    ) => {
      if (!candidateEventId) return null;

      if (isAdminOrExec) {
        const { data: adminEvent, error: adminEventError } = await supabaseAdmin
          .from("events")
          .select(selectClause)
          .eq("id", candidateEventId)
          .maybeSingle();
        if (adminEventError) throw adminEventError;
        return adminEvent;
      }

      if (managerAssignedVenueNames.length > 0) {
        const [byCreator, byVenue] = await Promise.all([
          supabaseAdmin
            .from("events")
            .select(selectClause)
            .eq("id", candidateEventId)
            .in("created_by", allowedCreatorIds)
            .maybeSingle(),
          supabaseAdmin
            .from("events")
            .select(selectClause)
            .eq("id", candidateEventId)
            .in("venue", managerAssignedVenueNames)
            .maybeSingle(),
        ]);

        if (byCreator.error) throw byCreator.error;
        if (byVenue.error) throw byVenue.error;
        return byCreator.data ?? byVenue.data ?? null;
      }

      const { data: creatorEvent, error: creatorEventError } = await supabaseAdmin
        .from("events")
        .select(selectClause)
        .eq("id", candidateEventId)
        .in("created_by", allowedCreatorIds)
        .maybeSingle();
      if (creatorEventError) throw creatorEventError;
      return creatorEvent;
    };

    const body = await req.json();
    const hasSalesFieldsInPayload =
      Object.prototype.hasOwnProperty.call(body, "ticket_sales") ||
      Object.prototype.hasOwnProperty.call(body, "tips") ||
      Object.prototype.hasOwnProperty.call(body, "fees") ||
      Object.prototype.hasOwnProperty.call(body, "other_income") ||
      Object.prototype.hasOwnProperty.call(body, "tax_rate_percent") ||
      Object.prototype.hasOwnProperty.call(body, "commission_pool") ||
      Object.prototype.hasOwnProperty.call(body, "net_sales");
    const hasTicketCountInPayload = Object.prototype.hasOwnProperty.call(body, "ticket_count");
    const hasTaxRateInPayload = Object.prototype.hasOwnProperty.call(body, "tax_rate_percent");
    const hasTipsInPayload = Object.prototype.hasOwnProperty.call(body, "tips");
    const hasFeesInPayload = Object.prototype.hasOwnProperty.call(body, "fees");
    const hasOtherIncomeInPayload = Object.prototype.hasOwnProperty.call(body, "other_income");
    const hasLinkedCommissionEventInPayload = Object.prototype.hasOwnProperty.call(
      body,
      "linked_commission_event_id"
    );

    // Core fields
    const event_name = body.event_name?.trim() || "";
    const artist = body.artist?.trim() || null;
    const venue = body.venue?.trim() || "";
    const city = body.city?.trim() || null;
    const state = body.state?.trim()?.toUpperCase() || null;
    const event_date = body.event_date || null;
    const start_time = body.start_time || null;
    const end_time = body.end_time || null;
    const event_type = body.event_type === "special" ? "special" : "normal";
    // end_date only applies to multi-day Non Event Time Sheets; cleared for normal events
    const end_date = event_type === "special" && body.end_date ? body.end_date : null;

    // Money / numbers
    const ticket_sales =
      body.ticket_sales === undefined || body.ticket_sales === "" ? null : Number(body.ticket_sales);

    // NEW: number of tickets
    const ticket_count =
      body.ticket_count === undefined || body.ticket_count === "" ? null : Number(body.ticket_count);

    // NEW: tax rate percent (0–100)
    const tax_rate_percent =
      body.tax_rate_percent === undefined || body.tax_rate_percent === "" ? 0 : Number(body.tax_rate_percent);

    const artist_share_percent =
      body.artist_share_percent === undefined || body.artist_share_percent === "" ? 0 : Number(body.artist_share_percent);

    const venue_share_percent =
      body.venue_share_percent === undefined || body.venue_share_percent === "" ? 0 : Number(body.venue_share_percent);

    const pds_share_percent =
      body.pds_share_percent === undefined || body.pds_share_percent === "" ? 0 : Number(body.pds_share_percent);

    const commission_pool =
      body.commission_pool === undefined || body.commission_pool === "" ? null : Number(body.commission_pool);

    const required_staff =
      body.required_staff === undefined || body.required_staff === "" ? null : Number(body.required_staff);

    const confirmed_staff =
      body.confirmed_staff === undefined || body.confirmed_staff === "" ? null : Number(body.confirmed_staff);

    const is_active = body.is_active === undefined ? true : Boolean(body.is_active);
    const ends_next_day = Boolean(body.ends_next_day);

    // Existing: tips
    const tips = body.tips === undefined || body.tips === "" ? null : Number(body.tips);

    const fees = body.fees === undefined || body.fees === "" ? null : Number(body.fees);
    const other_income = body.other_income === undefined || body.other_income === "" ? null : Number(body.other_income);
    const net_sales = body.net_sales === undefined || body.net_sales === "" ? null : Number(body.net_sales);
    const linked_commission_event_id =
      body.linked_commission_event_id === undefined ||
      body.linked_commission_event_id === null ||
      body.linked_commission_event_id === ""
        ? null
        : String(body.linked_commission_event_id).trim();

    if (linked_commission_event_id && linked_commission_event_id === eventId) {
      return NextResponse.json(
        { error: "An event cannot share commission with itself." },
        { status: 400 }
      );
    }

    // Debug
    console.log("EVENT UPDATE PAYLOAD:", {
      eventId,
      event_name,
      artist,
      venue,
      city,
      state,
      event_date,
      start_time,
      end_time,
      ticket_sales,
      ticket_count,        // NEW
      tax_rate_percent,    // NEW
      artist_share_percent,
      venue_share_percent,
      pds_share_percent,
      commission_pool,
      required_staff,
      confirmed_staff,
      is_active,
      tips,
      fees,
      other_income,
      net_sales,
      linked_commission_event_id,
    });

    // Required fields
    if (!event_name || !venue || !event_date || !start_time || !end_time) {
      console.error("Event update: missing required fields");
      return NextResponse.json(
        { error: "Missing one or more required fields: event_name, venue, event_date, start_time, end_time" },
        { status: 400 }
      );
    }

    // A multi-day Non Event Time Sheet's end date cannot precede its start date
    if (end_date && end_date < event_date) {
      console.error("Event update: end_date before event_date");
      return NextResponse.json({ error: "end_date must be on or after event_date" }, { status: 400 });
    }
    const maxEndDate = end_date ? getMaxNonEventEndDate(event_date) : null;
    if (end_date && maxEndDate && end_date > maxEndDate) {
      console.error("Event update: end_date exceeds one-week limit");
      return NextResponse.json(
        { error: `Non Event Time Sheets cannot span more than ${MAX_NON_EVENT_TIMESHEET_DAYS} days.` },
        { status: 400 }
      );
    }

    // Build payload, include tips/ticket_count/tax_rate_percent when provided
    const updatePayload: Record<string, any> = {
      event_name,
      artist,
      venue,
      city,
      state,
      event_date,
      end_date,
      start_time,
      end_time,
      ends_next_day,
      ticket_sales,
      artist_share_percent,
      venue_share_percent,
      pds_share_percent,
      commission_pool,
      required_staff,
      confirmed_staff,
      is_active,
      event_type,
      updated_at: new Date().toISOString(),
    };

    if (hasTicketCountInPayload) {
      updatePayload.ticket_count = ticket_count !== null && !Number.isNaN(ticket_count) ? ticket_count : null;
    }
    if (hasTaxRateInPayload) {
      updatePayload.tax_rate_percent = !Number.isNaN(tax_rate_percent) ? tax_rate_percent : 0;
    }
    if (hasTipsInPayload) {
      updatePayload.tips = tips !== null && !Number.isNaN(tips) ? tips : null;
    }
    if (hasFeesInPayload) {
      updatePayload.fees = fees !== null && !Number.isNaN(fees) ? fees : null;
    }
    if (hasOtherIncomeInPayload) {
      updatePayload.other_income = other_income !== null && !Number.isNaN(other_income) ? other_income : null;
    }
    if (hasLinkedCommissionEventInPayload) {
      updatePayload.linked_commission_event_id = linked_commission_event_id;
    }

    let existingEventForLinking: any = null;
    let targetLinkedEvent: any = null;
    if (hasLinkedCommissionEventInPayload) {
      existingEventForLinking = await getAccessibleEvent(
        eventId,
        "id, linked_commission_event_id"
      );
      if (!existingEventForLinking) {
        return NextResponse.json(
          { error: "Event not found or you do not have permission to update it" },
          { status: 404 }
        );
      }

      if (linked_commission_event_id) {
        targetLinkedEvent = await getAccessibleEvent(
          linked_commission_event_id,
          "id, linked_commission_event_id"
        );
        if (!targetLinkedEvent) {
          return NextResponse.json(
            { error: "Linked event not found or you do not have permission to use it." },
            { status: 404 }
          );
        }

        const targetExistingLink = (targetLinkedEvent.linked_commission_event_id || "").toString().trim();
        if (targetExistingLink && targetExistingLink !== eventId) {
          return NextResponse.json(
            { error: "The selected linked event already shares commission with another event." },
            { status: 400 }
          );
        }
      }
    }

    // Build update query - admin/exec can edit any event, supervisors own + manager's, others only their own
    // For managers with venue assignments: pre-verify access then update
    let data: any[] | null = null;
    let error: any = null;

    if (isAdminOrExec) {
      ({ data, error } = await supabaseAdmin
        .from("events")
        .update(updatePayload)
        .eq("id", eventId)
        .select());
    } else if (managerAssignedVenueNames.length > 0) {
      // Check access: manager created the event OR event is at one of their assigned venues
      const [byCreator, byVenue] = await Promise.all([
        supabaseAdmin.from("events").select("id").eq("id", eventId).in("created_by", allowedCreatorIds).maybeSingle(),
        supabaseAdmin.from("events").select("id").eq("id", eventId).in("venue", managerAssignedVenueNames).maybeSingle(),
      ]);
      const hasAccess = !!(byCreator.data || byVenue.data);
      if (!hasAccess) {
        return NextResponse.json({ error: "Event not found or you do not have permission to update it" }, { status: 404 });
      }
      ({ data, error } = await supabaseAdmin
        .from("events")
        .update(updatePayload)
        .eq("id", eventId)
        .select());
    } else {
      ({ data, error } = await supabaseAdmin
        .from("events")
        .update(updatePayload)
        .eq("id", eventId)
        .in("created_by", allowedCreatorIds)
        .select());
    }

    if (error) {
      console.error("SUPABASE UPDATE ERROR:", error);
      if (error.code === "PGRST116") {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }
      return NextResponse.json({ error: error.message || error.code || (error as any) }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: "Event not found or you do not have permission to update it" },
        { status: 404 }
      );
    }

    if (hasLinkedCommissionEventInPayload) {
      const previousLinkedEventId = (existingEventForLinking?.linked_commission_event_id || "").toString().trim();
      const nextLinkedEventId = (linked_commission_event_id || "").toString().trim();

      if (previousLinkedEventId && previousLinkedEventId !== nextLinkedEventId) {
        const { error: clearPreviousLinkedEventError } = await supabaseAdmin
          .from("events")
          .update({
            linked_commission_event_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", previousLinkedEventId)
          .eq("linked_commission_event_id", eventId);

        if (clearPreviousLinkedEventError) {
          console.error("Failed to clear previous linked commission event:", clearPreviousLinkedEventError);
          return NextResponse.json({ error: clearPreviousLinkedEventError.message }, { status: 500 });
        }
      }

      if (nextLinkedEventId) {
        const { error: syncLinkedEventError } = await supabaseAdmin
          .from("events")
          .update({
            linked_commission_event_id: eventId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", nextLinkedEventId);

        if (syncLinkedEventError) {
          console.error("Failed to sync linked commission event:", syncLinkedEventError);
          return NextResponse.json({ error: syncLinkedEventError.message }, { status: 500 });
        }
      }
    }

    // Keep event_payments.net_sales aligned with Sales tab values so payroll can consume it directly.
    if (hasSalesFieldsInPayload) {
      const updatedEvent = data[0] || {};
      const savedTicketSales = Number(updatedEvent.ticket_sales || 0);
      const savedTips = Number(updatedEvent.tips || 0);
      const savedFees = Number(updatedEvent.fees || 0);
      const savedOtherIncome = Number(updatedEvent.other_income || 0);
      const savedTotalSales = Math.max(savedTicketSales - savedTips, 0);
      const savedTaxRatePercent = Number(updatedEvent.tax_rate_percent || 0);
      const savedTax = savedTotalSales * (savedTaxRatePercent / 100);
      const computedNetSales = Math.max(savedTotalSales - savedTax - savedFees + savedOtherIncome, 0);
      const savedNetSalesRaw =
        net_sales !== null && Number.isFinite(net_sales)
          ? Math.max(net_sales, 0)
          : computedNetSales;
      const savedNetSales = Number(savedNetSalesRaw.toFixed(2));
      const savedCommissionPoolPercent = Number(updatedEvent.commission_pool || 0);
      const savedCommissionPoolDollars = Number((savedNetSales * savedCommissionPoolPercent).toFixed(2));

      const { error: upsertEventPaymentErr } = await supabaseAdmin
        .from("event_payments")
        .upsert(
          {
            event_id: eventId,
            net_sales: savedNetSales,
            total_tips: Number(savedTips.toFixed(2)),
            commission_pool_percent: savedCommissionPoolPercent,
            commission_pool_dollars: savedCommissionPoolDollars,
            created_by: user.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "event_id", ignoreDuplicates: false }
        );

      if (upsertEventPaymentErr) {
        console.error("Event payments upsert error:", upsertEventPaymentErr);
        return NextResponse.json({ error: upsertEventPaymentErr.message }, { status: 500 });
      }
    }

    // Upsert merchandise payload if provided
    if (body.merchandise && typeof body.merchandise === 'object') {
      const m = body.merchandise || {};
      const upsertPayload: any = {
        event_id: eventId,
        apparel_gross: m.apparel_gross !== undefined && m.apparel_gross !== '' ? Number(m.apparel_gross) : 0,
        apparel_tax_rate: m.apparel_tax_rate !== undefined && m.apparel_tax_rate !== '' ? Number(m.apparel_tax_rate) : 0,
        apparel_cc_fee_rate: m.apparel_cc_fee_rate !== undefined && m.apparel_cc_fee_rate !== '' ? Number(m.apparel_cc_fee_rate) : 0,
        apparel_artist_percent: m.apparel_artist_percent !== undefined && m.apparel_artist_percent !== '' ? Number(m.apparel_artist_percent) : 0,

        other_gross: m.other_gross !== undefined && m.other_gross !== '' ? Number(m.other_gross) : 0,
        other_tax_rate: m.other_tax_rate !== undefined && m.other_tax_rate !== '' ? Number(m.other_tax_rate) : 0,
        other_cc_fee_rate: m.other_cc_fee_rate !== undefined && m.other_cc_fee_rate !== '' ? Number(m.other_cc_fee_rate) : 0,
        other_artist_percent: m.other_artist_percent !== undefined && m.other_artist_percent !== '' ? Number(m.other_artist_percent) : 0,

        music_gross: m.music_gross !== undefined && m.music_gross !== '' ? Number(m.music_gross) : 0,
        music_tax_rate: m.music_tax_rate !== undefined && m.music_tax_rate !== '' ? Number(m.music_tax_rate) : 0,
        music_cc_fee_rate: m.music_cc_fee_rate !== undefined && m.music_cc_fee_rate !== '' ? Number(m.music_cc_fee_rate) : 0,
        music_artist_percent: m.music_artist_percent !== undefined && m.music_artist_percent !== '' ? Number(m.music_artist_percent) : 0,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertErr } = await supabaseAdmin
        .from('event_merchandise')
        .upsert(upsertPayload, { onConflict: 'event_id' });

      if (upsertErr) {
        console.error('Merchandise upsert error:', upsertErr);
        return NextResponse.json({ error: upsertErr.message }, { status: 500 });
      }
    }

    console.log("SUPABASE UPDATE RESULT:", data);
    return NextResponse.json({ event: data[0] }, { status: 200 });
  } catch (err: any) {
    console.error("SERVER ERROR in event update:", err);
    return NextResponse.json({ error: err.message || (err as any) }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    let { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser } = await supabaseAnon.auth.getUser(token);
        if (tokenUser?.user?.id) user = { id: tokenUser.user.id } as any;
      }
    }
    if (!user?.id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const eventId = params.id;
    if (!eventId) return NextResponse.json({ error: "Event ID required" }, { status: 400 });

    const body = await req.json();
    const { tips_distribution_mode } = body;
    if (tips_distribution_mode !== "equal" && tips_distribution_mode !== "prorated") {
      return NextResponse.json({ error: "Invalid tips_distribution_mode" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("events")
      .update({ tips_distribution_mode, updated_at: new Date().toISOString() })
      .eq("id", eventId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    // Try cookie-based session first
    let { data: { user } } = await supabase.auth.getUser();

    // Fallback to Authorization: Bearer <access_token>
    if (!user || !user.id) {
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
        if (!tokenErr && tokenUser?.user?.id) {
          user = { id: tokenUser.user.id } as any;
        }
      }
    }

    if (!user || !user.id) {
      console.error("No authenticated user");
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const eventId = params.id;
    if (!eventId) {
      return NextResponse.json({ error: "Event ID is required" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const deletionReason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!deletionReason) {
      return NextResponse.json(
        { error: "A reason for deleting this event is required." },
        { status: 400 }
      );
    }

    const { data: userData, error: userError } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (userError || !userData) {
      console.error("SUPABASE USER SELECT ERROR:", userError);
      return NextResponse.json({ error: "Failed to verify user role" }, { status: 403 });
    }

    const userRole = String(userData.role || "");
    if (userRole !== "exec" && userRole !== "manager") {
      return NextResponse.json(
        { error: "Access denied. Only exec or manager users can delete events." },
        { status: 403 }
      );
    }

    const { data: event, error: eventError } = await supabaseAdmin
      .from("events")
      .select("id, event_name, event_date, venue")
      .eq("id", eventId)
      .maybeSingle();

    if (eventError) {
      console.error("SUPABASE EVENT SELECT ERROR:", eventError);
      return NextResponse.json({ error: eventError.message || eventError.code || (eventError as any) }, { status: 500 });
    }

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    if (userRole === "manager") {
      const hasAccess = await canUserAccessEventById(supabaseAdmin, eventId, {
        userId: user.id,
        role: userRole,
      });
      if (!hasAccess) {
        return NextResponse.json(
          { error: "Access denied. You can only delete events at your assigned venues or events you are part of." },
          { status: 403 }
        );
      }
    }

    await deleteEventAssociations(supabaseAdmin, eventId);

    const { data: deletedRows, error: deleteError } = await supabaseAdmin
      .from("events")
      .delete()
      .eq("id", eventId)
      .select("id");

    if (deleteError) {
      console.error("SUPABASE EVENT DELETE ERROR:", deleteError);
      return NextResponse.json({ error: deleteError.message || deleteError.code || (deleteError as any) }, { status: 500 });
    }

    if (!deletedRows || deletedRows.length === 0) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Record the deletion reason in the audit trail (non-fatal if it fails)
    const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
      user_id: user.id,
      action: "event_deleted",
      resource_type: "event",
      resource_id: eventId,
      success: true,
      metadata: {
        reason: deletionReason,
        event_name: event.event_name || null,
        event_date: event.event_date || null,
        venue: event.venue || null,
        deleted_by_role: userRole,
      },
    });
    if (auditError) {
      console.error("Failed to log event deletion reason:", auditError);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: any) {
    console.error("SERVER ERROR in event delete:", err);
    return NextResponse.json({ error: err.message || (err as any) }, { status: 500 });
  }
}
