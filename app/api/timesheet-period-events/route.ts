import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

// Lists every event and non-event whose start date falls inside a date range,
// for the /event-dashboard pay-period timesheet ZIP page. Exec only, the same
// as the per-event timesheet PDF export (/api/events/[id]/timesheet-pdf) the
// page downloads from.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const PAGE_SIZE = 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function getRequestUser(request: NextRequest) {
  const authClient = createRouteHandlerClient({ cookies });
  const {
    data: { user: cookieUser },
  } = await authClient.auth.getUser();
  if (cookieUser) return cookieUser;

  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (!token) return null;

  const tokenClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const {
    data: { user: tokenUser },
  } = await tokenClient.auth.getUser();
  return tokenUser ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: userRecord, error: roleError } = await adminClient
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();
    if (roleError || !userRecord) {
      return NextResponse.json({ error: "Failed to verify access" }, { status: 500 });
    }
    if (String(userRecord.role || "").trim().toLowerCase() !== "exec") {
      return NextResponse.json({ error: "Only exec users can export timesheet PDFs" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("startDate") || "";
    const endDate = searchParams.get("endDate") || "";
    if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
      return NextResponse.json(
        { error: "startDate and endDate are required as YYYY-MM-DD" },
        { status: 400 }
      );
    }
    if (startDate > endDate) {
      return NextResponse.json({ error: "startDate must be on or before endDate" }, { status: 400 });
    }

    const events: any[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await adminClient
        .from("events")
        .select("id, event_name, venue, city, state, event_date, end_date, event_type, is_active")
        .gte("event_date", startDate)
        .lte("event_date", endDate)
        .order("event_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const page = data ?? [];
      events.push(...page);
      if (page.length < PAGE_SIZE) break;
    }

    return NextResponse.json(
      {
        events: events.map((event) => ({
          id: event.id,
          event_name: event.event_name ?? null,
          venue: event.venue ?? null,
          city: event.city ?? null,
          state: event.state ? String(event.state).trim() : null,
          event_date: String(event.event_date || "").slice(0, 10),
          end_date: event.end_date ? String(event.end_date).slice(0, 10) : null,
          is_non_event: String(event.event_type || "").trim().toLowerCase() === "special",
          is_active: event.is_active !== false,
        })),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    console.error("[TIMESHEET PERIOD EVENTS] Error:", err);
    return NextResponse.json({ error: err?.message || "Failed to load events" }, { status: 500 });
  }
}
