// app/api/employees/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type Employee = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  department: string;
  position: string;
  hire_date: string;
  status: "active" | "on_leave" | "inactive";
  salary: number;
  profile_photo_url: string | null;
  state: string;
  city: string | null;
  performance_score: number;
  projects_completed: number;
  attendance_rate: number;
  customer_satisfaction: number;
};

/**
 * GET /api/employees
 * Returns a list of all employees (mock data for now)
 * Supports optional ?state=XX filter
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });

    // Auth check
    let {
      data: { user: sessionUser },
    } = await supabase.auth.getUser();

    if (!sessionUser) {
      const authHeader =
        req.headers.get("authorization") || req.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ")
        ? authHeader.substring(7)
        : undefined;
      if (token) {
        const { data: tokenUser } = await supabase.auth.getUser(token);
        if (tokenUser?.user) sessionUser = tokenUser.user;
      }
    }

    if (!sessionUser?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get state filter from query params
    const { searchParams } = new URL(req.url);
    const stateFilter = searchParams.get("state");

    // Fetch real users from the database - query from users table and join with profiles
    let query = supabaseAdmin
      .from("users")
      .select(`
        id,
        email,
        role,
        division,
        is_active,
        created_at,
        profiles!inner (
          first_name,
          last_name,
          phone,
          city,
          state
        )
      `)
      .eq("is_active", true);

    // Apply state filter if provided
    if (stateFilter && stateFilter !== "all") {
      query = query.eq("profiles.state", stateFilter);
    }

    const { data: users, error: usersError } = await query;

    if (usersError) {
      console.error("Error fetching users:", usersError);
      return NextResponse.json(
        { error: usersError.message || "Failed to load employees" },
        { status: 500 }
      );
    }

    // Transform users into employee format
    const employees: Employee[] = (users || []).map((user: any) => ({
      id: user.id,
      first_name: user.profiles?.first_name || "N/A",
      last_name: user.profiles?.last_name || "N/A",
      email: user.email || "N/A",
      phone: user.profiles?.phone,
      department: "General", // Default department - you can add this field to profiles table later
      position: "Vendor", // Default position - you can add this field to profiles table later
      hire_date: user.created_at || new Date().toISOString(),
      status: "active", // Default status - you can add this field to profiles table later
      salary: 0, // Default - you can add this field to profiles table later
      profile_photo_url: null, // Photo handling will be added later if needed
      state: user.profiles?.state || "N/A",
      city: user.profiles?.city,
      performance_score: 0,
      projects_completed: 0,
      attendance_rate: 0,
      customer_satisfaction: 0,
    }));

    // Get unique states for filter dropdown
    const uniqueStates = [...new Set((users || []).map((u: any) => u.profiles?.state).filter(Boolean))].sort();

    return NextResponse.json(
      {
        employees,
        stats: {
          total: employees.length,
          states: uniqueStates,
        },
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("employees list error:", err);
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}
