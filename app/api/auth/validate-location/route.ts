// PDS Time keeping System - Geofence Location Validation API
// Validates user location against configured geofence zones

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditEvent } from '@/lib/audit';
import { validateGeofence, isValidCoordinates, type Coordinates, type GeofenceZone } from '@/lib/geofence';

function getClientIP(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0] || 
         headers.get('x-real-ip') || 
         'unknown';
}

function getUserAgent(headers: Headers): string {
  return headers.get('user-agent') || 'unknown';
}

export async function POST(request: NextRequest) {
  try {
    const clientIP = getClientIP(request.headers);
    const userAgent = getUserAgent(request.headers);

    // Parse request body
    const body = await request.json();
    const { latitude, longitude, accuracy, email } = body;

    // Validate inputs
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return NextResponse.json(
        { error: 'Valid latitude and longitude are required' },
        { status: 400 }
      );
    }

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    const coords: Coordinates = {
      latitude,
      longitude,
      accuracy: accuracy || undefined,
    };

    // Validate coordinate values
    if (!isValidCoordinates(coords)) {
      return NextResponse.json(
        { error: 'Invalid coordinates provided' },
        { status: 400 }
      );
    }

    console.log('[DEBUG] Validating location for email:', email);
    console.log('[DEBUG] Coordinates:', `${latitude}, ${longitude}`);
    console.log('[DEBUG] Accuracy:', accuracy ? `${Math.round(accuracy)}m` : 'unknown');

    // Create Supabase client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Get user by email
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, role')
      .eq('email', email)
      .single();

    if (userError || !userData) {
      console.error('[DEBUG] User not found:', email);
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const userId = userData.id;
    const userRole = userData.role;

    console.log('[DEBUG] User found:', userId, 'Role:', userRole);

    // Fetch active geofence zones
    const { data: zonesData, error: zonesError } = await supabaseAdmin
      .from('geofence_zones')
      .select('*')
      .eq('is_active', true);

    if (zonesError) {
      console.error('[DEBUG] Failed to fetch geofence zones:', zonesError);
      return NextResponse.json(
        { error: 'Failed to validate location. Please try again.' },
        { status: 500 }
      );
    }

    console.log('[DEBUG] Active geofence zones:', zonesData?.length || 0);

    // Transform zones to GeofenceZone type
    const zones: GeofenceZone[] = (zonesData || []).map((zone: any) => ({
      id: zone.id,
      name: zone.name,
      description: zone.description,
      zoneType: zone.zone_type,
      centerLatitude: zone.center_latitude,
      centerLongitude: zone.center_longitude,
      radiusMeters: zone.radius_meters,
      polygonCoordinates: zone.polygon_coordinates,
      isActive: zone.is_active,
      appliesToRoles: zone.applies_to_roles || [],
    }));

    // Validate geofence
    const validation = validateGeofence(coords, zones, userRole);

    console.log('[DEBUG] Geofence validation result:', {
      isWithinGeofence: validation.isWithinGeofence,
      matchedZone: validation.matchedZoneName,
      distance: validation.distanceMeters,
    });

    // Track login location
    const { error: trackError } = await supabaseAdmin
      .from('login_locations')
      .insert({
        user_id: userId,
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy_meters: coords.accuracy,
        within_geofence: validation.isWithinGeofence,
        matched_zone_id: validation.matchedZoneId,
        matched_zone_name: validation.matchedZoneName,
        distance_to_zone_meters: validation.distanceMeters,
        login_allowed: validation.isWithinGeofence,
        login_denied_reason: validation.isWithinGeofence ? null : validation.errorMessage,
        ip_address: clientIP,
        user_agent: userAgent,
      });

    if (trackError) {
      console.error('[DEBUG] Failed to track login location:', trackError);
      // Don't fail the request, just log the error
    }

    // Log audit event
    await logAuditEvent({
      userId,
      action: validation.isWithinGeofence ? 'geofence_validation_success' : 'geofence_validation_failed',
      resourceType: 'auth',
      ipAddress: clientIP,
      userAgent,
      success: validation.isWithinGeofence,
      metadata: {
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: coords.accuracy,
        matchedZone: validation.matchedZoneName,
        distanceMeters: validation.distanceMeters,
        reason: validation.errorMessage,
      },
    });

    if (!validation.isWithinGeofence) {
      console.log('[DEBUG] ❌ Location outside geofence');
      return NextResponse.json(
        {
          allowed: false,
          error: validation.errorMessage || 'You are not within an authorized location',
          distanceMeters: validation.distanceMeters,
        },
        { status: 403 }
      );
    }

    console.log('[DEBUG] ✅ Location within geofence:', validation.matchedZoneName);

    return NextResponse.json({
      allowed: true,
      message: 'Location verified',
      matchedZone: validation.matchedZoneName,
      distanceMeters: validation.distanceMeters,
    });

  } catch (error: any) {
    console.error('Geofence validation error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}

