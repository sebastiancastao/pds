-- Migration: Add Geofencing for Login Security
-- Description: Restricts login access to specific geographic zones
-- Date: 2024-10-10

-- ============================================
-- Geofence Zones Table
-- ============================================
-- Defines allowed geographic zones for login

CREATE TABLE IF NOT EXISTS public.geofence_zones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  zone_type TEXT NOT NULL CHECK (zone_type IN ('circle', 'polygon')),
  
  -- Circle-based zone (center point + radius)
  center_latitude DECIMAL(10, 8), -- e.g., 34.0522 (Los Angeles)
  center_longitude DECIMAL(11, 8), -- e.g., -118.2437
  radius_meters INTEGER, -- Radius in meters (e.g., 500 = 500m radius)
  
  -- Polygon-based zone (array of lat/lng points)
  polygon_coordinates JSONB, -- [{lat: 34.05, lng: -118.24}, ...]
  
  -- Metadata
  is_active BOOLEAN NOT NULL DEFAULT true,
  applies_to_roles TEXT[] DEFAULT ARRAY['worker']::TEXT[], -- Which roles this zone applies to
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT valid_circle_zone CHECK (
    zone_type != 'circle' OR (
      center_latitude IS NOT NULL AND 
      center_longitude IS NOT NULL AND 
      radius_meters IS NOT NULL
    )
  ),
  CONSTRAINT valid_polygon_zone CHECK (
    zone_type != 'polygon' OR polygon_coordinates IS NOT NULL
  )
);

-- Indexes
CREATE INDEX idx_geofence_zones_active ON public.geofence_zones(is_active);
CREATE INDEX idx_geofence_zones_type ON public.geofence_zones(zone_type);

-- Comments
COMMENT ON TABLE public.geofence_zones IS 'Defines geographic zones where users can log in';
COMMENT ON COLUMN public.geofence_zones.zone_type IS 'Type of zone: circle (center+radius) or polygon (boundary points)';
COMMENT ON COLUMN public.geofence_zones.radius_meters IS 'Radius in meters for circle zones (e.g., 500 = 500m)';
COMMENT ON COLUMN public.geofence_zones.polygon_coordinates IS 'Array of {lat, lng} points defining polygon boundary';

-- ============================================
-- Location keepingTable
-- ============================================
-- Tracks all login attempts with location data

CREATE TABLE IF NOT EXISTS public.login_locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  
  -- Location data
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  accuracy_meters DECIMAL(10, 2), -- GPS accuracy in meters
  
  -- Geofence validation
  within_geofence BOOLEAN NOT NULL,
  matched_zone_id UUID REFERENCES public.geofence_zones(id),
  matched_zone_name TEXT,
  distance_to_zone_meters DECIMAL(10, 2), -- Distance to nearest zone if outside
  
  -- Login result
  login_allowed BOOLEAN NOT NULL,
  login_denied_reason TEXT,
  
  -- Context
  ip_address TEXT,
  user_agent TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT valid_coordinates CHECK (
    latitude BETWEEN -90 AND 90 AND
    longitude BETWEEN -180 AND 180
  )
);

-- Indexes
CREATE INDEX idx_login_locations_user_id ON public.login_locations(user_id);
CREATE INDEX idx_login_locations_timestamp ON public.login_locations(timestamp DESC);
CREATE INDEX idx_login_locations_within_geofence ON public.login_locations(within_geofence);
CREATE INDEX idx_login_locations_zone_id ON public.login_locations(matched_zone_id);

-- Comments
COMMENT ON TABLE public.login_locations IS 'Tracks all login attempts with location data for compliance and security';
COMMENT ON COLUMN public.login_locations.within_geofence IS 'Whether login location was within an allowed geofence zone';
COMMENT ON COLUMN public.login_locations.distance_to_zone_meters IS 'Distance to nearest zone if outside geofence';

-- ============================================
-- Default Geofence Zones
-- ============================================
-- Insert example zones (update with actual PDS locations)

-- Test Location - 5m radius for easy testing
INSERT INTO public.geofence_zones (
  name, 
  description, 
  zone_type, 
  center_latitude, 
  center_longitude, 
  radius_meters,
  is_active,
  applies_to_roles
) VALUES (
  'PDS Main Office',
  'PDS headquarters office location - TEST COORDINATES',
  'circle',
  3.550032,  -- Test coordinates
  -76.614169, -- Test coordinates
  5,      -- 5 meter radius for testing
  true,
  ARRAY['worker', 'manager', 'finance', 'exec']::TEXT[]
);

