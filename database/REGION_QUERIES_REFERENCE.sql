-- ============================================================================
-- REGION QUERIES QUICK REFERENCE
-- Common SQL queries for managing and querying regions
-- ============================================================================

-- ============================================================================
-- VIEWING REGIONS
-- ============================================================================

-- View all active regions
SELECT id, name, description, center_lat, center_lng, radius_miles, is_active
FROM regions
WHERE is_active = true
ORDER BY name;

-- View all regions (including inactive)
SELECT id, name, description, center_lat, center_lng, radius_miles, is_active
FROM regions
ORDER BY name;

-- View regions with vendor counts
SELECT
    r.id,
    r.name,
    r.description,
    r.is_active,
    COUNT(DISTINCT p.id) as total_vendors,
    COUNT(DISTINCT CASE WHEN u.is_active = true THEN p.id END) as active_vendors
FROM regions r
LEFT JOIN profiles p ON p.region_id = r.id
LEFT JOIN users u ON p.id = u.id AND u.role = 'vendor'
GROUP BY r.id, r.name, r.description, r.is_active
ORDER BY active_vendors DESC;

-- View region with its boundary details
SELECT
    id,
    name,
    description,
    center_lat,
    center_lng,
    radius_miles,
    ST_AsText(boundary::geometry) as boundary_wkt,
    is_active,
    created_at
FROM regions
WHERE name = 'New York Metro';

-- ============================================================================
-- ADDING REGIONS
-- ============================================================================

-- Add a radius-based region (simple circle)
INSERT INTO regions (name, description, center_lat, center_lng, radius_miles, is_active)
VALUES (
    'Seattle Metro',
    'Greater Seattle Area including Bellevue and Tacoma',
    47.6062,
    -122.3321,
    35.0,
    true
);

-- Add a radius-based region (another example)
INSERT INTO regions (name, description, center_lat, center_lng, radius_miles, is_active)
VALUES (
    'Austin Metro',
    'Greater Austin Area',
    30.2672,
    -97.7431,
    30.0,
    true
);

-- Add a boundary-based region (polygon)
-- Use geojson.io to draw your polygon and get coordinates
INSERT INTO regions (name, description, boundary, is_active)
VALUES (
    'Custom Region Name',
    'Description of the region',
    ST_GeographyFromText('POLYGON((-118.5 34.0, -118.0 34.0, -118.0 34.5, -118.5 34.5, -118.5 34.0))'),
    true
);

-- ============================================================================
-- UPDATING REGIONS
-- ============================================================================

-- Update region radius
UPDATE regions
SET radius_miles = 45.0,
    updated_at = NOW()
WHERE name = 'Seattle Metro';

-- Update region description
UPDATE regions
SET description = 'Updated description here',
    updated_at = NOW()
WHERE name = 'Austin Metro';

-- Move region center
UPDATE regions
SET center_lat = 47.6205,
    center_lng = -122.3493,
    updated_at = NOW()
WHERE name = 'Seattle Metro';

-- Disable a region (soft delete)
UPDATE regions
SET is_active = false,
    updated_at = NOW()
WHERE name = 'Old Region Name';

-- Re-enable a region
UPDATE regions
SET is_active = true,
    updated_at = NOW()
WHERE name = 'Region Name';

-- ============================================================================
-- DELETING REGIONS
-- ============================================================================

-- Delete a region permanently (WARNING: This will set vendor region_id to NULL)
DELETE FROM regions WHERE name = 'Region to Delete';

-- Better approach: Disable instead of delete
UPDATE regions SET is_active = false WHERE name = 'Region to Delete';

-- ============================================================================
-- VENDOR REGION QUERIES
-- ============================================================================

-- Find all vendors in a specific region
SELECT
    u.id,
    u.email,
    p.first_name,
    p.last_name,
    p.city,
    p.state,
    p.latitude,
    p.longitude,
    r.name as region_name
FROM users u
JOIN profiles p ON u.id = p.id
JOIN regions r ON p.region_id = r.id
WHERE r.name = 'New York Metro'
    AND u.role = 'vendor'
    AND u.is_active = true;

-- Find vendors without a region
SELECT
    u.id,
    u.email,
    p.first_name,
    p.last_name,
    p.city,
    p.state,
    p.latitude,
    p.longitude
FROM users u
JOIN profiles p ON u.id = p.id
WHERE u.role = 'vendor'
    AND p.region_id IS NULL
    AND u.is_active = true;

