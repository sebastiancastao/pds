-- ============================================================================
-- Migration: Create Regions Table with Geocoding Support
-- Description: Creates a regions table with PostGIS geometry support for
--              filtering vendors by geographic regions
-- ============================================================================

-- Enable PostGIS extension if not already enabled
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================================
-- Create Regions Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS regions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,

    -- Geographic boundary stored as a polygon (can represent any shape)
    -- Using geography type for accurate distance calculations
    boundary GEOGRAPHY(POLYGON, 4326),

    -- Alternative: Center point and radius (simpler approach)
    center_lat DECIMAL(10, 8),
    center_lng DECIMAL(11, 8),
    radius_miles DECIMAL(10, 2),

    -- Metadata
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- ============================================================================
-- Create Indexes for Performance
-- ============================================================================

-- Spatial index on boundary for fast geographic queries
CREATE INDEX IF NOT EXISTS idx_regions_boundary
    ON regions USING GIST(boundary);

-- Index on center point for radius-based queries
CREATE INDEX IF NOT EXISTS idx_regions_center
    ON regions(center_lat, center_lng);

-- Index for active regions
CREATE INDEX IF NOT EXISTS idx_regions_active
    ON regions(is_active) WHERE is_active = true;

-- ============================================================================
-- Add region_id to profiles table (optional - for caching)
-- ============================================================================
-- This allows caching the vendor's region instead of calculating it each time
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS region_id UUID REFERENCES regions(id);

CREATE INDEX IF NOT EXISTS idx_profiles_region_id
    ON profiles(region_id);