-- Additional Test Zone - Slightly larger for testing
INSERT INTO public.geofence_zones (
  name, 
  description, 
  zone_type, 
  center_latitude, 
  center_longitude, 
  radius_meters,
  is_active,
  applies_to_roles
) VALUES (
  'Test Venue',
  'Test venue location for worker clock-in',
  'circle',
  3.550032,  -- Same test coordinates
  -76.614169, -- Same test coordinates
  50,      -- 50 meter radius
  true,
  ARRAY['worker']::TEXT[]
);

-- ============================================
-- Row Level Security (RLS)
-- ============================================

-- Enable RLS
ALTER TABLE public.geofence_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_locations ENABLE ROW LEVEL SECURITY;

-- Geofence zones policies
-- Admins and execs can manage zones
CREATE POLICY geofence_zones_select_policy ON public.geofence_zones
  FOR SELECT
  USING (true); -- All authenticated users can view zones (needed for login validation)

CREATE POLICY geofence_zones_insert_policy ON public.geofence_zones
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
      AND role IN ('exec')
    )
  );

CREATE POLICY geofence_zones_update_policy ON public.geofence_zones
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
      AND role IN ('exec')
    )
  );

-- Login locations policies
-- Users can view their own login locations
CREATE POLICY login_locations_select_own ON public.login_locations
  FOR SELECT
  USING (user_id = auth.uid());

-- Admins/execs can view all login locations
CREATE POLICY login_locations_select_admin ON public.login_locations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
      AND role IN ('exec', 'finance')
    )
  );

-- System can insert login locations (via service role)
CREATE POLICY login_locations_insert_system ON public.login_locations
  FOR INSERT
  WITH CHECK (true); -- Service role will insert

-- ============================================
-- Helper Function: Check if point is in geofence
-- ============================================

CREATE OR REPLACE FUNCTION public.check_geofence(
  p_latitude DECIMAL,
  p_longitude DECIMAL,
  p_user_role TEXT
)
RETURNS TABLE (
  is_within_geofence BOOLEAN,
  matched_zone_id UUID,
  matched_zone_name TEXT,
  distance_meters DECIMAL
) AS $$
DECLARE
  v_zone RECORD;
  v_distance DECIMAL;
  v_min_distance DECIMAL := 999999;
  v_result RECORD;
BEGIN
  -- Loop through active zones that apply to this user role
  FOR v_zone IN 
    SELECT * FROM public.geofence_zones 
    WHERE is_active = true 
    AND p_user_role = ANY(applies_to_roles)
  LOOP
    IF v_zone.zone_type = 'circle' THEN
      -- Calculate distance using Haversine formula
      v_distance := public.calculate_distance(
        p_latitude, 
        p_longitude, 
        v_zone.center_latitude, 
        v_zone.center_longitude
      );
      
      -- Track minimum distance
      IF v_distance < v_min_distance THEN
        v_min_distance := v_distance;
      END IF;
      
      -- Check if within radius
      IF v_distance <= v_zone.radius_meters THEN
        RETURN QUERY SELECT true, v_zone.id, v_zone.name, v_distance;
        RETURN;
      END IF;
    END IF;
    -- TODO: Add polygon support if needed
  END LOOP;
  
  -- Not within any geofence
  RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, v_min_distance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Helper Function: Calculate distance (Haversine)
-- ============================================

CREATE OR REPLACE FUNCTION public.calculate_distance(
  lat1 DECIMAL,
  lon1 DECIMAL,
  lat2 DECIMAL,
  lon2 DECIMAL
)
RETURNS DECIMAL AS $$
DECLARE
  earth_radius CONSTANT DECIMAL := 6371000; -- Earth radius in meters
  dlat DECIMAL;
  dlon DECIMAL;
  a DECIMAL;
  c DECIMAL;
BEGIN
  -- Haversine formula
  dlat := radians(lat2 - lat1);
  dlon := radians(lon2 - lon1);
  
  a := sin(dlat / 2) * sin(dlat / 2) +
       cos(radians(lat1)) * cos(radians(lat2)) *
       sin(dlon / 2) * sin(dlon / 2);
  
  c := 2 * atan2(sqrt(a), sqrt(1 - a));
  
  RETURN earth_radius * c; -- Distance in meters
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- Verification
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '✅ Geofencing tables created successfully';
  RAISE NOTICE '   - geofence_zones (zone definitions)';
  RAISE NOTICE '   - login_locations (location keeping)';
  RAISE NOTICE '✅ Helper functions created';
  RAISE NOTICE '   - check_geofence() (validate location)';
  RAISE NOTICE '   - calculate_distance() (Haversine formula)';
  RAISE NOTICE '✅ Default zones inserted (update with actual coordinates)';
  RAISE NOTICE '⚠️  Update zone coordinates with actual PDS locations!';
END $$;