-- Find vendors with coordinates but no region
SELECT
    u.id,
    u.email,
    p.first_name,
    p.last_name,
    p.city,
    p.state,
    p.latitude,
    p.longitude
FROM users u
JOIN profiles p ON u.id = p.id
WHERE u.role = 'vendor'
    AND p.latitude IS NOT NULL
    AND p.longitude IS NOT NULL
    AND p.region_id IS NULL
    AND u.is_active = true;

-- Count vendors per region
SELECT
    r.name as region_name,
    COUNT(p.id) as vendor_count
FROM regions r
LEFT JOIN profiles p ON p.region_id = r.id
LEFT JOIN users u ON p.id = u.id AND u.role = 'vendor' AND u.is_active = true
GROUP BY r.id, r.name
ORDER BY vendor_count DESC;

-- ============================================================================
-- UPDATING VENDOR REGIONS
-- ============================================================================

-- Update all vendor regions (bulk update)
SELECT update_all_vendor_regions();
-- Returns the number of vendors updated

-- Update a specific vendor's region
SELECT update_vendor_region('vendor-user-id-here');

-- Manually find which region a vendor belongs to
SELECT find_vendor_region('vendor-user-id-here');
-- Returns the region UUID or NULL

-- ============================================================================
-- TESTING & VALIDATION
-- ============================================================================

-- Check if a specific coordinate is in a region
SELECT
    r.name,
    r.description,
    is_point_in_region_radius(40.7589, -73.9851, r.id) as is_in_region
FROM regions r
WHERE r.is_active = true;

-- Find which region a specific coordinate belongs to
SELECT
    r.name,
    r.description
FROM regions r
WHERE r.is_active = true
    AND (
        -- Check boundary
        (r.boundary IS NOT NULL AND
         ST_Contains(
             r.boundary::geometry,
             ST_SetSRID(ST_MakePoint(-73.9851, 40.7589), 4326)::geometry
         ))
        OR
        -- Check radius
        (r.center_lat IS NOT NULL AND
         r.center_lng IS NOT NULL AND
         r.radius_miles IS NOT NULL AND
         ST_Distance(
             ST_SetSRID(ST_MakePoint(r.center_lng, r.center_lat), 4326)::geography,
             ST_SetSRID(ST_MakePoint(-73.9851, 40.7589), 4326)::geography
         ) * 0.000621371 <= r.radius_miles)
    );

-- Verify vendor assignments are correct
SELECT
    u.email,
    p.city,
    p.state,
    p.latitude,
    p.longitude,
    r.name as assigned_region,
    r.center_lat,
    r.center_lng,
    r.radius_miles,
    -- Calculate actual distance from region center
    CASE
        WHEN p.latitude IS NOT NULL AND p.longitude IS NOT NULL
             AND r.center_lat IS NOT NULL AND r.center_lng IS NOT NULL
        THEN ST_Distance(
            ST_SetSRID(ST_MakePoint(r.center_lng, r.center_lat), 4326)::geography,
            ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography
        ) * 0.000621371
        ELSE NULL
    END as distance_from_center
FROM users u
JOIN profiles p ON u.id = p.id
LEFT JOIN regions r ON p.region_id = r.id
WHERE u.role = 'vendor'
    AND u.is_active = true
    AND p.latitude IS NOT NULL
    AND p.longitude IS NOT NULL
ORDER BY r.name, distance_from_center;

-- ============================================================================
-- DISTANCE CALCULATIONS
-- ============================================================================

-- Find all vendors within X miles of a point
SELECT
    u.id,
    u.email,
    p.first_name,
    p.last_name,
    p.city,
    p.state,
    ST_Distance(
        ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography,
        ST_SetSRID(ST_MakePoint(-74.0060, 40.7128), 4326)::geography
    ) * 0.000621371 as distance_miles
FROM users u
JOIN profiles p ON u.id = p.id
WHERE u.role = 'vendor'
    AND p.latitude IS NOT NULL
    AND p.longitude IS NOT NULL
    AND ST_Distance(
        ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography,
        ST_SetSRID(ST_MakePoint(-74.0060, 40.7128), 4326)::geography
    ) * 0.000621371 <= 30  -- Within 30 miles
ORDER BY distance_miles;

