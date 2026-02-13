import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { FIXED_REGION_RADIUS_MILES } from '@/lib/geocoding';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * GET /api/regions
 * Fetches all active regions for filtering vendors
 *
 * Query Parameters:
 *   - include_inactive: boolean (optional) - Include inactive regions
 *   - with_vendor_count: boolean (optional) - Include vendor count per region
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get query parameters
    const { searchParams } = new URL(req.url);
    const includeInactive = searchParams.get('include_inactive') === 'true';
    const withVendorCount = searchParams.get('with_vendor_count') === 'true';

    // Build the query - fetch all regions sorted by name
    const { data: regions, error } = await supabase
      .from('regions')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching regions:', error);
      return NextResponse.json(
        { error: 'Failed to fetch regions', details: error.message },
        { status: 500 }
      );
    }

    // If vendor count is requested, fetch it for each region
    if (withVendorCount && regions) {
      const regionsWithCount = await Promise.all(
        regions.map(async (region) => {
          const { count } = await supabase
            .from('profiles')
            .select('*', { count: 'exact', head: true })
            .eq('region_id', region.id);

          return {
            ...region,
            vendor_count: count || 0,
          };
        })
      );

      return NextResponse.json({
        regions: regionsWithCount,
        count: regionsWithCount.length,
      });
    }

    return NextResponse.json({
      regions: regions || [],
      count: regions?.length || 0,
    });
  } catch (err: any) {
    console.error('Unexpected error in /api/regions:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/regions
 * Creates a new region (Admin only)
 *
 * Request Body:
 * {
 *   name: string (required),
 *   description?: string,
 *   center_lat?: number,
 *   center_lng?: number,
 *   radius_miles?: number,
 *   boundary?: string (WKT format)
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the authorization header
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Authorization header required' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');

    // Verify the user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    // Check if user is admin
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userError || userData?.role !== 'admin') {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await req.json();
    const {
      name,
      description,
      center_lat,
      center_lng,
      boundary,
    } = body;

    // Validate required fields
    if (!name) {
      return NextResponse.json(
        { error: 'Region name is required' },
        { status: 400 }
      );
    }

    // Validate that either polygon boundary or center coordinates are provided.
    // Radius is fixed globally at 200 miles.
    if (!boundary && (center_lat == null || center_lng == null)) {
      return NextResponse.json(
        {
          error:
            'Either boundary or (center_lat, center_lng) must be provided',
        },
        { status: 400 }
      );
    }

    // Prepare region data
    const regionData: any = {
      name,
      description: description || null,
      is_active: true,
      created_by: user.id,
    };

    // Add radius-based data if provided (fixed 200-mile radius).
    if (center_lat != null && center_lng != null) {
      regionData.center_lat = center_lat;
      regionData.center_lng = center_lng;
      regionData.radius_miles = FIXED_REGION_RADIUS_MILES;
    }

    // Add boundary if provided (WKT format)
    if (boundary) {
      // The boundary should be in WKT format, e.g., "POLYGON((-118.5 34.0, ...))"
      // We'll let PostGIS handle the conversion
      const { data: regionWithBoundary, error: boundaryError } = await supabase
        .rpc('create_region_with_boundary', {
          p_name: name,
          p_description: description || null,
          p_boundary_wkt: boundary,
          p_created_by: user.id,
        });

      if (boundaryError) {
        console.error('Error creating region with boundary:', boundaryError);
        return NextResponse.json(
          { error: 'Failed to create region with boundary', details: boundaryError.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        message: 'Region created successfully',
        region: regionWithBoundary,
      });
    }

    // Insert the region
    const { data: newRegion, error: insertError } = await supabase
      .from('regions')
      .insert(regionData)
      .select()
      .single();

    if (insertError) {
      console.error('Error creating region:', insertError);
      return NextResponse.json(
        { error: 'Failed to create region', details: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: 'Region created successfully',
      region: newRegion,
    });
  } catch (err: any) {
    console.error('Unexpected error in POST /api/regions:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/regions/[id]
 * Updates an existing region (Admin only)
 * Note: This would typically be in a separate file with dynamic route
 */

/**
 * DELETE /api/regions/[id]
 * Deletes a region (Admin only)
 * Note: This would typically be in a separate file with dynamic route
 */
