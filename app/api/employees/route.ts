// app/api/employees/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import { safeDecrypt } from "@/lib/encryption";
import { isWithinRegion, calculateDistanceMiles, FIXED_REGION_RADIUS_MILES } from "@/lib/geocoding";

export const dynamic = 'force-dynamic';

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

    // Get filters from query params
    const { searchParams } = new URL(req.url);
    const stateFilter = searchParams.get("state");
    const regionId = searchParams.get("region_id");
    const useGeoFilter = searchParams.get("geo_filter") === "true";

    console.log("[EMPLOYEES] 🔍 Query parameters:", { stateFilter, regionId, useGeoFilter });

    // Fetch region data if regionId is provided (for geographic filtering)
    let regionData: any = null;
    if (regionId && regionId !== "all") {
      const { data: region, error: regionError } = await supabaseAdmin
        .from("regions")
        .select("id, name, center_lat, center_lng, radius_miles")
        .eq("id", regionId)
        .single();

      if (regionError) {
        console.error("[EMPLOYEES] ❌ Error fetching region:", regionError);
      } else {
        console.log("[EMPLOYEES] ✅ Region data fetched:", region);
      }

      regionData = region;
    }

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
          state,
          latitude,
          longitude,
          region_id
        )
      `)
      .eq("is_active", true);

    // Apply state filter if provided
    if (stateFilter && stateFilter !== "all") {
      query = query.eq("profiles.state", stateFilter);
    }

    // Apply region filter if provided (database-level filtering by region_id)
    // Geographic filtering will be done after fetching, if enabled
    if (regionId && regionId !== "all" && !useGeoFilter) {
      console.log("[EMPLOYEES] 🔍 Applying database filter for region_id:", regionId);
      query = query.eq("profiles.region_id", regionId);
    } else if (useGeoFilter) {
      console.log("[EMPLOYEES] 🌍 Geographic filtering will be applied after fetching");
    }

    const { data: users, error: usersError } = await query;

    if (usersError) {
      console.error("[EMPLOYEES] ❌ Error fetching users:", usersError);
      return NextResponse.json(
        { error: usersError.message || "Failed to load employees" },
        { status: 500 }
      );
    }

    console.log("[EMPLOYEES] 📦 Raw users fetched:", users?.length || 0);

    // Transform users into employee format - safely decrypt names
    let employees: Employee[] = (users || []).map((user: any) => {
      // Safely decrypt first and last names (handles both encrypted and non-encrypted data)
      const firstName = user.profiles?.first_name ? safeDecrypt(user.profiles.first_name) : "N/A";
      const lastName = user.profiles?.last_name ? safeDecrypt(user.profiles.last_name) : "N/A";

      return {
        id: user.id,
        first_name: firstName,
        last_name: lastName,
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
      };
    });

    console.log("[EMPLOYEES] 📦 Processed employees (after decryption):", employees.length);

    // Apply geographic filtering if enabled
    if (useGeoFilter && regionData && regionData.center_lat && regionData.center_lng) {
      console.log("[EMPLOYEES] 🌍 Applying geographic filter:", {
        region: regionData.name,
        center: `${regionData.center_lat}, ${regionData.center_lng}`,
        radius: FIXED_REGION_RADIUS_MILES,
      });

      const originalCount = employees.length;

      employees = employees
        .filter((employee: any) => {
          // Get coordinates from the original user data
          const user = users?.find((u: any) => u.id === employee.id);
          const profile = Array.isArray(user?.profiles) ? user.profiles[0] : user?.profiles;
          const latitude = profile?.latitude;
          const longitude = profile?.longitude;

          // Only include employees with valid coordinates that are within the region
          if (!latitude || !longitude) {
            console.log(`[EMPLOYEES] ⚠️ Employee ${employee.id} excluded: missing coordinates`);
            return false;
          }

          const withinRegion = isWithinRegion(
            latitude,
            longitude,
            regionData.center_lat,
            regionData.center_lng,
            regionData.radius_miles
          );

          const distance = calculateDistanceMiles(
            latitude,
            longitude,
            regionData.center_lat,
            regionData.center_lng
          );

          console.log(`[EMPLOYEES] 🔍 Employee ${employee.email}:`, {
            coordinates: `${latitude}, ${longitude}`,
            distance: `${Math.round(distance * 10) / 10} miles`,
            withinRegion,
            threshold: `${FIXED_REGION_RADIUS_MILES} miles`,
          });

          return withinRegion;
        })
        .map((employee: any) => {
          // Add distance information for each employee
          const user = users?.find((u: any) => u.id === employee.id);
          const profile = Array.isArray(user?.profiles) ? user.profiles[0] : user?.profiles;
          const latitude = profile?.latitude;
          const longitude = profile?.longitude;

          if (latitude && longitude) {
            const distance = calculateDistanceMiles(
              latitude,
              longitude,
              regionData.center_lat,
              regionData.center_lng
            );

            return {
              ...employee,
              distance_from_center: Math.round(distance * 10) / 10,
            };
          }

          return employee;
        })
        .sort((a: any, b: any) => {
          // Sort by distance from region center when using geo filter
          return (a.distance_from_center || 0) - (b.distance_from_center || 0);
        });

      console.log("[EMPLOYEES] ✅ Geographic filtering complete:", {
        original_count: originalCount,
        filtered_count: employees.length,
        sorted_by: "distance",
      });
    }

    // Get unique states for filter dropdown
    const uniqueStates = [...new Set((users || []).map((u: any) => u.profiles?.state).filter(Boolean))].sort();

    return NextResponse.json(
      {
        employees,
        stats: {
          total: employees.length,
          states: uniqueStates,
        },
        region: regionData
          ? {
              id: regionData.id,
              name: regionData.name,
              center_lat: regionData.center_lat,
              center_lng: regionData.center_lng,
              radius_miles: FIXED_REGION_RADIUS_MILES,
            }
          : null,
        geo_filtered: useGeoFilter && regionData != null,
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