-- ============================================================================
-- Function: Check if a point is within a region (using boundary polygon)
-- ============================================================================
CREATE OR REPLACE FUNCTION is_point_in_region(
    p_lat DECIMAL(10, 8),
    p_lng DECIMAL(11, 8),
    p_region_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
    v_boundary GEOGRAPHY;
    v_point GEOGRAPHY;
BEGIN
    -- Get the region boundary
    SELECT boundary INTO v_boundary
    FROM regions
    WHERE id = p_region_id AND is_active = true;

    IF v_boundary IS NULL THEN
        RETURN false;
    END IF;

    -- Create point from lat/lng
    v_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;

    -- Check if point is within boundary
    RETURN ST_Contains(v_boundary::geometry, v_point::geometry);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Function: Check if a point is within a region (using radius)
-- ============================================================================
CREATE OR REPLACE FUNCTION is_point_in_region_radius(
    p_lat DECIMAL(10, 8),
    p_lng DECIMAL(11, 8),
    p_region_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
    v_center_lat DECIMAL(10, 8);
    v_center_lng DECIMAL(11, 8);
    v_radius_miles DECIMAL(10, 2);
    v_distance_miles DECIMAL(10, 2);
BEGIN
    -- Get the region center and radius
    SELECT center_lat, center_lng, radius_miles
    INTO v_center_lat, v_center_lng, v_radius_miles
    FROM regions
    WHERE id = p_region_id AND is_active = true;

    IF v_center_lat IS NULL OR v_center_lng IS NULL OR v_radius_miles IS NULL THEN
        RETURN false;
    END IF;

    -- Calculate distance in miles
    v_distance_miles := ST_Distance(
        ST_SetSRID(ST_MakePoint(v_center_lng, v_center_lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
    ) * 0.000621371; -- Convert meters to miles

    RETURN v_distance_miles <= v_radius_miles;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Function: Find which region a vendor belongs to
-- ============================================================================
CREATE OR REPLACE FUNCTION find_vendor_region(
    p_user_id UUID
)
RETURNS UUID AS $$
DECLARE
    v_lat DECIMAL(10, 8);
    v_lng DECIMAL(11, 8);
    v_region_id UUID;
BEGIN
    -- Get vendor's coordinates
    SELECT latitude, longitude
    INTO v_lat, v_lng
    FROM profiles
    WHERE id = p_user_id;

    IF v_lat IS NULL OR v_lng IS NULL THEN
        RETURN NULL;
    END IF;

    -- Try to find region using boundary (preferred method)
    SELECT r.id INTO v_region_id
    FROM regions r
    WHERE r.is_active = true
        AND r.boundary IS NOT NULL
        AND ST_Contains(
            r.boundary::geometry,
            ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geometry
        )
    LIMIT 1;

    -- If no boundary match, try radius method
    IF v_region_id IS NULL THEN
        SELECT r.id INTO v_region_id
        FROM regions r
        WHERE r.is_active = true
            AND r.center_lat IS NOT NULL
            AND r.center_lng IS NOT NULL
            AND r.radius_miles IS NOT NULL
            AND ST_Distance(
                ST_SetSRID(ST_MakePoint(r.center_lng, r.center_lat), 4326)::geography,
                ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography
            ) * 0.000621371 <= r.radius_miles
        LIMIT 1;
    END IF;

    RETURN v_region_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Function: Update vendor region (for caching)
-- ============================================================================
CREATE OR REPLACE FUNCTION update_vendor_region(
    p_user_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_region_id UUID;
BEGIN
    v_region_id := find_vendor_region(p_user_id);

    UPDATE profiles
    SET region_id = v_region_id,
        updated_at = NOW()
    WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Trigger: Auto-update vendor region when coordinates change
-- ============================================================================
CREATE OR REPLACE FUNCTION trigger_update_vendor_region()
RETURNS TRIGGER AS $$
BEGIN
    -- Only update if coordinates changed
    IF NEW.latitude IS DISTINCT FROM OLD.latitude
        OR NEW.longitude IS DISTINCT FROM OLD.longitude THEN
        NEW.region_id := find_vendor_region(NEW.id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_vendor_region_on_coordinate_change ON profiles;
CREATE TRIGGER update_vendor_region_on_coordinate_change
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_vendor_region();

-- ============================================================================
-- Insert Sample Regions (Examples)
-- ============================================================================

-- Example 1: New York Metro Area (using radius)
INSERT INTO regions (name, description, center_lat, center_lng, radius_miles, is_active)
VALUES (
    'New York Metro',
    'Greater New York Metropolitan Area including NYC, Long Island, and surrounding counties',
    40.7128,
    -74.0060,
    50.0,
    true
) ON CONFLICT (name) DO NOTHING;

-- Example 2: Los Angeles Area (using radius)
INSERT INTO regions (name, description, center_lat, center_lng, radius_miles, is_active)
VALUES (
    'Los Angeles Area',
    'Greater Los Angeles and Orange County area',
    34.0522,
    -118.2437,
    40.0,
    true
) ON CONFLICT (name) DO NOTHING;

-- Example 3: San Francisco Bay Area (using radius)
INSERT INTO regions (name, description, center_lat, center_lng, radius_miles, is_active)
VALUES (
    'San Francisco Bay Area',
    'San Francisco, Oakland, San Jose and surrounding Bay Area',
    37.7749,
    -122.4194,
    50.0,
    true
) ON CONFLICT (name) DO NOTHING;

-- Example 4: Chicago Area (using radius)
INSERT INTO regions (name, description, center_lat, center_lng, radius_miles, is_active)
VALUES (
    'Chicago Metro',
    'Greater Chicago Metropolitan Area',
    41.8781,
    -87.6298,
    45.0,
    true
) ON CONFLICT (name) DO NOTHING;

-- Example 5: Miami-Fort Lauderdale (using radius)
INSERT INTO regions (name, description, center_lat, center_lng, radius_miles, is_active)
VALUES (
    'Miami-Fort Lauderdale',
    'South Florida including Miami, Fort Lauderdale, and surrounding areas',
    25.7617,
    -80.1918,
    35.0,
    true
) ON CONFLICT (name) DO NOTHING;

-- Example 6: Custom Polygon Region (using boundary)
-- This example creates a polygon for Manhattan
INSERT INTO regions (name, description, boundary, is_active)
VALUES (
    'Manhattan',
    'Manhattan borough of New York City',
    ST_GeographyFromText(
        'POLYGON((-74.0479 40.6829, -73.9067 40.7028, -73.9106 40.8820, -74.0185 40.8751, -74.0479 40.6829))'
    ),
    true
) ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- Enable Row Level Security (RLS)
-- ============================================================================
ALTER TABLE regions ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all authenticated users to read regions
CREATE POLICY "Allow authenticated users to read regions"
    ON regions
    FOR SELECT
    TO authenticated
    USING (true);

-- Policy: Only admins can insert/update/delete regions
CREATE POLICY "Only admins can manage regions"
    ON regions
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role = 'admin'
        )
    );

-- ============================================================================
-- Create View: Vendors with their regions
-- ============================================================================
CREATE OR REPLACE VIEW vendors_with_regions AS
SELECT
    u.id,
    u.email,
    u.role,
    u.division,
    u.is_active,
    p.first_name,
    p.last_name,
    p.phone,
    p.city,
    p.state,
    p.latitude,
    p.longitude,
    p.profile_photo_url,
    p.region_id,
    r.name as region_name,
    r.description as region_description
FROM users u
JOIN profiles p ON u.id = p.id
LEFT JOIN regions r ON p.region_id = r.id
WHERE u.role = 'vendor';

-- ============================================================================
-- Helpful Query Examples
-- ============================================================================

-- Query 1: Find all vendors in a specific region
-- SELECT * FROM vendors_with_regions WHERE region_id = 'your-region-uuid-here';

-- Query 2: Find all vendors within 30 miles of a point
-- SELECT
--     u.id,
--     u.email,
--     p.first_name,
--     p.last_name,
--     ST_Distance(
--         ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography,
--         ST_SetSRID(ST_MakePoint(-74.0060, 40.7128), 4326)::geography
--     ) * 0.000621371 as distance_miles
-- FROM users u
-- JOIN profiles p ON u.id = p.id
-- WHERE u.role = 'vendor'
--     AND p.latitude IS NOT NULL
--     AND p.longitude IS NOT NULL
--     AND ST_Distance(
--         ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography,
--         ST_SetSRID(ST_MakePoint(-74.0060, 40.7128), 4326)::geography
--     ) * 0.000621371 <= 30
-- ORDER BY distance_miles;

-- Query 3: Count vendors per region
-- SELECT
--     r.name,
--     r.description,
--     COUNT(p.id) as vendor_count
-- FROM regions r
-- LEFT JOIN profiles p ON p.region_id = r.id
-- LEFT JOIN users u ON p.id = u.id AND u.role = 'vendor'
-- GROUP BY r.id, r.name, r.description
-- ORDER BY vendor_count DESC;

-- Query 4: Update all vendor regions (bulk update)
-- UPDATE profiles p
-- SET region_id = find_vendor_region(p.id)
-- WHERE EXISTS (
--     SELECT 1 FROM users u
--     WHERE u.id = p.id AND u.role = 'vendor'
-- );

-- ============================================================================
-- Maintenance Function: Bulk update all vendor regions
-- ============================================================================
CREATE OR REPLACE FUNCTION update_all_vendor_regions()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
    v_vendor RECORD;
BEGIN
    FOR v_vendor IN
        SELECT p.id
        FROM profiles p
        JOIN users u ON u.id = p.id
        WHERE u.role = 'vendor'
            AND p.latitude IS NOT NULL
            AND p.longitude IS NOT NULL
    LOOP
        PERFORM update_vendor_region(v_vendor.id);
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Grant Permissions
-- ============================================================================
GRANT SELECT ON regions TO authenticated;
GRANT SELECT ON vendors_with_regions TO authenticated;
