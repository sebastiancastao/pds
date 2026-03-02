// app/api/employees/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import { safeDecrypt } from "@/lib/encryption";
import {
  isWithinRegion,
  calculateDistanceMiles,
  getUserRegion,
  geocodeAddress,
  delay,
  type Region,
} from "@/lib/geocoding";

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MAX_GEOCODES_PER_REQUEST = 8;

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
  region_id: string | null;
  region_name: string | null;
  worked_venues: string[];
  performance_score: number;
  projects_completed: number;
  attendance_rate: number;
  customer_satisfaction: number;
};

const toFiniteNumber = (value: unknown): number | null => {
  if (value == null) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const chunkArray = <T>(items: T[], chunkSize: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
};

const toPlainText = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return safeDecrypt(value).trim();
};

const normalizeStreetAddress = (address: string): string => {
  if (!address) return "";
  return address.replace(/^(\d+)([A-Z])/i, "$1 $2").trim();
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
          address,
          city,
          state,
          zip_code,
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

    const { data: activeRegions, error: activeRegionsError } = await supabaseAdmin
      .from("regions")
      .select("id, name, center_lat, center_lng, radius_miles")
      .eq("is_active", true);
    if (activeRegionsError) {
      console.error("[EMPLOYEES] Failed to load regions for geo assignment:", activeRegionsError);
    }

    const regionsForMatching: Region[] = (activeRegions || [])
      .map((region: any) => {
        const centerLat = toFiniteNumber(region.center_lat);
        const centerLng = toFiniteNumber(region.center_lng);
        const radiusMiles = toFiniteNumber(region.radius_miles);
        if (!region?.id || centerLat == null || centerLng == null || radiusMiles == null) return null;
        return {
          id: region.id,
          name: region.name || region.id,
          center_lat: centerLat,
          center_lng: centerLng,
          radius_miles: radiusMiles,
        } as Region;
      })
      .filter((region: Region | null): region is Region => region != null);
    const regionNameById = new Map<string, string>(
      regionsForMatching.map((region) => [region.id, region.name])
    );

    // Geocode missing coordinates so region assignment works for exports even when lat/lng
    // were never persisted for a user profile.
    const usersNeedingGeocode = (users || []).filter((user: any) => {
      const profile = Array.isArray(user?.profiles) ? user.profiles[0] : user?.profiles;
      const latitude = toFiniteNumber(profile?.latitude);
      const longitude = toFiniteNumber(profile?.longitude);
      if (latitude != null && longitude != null) return false;

      const address = normalizeStreetAddress(toPlainText(profile?.address));
      const city = toPlainText(profile?.city);
      const state = toPlainText(profile?.state);
      const zipCode = toPlainText(profile?.zip_code);
      return !!(address || city || state || zipCode);
    });

    if (usersNeedingGeocode.length > 0) {
      console.log("[EMPLOYEES] Profiles missing coordinates before region assignment:", {
        count: usersNeedingGeocode.length,
      });

      const targets = usersNeedingGeocode.slice(0, MAX_GEOCODES_PER_REQUEST);
      for (let i = 0; i < targets.length; i++) {
        const user = targets[i];
        const profile = Array.isArray(user?.profiles) ? user.profiles[0] : user?.profiles;
        if (!profile) continue;

        const address = normalizeStreetAddress(toPlainText(profile?.address));
        const city = toPlainText(profile?.city);
        const state = toPlainText(profile?.state);
        const zipCode = toPlainText(profile?.zip_code);

        try {
          let geocodeResult = await geocodeAddress(address, city, state, zipCode || undefined);

          // Fallbacks for partially populated profile data
          if (!geocodeResult && (city || state || zipCode)) {
            geocodeResult = await geocodeAddress("", city, state, zipCode || undefined);
          }
          if (!geocodeResult && address) {
            geocodeResult = await geocodeAddress(address, "", state, zipCode || undefined);
          }

          if (!geocodeResult) {
            console.log("[EMPLOYEES] Geocoding returned no result for user:", {
              userId: user.id,
              email: user.email,
              city,
              state,
            });
            continue;
          }

          const { error: updateError } = await supabaseAdmin
            .from("profiles")
            .update({
              latitude: geocodeResult.latitude,
              longitude: geocodeResult.longitude,
            })
            .eq("user_id", user.id);

          if (updateError) {
            console.error("[EMPLOYEES] Failed to persist geocoded coordinates:", {
              userId: user.id,
              error: updateError.message,
            });
            continue;
          }

          profile.latitude = geocodeResult.latitude;
          profile.longitude = geocodeResult.longitude;

          console.log("[EMPLOYEES] Geocoded and saved coordinates for user:", {
            userId: user.id,
            latitude: geocodeResult.latitude,
            longitude: geocodeResult.longitude,
          });
        } catch (geocodeErr: any) {
          console.error("[EMPLOYEES] Geocoding failed for user:", {
            userId: user.id,
            error: geocodeErr?.message || geocodeErr,
          });
        }

        if (i < targets.length - 1) {
          await delay(1100);
        }
      }

      if (usersNeedingGeocode.length > MAX_GEOCODES_PER_REQUEST) {
        console.log("[EMPLOYEES] Geocode pass capped for this request:", {
          total_missing: usersNeedingGeocode.length,
          processed_now: MAX_GEOCODES_PER_REQUEST,
        });
      }
    }

    const regionBackfills = new Map<string, string>();
    // Transform users into employee format and derive region_id from geocoded coordinates.
    let employees: Employee[] = (users || []).map((user: any) => {
      const profile = Array.isArray(user?.profiles) ? user.profiles[0] : user?.profiles;
      const firstName = profile?.first_name ? safeDecrypt(profile.first_name) : "N/A";
      const lastName = profile?.last_name ? safeDecrypt(profile.last_name) : "N/A";
      const city = toPlainText(profile?.city) || null;
      const state = toPlainText(profile?.state) || "N/A";
      const latitude = toFiniteNumber(profile?.latitude);
      const longitude = toFiniteNumber(profile?.longitude);

      const cachedRegionId: string | null = profile?.region_id || null;
      const matchedRegion =
        latitude != null && longitude != null && regionsForMatching.length > 0
          ? getUserRegion(latitude, longitude, regionsForMatching)
          : null;

      // Prefer live geocoded match when available, otherwise keep cached assignment.
      const resolvedRegionId: string | null = matchedRegion?.id || cachedRegionId;

      if (matchedRegion?.id && matchedRegion.id !== cachedRegionId) {
        regionBackfills.set(user.id, matchedRegion.id);
      }

      return {
        id: user.id,
        first_name: firstName,
        last_name: lastName,
        email: user.email || "N/A",
        phone: profile?.phone,
        department: "General", // Default department - you can add this field to profiles table later
        position: "Vendor", // Default position - you can add this field to profiles table later
        hire_date: user.created_at || new Date().toISOString(),
        status: "active", // Default status - you can add this field to profiles table later
        salary: 0, // Default - you can add this field to profiles table later
        profile_photo_url: null, // Photo handling will be added later if needed
        state,
        city,
        region_id: resolvedRegionId,
        region_name: resolvedRegionId ? regionNameById.get(resolvedRegionId) || null : null,
        worked_venues: [],
        performance_score: 0,
        projects_completed: 0,
        attendance_rate: 0,
        customer_satisfaction: 0,
      };
    });

    if (regionBackfills.size > 0) {
      await Promise.all(
        Array.from(regionBackfills.entries()).map(async ([userId, matchedRegionId]) => {
          const { error: updateError } = await supabaseAdmin
            .from("profiles")
            .update({ region_id: matchedRegionId })
            .eq("user_id", userId);
          if (updateError) {
            console.error("[EMPLOYEES] Failed to backfill region_id:", {
              userId,
              matchedRegionId,
              error: updateError.message,
            });
          }
        })
      );
    }

    console.log("[EMPLOYEES] 📦 Processed employees (after decryption):", employees.length);

    const usersById = new Map<string, any>((users || []).map((u: any) => [u.id, u]));

    // Apply geographic filtering if enabled
    if (useGeoFilter && regionData && regionData.center_lat != null && regionData.center_lng != null) {
      const regionCenterLat = toFiniteNumber(regionData.center_lat);
      const regionCenterLng = toFiniteNumber(regionData.center_lng);
      const regionRadius = toFiniteNumber(regionData.radius_miles);

      if (regionCenterLat == null || regionCenterLng == null || regionRadius == null) {
        console.warn("[EMPLOYEES] Geo filter requested but selected region has invalid geometry.");
      } else {
        console.log("[EMPLOYEES] Applying geographic filter:", {
          region: regionData.name,
          center: `${regionCenterLat}, ${regionCenterLng}`,
          radius: regionRadius,
        });

        const originalCount = employees.length;

        employees = employees
          .filter((employee: any) => {
            // Get coordinates from the original user data
            const user = usersById.get(employee.id);
            const profile = Array.isArray(user?.profiles) ? user.profiles[0] : user?.profiles;
            const latitude = toFiniteNumber(profile?.latitude);
            const longitude = toFiniteNumber(profile?.longitude);

            // Only include employees with valid coordinates that are within the region
            if (latitude == null || longitude == null) {
              console.log(`[EMPLOYEES] Employee ${employee.id} excluded: missing coordinates`);
              return false;
            }

            const withinRegion = isWithinRegion(
              latitude,
              longitude,
              regionCenterLat,
              regionCenterLng,
              regionRadius
            );

            const distance = calculateDistanceMiles(
              latitude,
              longitude,
              regionCenterLat,
              regionCenterLng
            );

            console.log(`[EMPLOYEES] Employee ${employee.email}:`, {
              coordinates: `${latitude}, ${longitude}`,
              distance: `${Math.round(distance * 10) / 10} miles`,
              withinRegion,
              threshold: `${regionRadius} miles`,
            });

            return withinRegion;
          })
          .map((employee: any) => {
            // Add distance information for each employee
            const user = usersById.get(employee.id);
            const profile = Array.isArray(user?.profiles) ? user.profiles[0] : user?.profiles;
            const latitude = toFiniteNumber(profile?.latitude);
            const longitude = toFiniteNumber(profile?.longitude);

            if (latitude != null && longitude != null) {
              const distance = calculateDistanceMiles(
                latitude,
                longitude,
                regionCenterLat,
                regionCenterLng
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

        console.log("[EMPLOYEES] Geographic filtering complete:", {
          original_count: originalCount,
          filtered_count: employees.length,
          sorted_by: "distance",
        });
      }
    }

    // Resolve venues each employee has worked at.
    const employeeIds = employees.map((employee) => employee.id).filter(Boolean);
    if (employeeIds.length > 0) {
      const venuesByUserId = new Map<string, Set<string>>();
      const eventIdsByUserId = new Map<string, Set<string>>();
      const unresolvedShiftDatesByUserId = new Map<string, Set<string>>();
      const workedTeamStatuses = new Set(["assigned", "pending_confirmation", "confirmed", "completed"]);

      const addUserEvent = (userId: string, eventId: string) => {
        if (!userId || !eventId) return;
        if (!eventIdsByUserId.has(userId)) eventIdsByUserId.set(userId, new Set<string>());
        eventIdsByUserId.get(userId)!.add(eventId);
      };

      const addUnresolvedShiftDate = (userId: string, dateKey: string) => {
        if (!userId || !dateKey) return;
        if (!unresolvedShiftDatesByUserId.has(userId)) unresolvedShiftDatesByUserId.set(userId, new Set<string>());
        unresolvedShiftDatesByUserId.get(userId)!.add(dateKey);
      };

      const toTimeMs = (value: unknown): number | null => {
        if (!value) return null;
        const ms = new Date(String(value)).getTime();
        return Number.isFinite(ms) ? ms : null;
      };

      // Source of truth: time_entries + event_id inference from shift pairing.
      const timeRows: any[] = [];
      const employeeIdBatches = chunkArray(employeeIds, 200);
      for (const batch of employeeIdBatches) {
        const { data, error } = await supabaseAdmin
          .from("time_entries")
          .select("user_id, event_id, action, timestamp")
          .in("user_id", batch)
          .in("action", ["clock_in", "clock_out", "meal_start", "meal_end"]);
        if (error) {
          console.error("[EMPLOYEES] Failed to load time_entries batch for worked venues:", {
            batchSize: batch.length,
            error,
          });
          continue;
        }
        if (Array.isArray(data)) timeRows.push(...data);
      }

      if (timeRows.length > 0) {
        const entriesByUserId = new Map<string, any[]>();

        (timeRows || []).forEach((row: any) => {
          const userId = row?.user_id ? String(row.user_id) : "";
          if (!userId) return;
          if (!entriesByUserId.has(userId)) entriesByUserId.set(userId, []);
          entriesByUserId.get(userId)!.push(row);

          // Direct link when event_id is already present.
          if (row?.event_id) addUserEvent(userId, String(row.event_id));
        });

        entriesByUserId.forEach((rows, userId) => {
          const sortedRows = [...rows].sort((a, b) => {
            const ta = toTimeMs(a?.timestamp) ?? 0;
            const tb = toTimeMs(b?.timestamp) ?? 0;
            return ta - tb;
          });

          let openClockIn: any = null;
          for (const row of sortedRows) {
            const action = String(row?.action || "").toLowerCase();

            if (action === "clock_in") {
              if (!openClockIn) openClockIn = row;
              continue;
            }

            if (action === "clock_out" && openClockIn) {
              const shiftStart = toTimeMs(openClockIn?.timestamp);
              const shiftEnd = toTimeMs(row?.timestamp);
              if (shiftStart == null || shiftEnd == null || shiftEnd <= shiftStart) {
                openClockIn = null;
                continue;
              }

              let eventId: string | null =
                (openClockIn?.event_id ? String(openClockIn.event_id) : null) ||
                (row?.event_id ? String(row.event_id) : null);

              // If clock entries have no event_id, infer from meal events inside the shift.
              if (!eventId) {
                const mealWithEvent = sortedRows.find((candidate) => {
                  const candidateAction = String(candidate?.action || "").toLowerCase();
                  if (candidateAction !== "meal_start" && candidateAction !== "meal_end") return false;
                  if (!candidate?.event_id) return false;
                  const t = toTimeMs(candidate?.timestamp);
                  return t != null && t > shiftStart && t < shiftEnd;
                });
                if (mealWithEvent?.event_id) {
                  eventId = String(mealWithEvent.event_id);
                }
              }

              if (eventId) {
                addUserEvent(userId, eventId);
              } else {
                // Final fallback: map this shift to a team event on the same date.
                const shiftDate = String(openClockIn?.timestamp || "").slice(0, 10);
                if (shiftDate) addUnresolvedShiftDate(userId, shiftDate);
              }

              openClockIn = null;
            }
          }
        });
      }

      // Team events are used to resolve untagged time entries and as a last fallback.
      const teamRows: any[] = [];
      for (const batch of employeeIdBatches) {
        const { data, error } = await supabaseAdmin
          .from("event_teams")
          .select("vendor_id, event_id, status")
          .in("vendor_id", batch);
        if (error) {
          console.error("[EMPLOYEES] Failed to load event_teams batch for worked venues fallback:", {
            batchSize: batch.length,
            error,
          });
          continue;
        }
        if (Array.isArray(data)) teamRows.push(...data);
      }

      const candidateEventIds = new Set<string>();
      eventIdsByUserId.forEach((eventIds) => eventIds.forEach((eventId) => candidateEventIds.add(eventId)));

      const validTeamRows = (teamRows || []).filter((row: any) => {
        const status = String(row?.status || "").toLowerCase();
        return !!row?.event_id && !!row?.vendor_id && workedTeamStatuses.has(status);
      });
      validTeamRows.forEach((row: any) => candidateEventIds.add(String(row.event_id)));

      const eventsById = new Map<string, { venue: string; event_date: string | null }>();
      if (candidateEventIds.size > 0) {
        const eventIdBatches = chunkArray(Array.from(candidateEventIds), 200);
        for (const eventBatch of eventIdBatches) {
          const { data: eventsData, error: eventsDataError } = await supabaseAdmin
            .from("events")
            .select("id, venue, event_date")
            .in("id", eventBatch);
          if (eventsDataError) {
            console.error("[EMPLOYEES] Failed to load events batch for worked venues:", {
              batchSize: eventBatch.length,
              error: eventsDataError,
            });
            continue;
          }
          (eventsData || []).forEach((event: any) => {
            if (!event?.id || !event?.venue) return;
            eventsById.set(String(event.id), {
              venue: String(event.venue),
              event_date: event.event_date ? String(event.event_date) : null,
            });
          });
        }
      }

      const todayIso = new Date().toISOString().slice(0, 10);
      const teamEventsByUserAndDate = new Map<string, Map<string, string[]>>();
      validTeamRows.forEach((row: any) => {
        const userId = String(row.vendor_id);
        const eventId = String(row.event_id);
        const event = eventsById.get(eventId);
        if (!event?.event_date || event.event_date > todayIso) return;

        if (!teamEventsByUserAndDate.has(userId)) teamEventsByUserAndDate.set(userId, new Map<string, string[]>());
        const dateMap = teamEventsByUserAndDate.get(userId)!;
        if (!dateMap.has(event.event_date)) dateMap.set(event.event_date, []);
        dateMap.get(event.event_date)!.push(eventId);
      });

      // Resolve untagged shifts to team events on the same shift date.
      unresolvedShiftDatesByUserId.forEach((shiftDates, userId) => {
        const dateMap = teamEventsByUserAndDate.get(userId);
        if (!dateMap) return;
        shiftDates.forEach((shiftDate) => {
          const sameDayEvents = dateMap.get(shiftDate) || [];
          sameDayEvents.forEach((eventId) => addUserEvent(userId, eventId));
        });
      });

      // If user has no time-linked events, use past team events as fallback.
      employeeIds.forEach((userId) => {
        if ((eventIdsByUserId.get(userId)?.size || 0) > 0) return;
        const dateMap = teamEventsByUserAndDate.get(userId);
        if (!dateMap) return;
        dateMap.forEach((eventIds) => eventIds.forEach((eventId) => addUserEvent(userId, eventId)));
      });

      eventIdsByUserId.forEach((eventIds, userId) => {
        eventIds.forEach((eventId) => {
          const venue = eventsById.get(eventId)?.venue || "";
          if (!venue) return;
          if (!venuesByUserId.has(userId)) venuesByUserId.set(userId, new Set<string>());
          venuesByUserId.get(userId)!.add(venue);
        });
      });

      console.log("[EMPLOYEES] Worked venues resolution summary:", {
        employees_considered: employeeIds.length,
        time_entries_scanned: timeRows.length,
        team_rows_scanned: teamRows.length,
        candidate_events: candidateEventIds.size,
        users_with_event_links: eventIdsByUserId.size,
        users_with_venues: venuesByUserId.size,
      });

      employees = employees.map((employee) => {
        const venues = Array.from(venuesByUserId.get(employee.id) || []).sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: "base" })
        );
        return {
          ...employee,
          worked_venues: venues,
        };
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
              radius_miles: regionData.radius_miles,
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