-- Calculate distance between two regions
SELECT
    r1.name as region_1,
    r2.name as region_2,
    ST_Distance(
        ST_SetSRID(ST_MakePoint(r1.center_lng, r1.center_lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(r2.center_lng, r2.center_lat), 4326)::geography
    ) * 0.000621371 as distance_miles
FROM regions r1
CROSS JOIN regions r2
WHERE r1.id < r2.id  -- Avoid duplicates
    AND r1.center_lat IS NOT NULL
    AND r2.center_lat IS NOT NULL
ORDER BY distance_miles;

-- ============================================================================
-- ANALYTICS & REPORTING
-- ============================================================================

-- Region coverage report
SELECT
    r.name,
    r.radius_miles,
    COUNT(p.id) as total_vendors,
    COUNT(CASE WHEN p.latitude IS NOT NULL THEN 1 END) as vendors_with_coords,
    COUNT(CASE WHEN p.latitude IS NULL THEN 1 END) as vendors_without_coords,
    ROUND(
        COUNT(CASE WHEN p.latitude IS NOT NULL THEN 1 END)::NUMERIC /
        NULLIF(COUNT(p.id), 0) * 100,
        2
    ) as coverage_percentage
FROM regions r
LEFT JOIN profiles p ON p.region_id = r.id
LEFT JOIN users u ON p.id = u.id AND u.role = 'vendor'
WHERE r.is_active = true
GROUP BY r.id, r.name, r.radius_miles
ORDER BY total_vendors DESC;

-- Vendors per state and region
SELECT
    p.state,
    r.name as region_name,
    COUNT(u.id) as vendor_count
FROM users u
JOIN profiles p ON u.id = p.id
LEFT JOIN regions r ON p.region_id = r.id
WHERE u.role = 'vendor'
    AND u.is_active = true
GROUP BY p.state, r.name
ORDER BY p.state, vendor_count DESC;

-- Region overlap analysis (vendors that could belong to multiple regions)
WITH vendor_region_matches AS (
    SELECT
        u.id as vendor_id,
        u.email,
        p.first_name,
        p.last_name,
        r.id as region_id,
        r.name as region_name,
        p.region_id as assigned_region_id
    FROM users u
    JOIN profiles p ON u.id = p.id
    CROSS JOIN regions r
    WHERE u.role = 'vendor'
        AND u.is_active = true
        AND r.is_active = true
        AND p.latitude IS NOT NULL
        AND p.longitude IS NOT NULL
        AND (
            (r.boundary IS NOT NULL AND
             ST_Contains(
                 r.boundary::geometry,
                 ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geometry
             ))
            OR
            (r.center_lat IS NOT NULL AND
             r.center_lng IS NOT NULL AND
             r.radius_miles IS NOT NULL AND
             ST_Distance(
                 ST_SetSRID(ST_MakePoint(r.center_lng, r.center_lat), 4326)::geography,
                 ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography
             ) * 0.000621371 <= r.radius_miles)
        )
)
SELECT
    vendor_id,
    email,
    first_name,
    last_name,
    COUNT(*) as matching_regions,
    STRING_AGG(region_name, ', ') as all_matching_regions
FROM vendor_region_matches
GROUP BY vendor_id, email, first_name, last_name
HAVING COUNT(*) > 1
ORDER BY matching_regions DESC;

-- ============================================================================
-- MAINTENANCE
-- ============================================================================

-- Check for orphaned vendors (have coords but no region)
SELECT COUNT(*)
FROM users u
JOIN profiles p ON u.id = p.id
WHERE u.role = 'vendor'
    AND p.latitude IS NOT NULL
    AND p.longitude IS NOT NULL
    AND p.region_id IS NULL;

-- Fix orphaned vendors
UPDATE profiles p
SET region_id = find_vendor_region(p.id)
WHERE p.id IN (
    SELECT p.id
    FROM users u
    JOIN profiles p ON u.id = p.id
    WHERE u.role = 'vendor'
        AND p.latitude IS NOT NULL
        AND p.longitude IS NOT NULL
        AND p.region_id IS NULL
);

-- Verify PostGIS is installed
SELECT PostGIS_Version();

-- Check spatial indexes
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'regions'
    AND indexdef LIKE '%GIST%';

-- ============================================================================
-- USEFUL COORDINATES FOR TESTING
-- ============================================================================

-- New York City: 40.7128, -74.0060
-- Los Angeles: 34.0522, -118.2437
-- Chicago: 41.8781, -87.6298
-- San Francisco: 37.7749, -122.4194
-- Miami: 25.7617, -80.1918
-- Seattle: 47.6062, -122.3321
-- Austin: 30.2672, -97.7431
-- Boston: 42.3601, -71.0589
-- Denver: 39.7392, -104.9903
-- Atlanta: 33.7490, -84.3880

-- ============================================================================
-- END OF REFERENCE
-- ============================================================================
