# Apply Migration 025: Regions Table with Geocoding

This migration creates a comprehensive regions system for filtering vendors by geographic location.

## What This Migration Does

1. **Enables PostGIS Extension** - Adds spatial database capabilities
2. **Creates Regions Table** - Stores geographic regions with boundaries or radius-based definitions
3. **Adds region_id to Profiles** - Links vendors to their regions
4. **Creates Helper Functions**:
   - `is_point_in_region()` - Check if coordinates are within a region (boundary)
   - `is_point_in_region_radius()` - Check if coordinates are within a region (radius)
   - `find_vendor_region()` - Automatically determine vendor's region
   - `update_vendor_region()` - Update a single vendor's region
   - `update_all_vendor_regions()` - Bulk update all vendor regions
5. **Creates Automatic Trigger** - Updates vendor region when coordinates change
6. **Adds Sample Regions** - Pre-populates common US metro areas
7. **Sets Up RLS Policies** - Secures the regions table
8. **Creates Views** - `vendors_with_regions` view for easy querying

## How to Apply

### Option 1: Using Supabase Dashboard (Recommended)

1. Go to your Supabase Dashboard
2. Navigate to **SQL Editor**
3. Open the file: `database/migrations/025_create_regions_table.sql`
4. Copy the entire contents
5. Paste into the SQL Editor
6. Click **RUN** button

### Option 2: Using Supabase CLI

```bash
# Make sure you're in the project root
cd c:\Users\sebas\OneDrive\Escritorio\PDS

# Apply the migration
supabase db push
```

### Option 3: Using psql

```bash
psql -h your-project.supabase.co -U postgres -d postgres -f database/migrations/025_create_regions_table.sql
```

## After Migration

### 1. Verify PostGIS Installation

```sql
SELECT PostGIS_Version();
```

### 2. Check Regions Table

```sql
SELECT id, name, description, is_active FROM regions;
```

### 3. Update All Vendor Regions

After migration, run this to populate all vendor regions based on their coordinates:

```sql
SELECT update_all_vendor_regions();
```

This will return the number of vendors updated.

### 4. Verify Vendor Regions

```sql
SELECT * FROM vendors_with_regions LIMIT 10;
```

## Region Types

This system supports two types of regions:

### 1. Radius-Based Regions (Simple)
- Define a center point (latitude, longitude)
- Set a radius in miles
- Vendors within the radius are in the region

Example:
```sql
INSERT INTO regions (name, description, center_lat, center_lng, radius_miles)
VALUES (
    'Austin Metro',
    'Greater Austin Area',
    30.2672,
    -97.7431,
    30.0
);
```

### 2. Boundary-Based Regions (Advanced)
- Define a polygon boundary using coordinates
- More accurate for irregular shapes
- Best for city boundaries, neighborhoods, etc.

Example:
```sql
INSERT INTO regions (name, description, boundary)
VALUES (
    'Custom Region',
    'Custom polygon region',
    ST_GeographyFromText('POLYGON((-118.5 34.0, -118.0 34.0, -118.0 34.5, -118.5 34.5, -118.5 34.0))')
);
```

## Managing Regions

### Add a New Region (Radius-based)

```sql
INSERT INTO regions (name, description, center_lat, center_lng, radius_miles, is_active)
VALUES (
    'Seattle Metro',
    'Greater Seattle Area including Bellevue and Tacoma',
    47.6062,
    -122.3321,
    35.0,
    true
);
```

### Add a New Region (Boundary-based)

You can use tools like [geojson.io](https://geojson.io/) to draw polygons and get coordinates:

```sql
INSERT INTO regions (name, description, boundary, is_active)
VALUES (
    'Brooklyn',
    'Brooklyn borough of New York City',
    ST_GeographyFromText('POLYGON((coordinates here))'),
    true
);
```

### Update a Region

```sql
UPDATE regions
SET radius_miles = 40.0,
    description = 'Updated description'
WHERE name = 'Seattle Metro';
```

### Disable a Region

```sql
UPDATE regions
SET is_active = false
WHERE name = 'Old Region Name';
```

### Delete a Region

```sql
DELETE FROM regions
WHERE name = 'Region Name';
```

## Useful Queries

### Find All Vendors in a Region

```sql
SELECT
    u.email,
    p.first_name,
    p.last_name,
    p.city,
    p.state,
    r.name as region_name
FROM users u
JOIN profiles p ON u.id = p.id
JOIN regions r ON p.region_id = r.id
WHERE r.name = 'New York Metro'
    AND u.role = 'vendor'
    AND u.is_active = true;
```

### Count Vendors Per Region

```sql
SELECT
    r.name,
    r.description,
    COUNT(p.id) as vendor_count
FROM regions r
LEFT JOIN profiles p ON p.region_id = r.id
LEFT JOIN users u ON p.id = u.id AND u.role = 'vendor' AND u.is_active = true
GROUP BY r.id, r.name, r.description
ORDER BY vendor_count DESC;
```

### Find Vendors Without a Region

```sql
SELECT
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
```

### Find Which Region a Specific Coordinate Belongs To

```sql
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
             ST_SetSRID(ST_MakePoint(-118.2437, 34.0522), 4326)::geometry
         ))
        OR
        -- Check radius
        (r.center_lat IS NOT NULL AND
         r.center_lng IS NOT NULL AND
         r.radius_miles IS NOT NULL AND
         ST_Distance(
             ST_SetSRID(ST_MakePoint(r.center_lng, r.center_lat), 4326)::geography,
             ST_SetSRID(ST_MakePoint(-118.2437, 34.0522), 4326)::geography
         ) * 0.000621371 <= r.radius_miles)
    );
```

## Troubleshooting

### PostGIS Not Available

If you get an error about PostGIS:
```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

If that fails, contact Supabase support as PostGIS should be available by default.

### Vendor Regions Not Updating

Check if vendors have valid coordinates:
```sql
SELECT COUNT(*)
FROM users u
JOIN profiles p ON u.id = p.id
WHERE u.role = 'vendor'
    AND (p.latitude IS NULL OR p.longitude IS NULL);
```

If many vendors lack coordinates, they need to update their profiles.

### Trigger Not Working

Verify the trigger exists:
```sql
SELECT * FROM pg_trigger WHERE tgname = 'update_vendor_region_on_coordinate_change';
```

If missing, recreate it:
```sql
DROP TRIGGER IF EXISTS update_vendor_region_on_coordinate_change ON profiles;
CREATE TRIGGER update_vendor_region_on_coordinate_change
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_vendor_region();
```

## Performance Considerations

- **Spatial Indexes**: Already created on `boundary` column
- **Region Cache**: The `region_id` in profiles caches the region assignment
- **Trigger**: Automatically updates region when coordinates change
- **Bulk Updates**: Use `update_all_vendor_regions()` sparingly (it's resource-intensive)

## Next Steps

1. Apply the migration
2. Run `SELECT update_all_vendor_regions();` to populate regions
3. Create the API endpoint at `app/api/regions/route.ts` (see API documentation)
4. Test the region filter in the Vendor Invitation Modal
5. Consider adding more regions for your service areas

## Need Help?

- Check the sample regions included in the migration
- Review the helpful query examples at the end of the migration file
- Test queries in the Supabase SQL Editor before using in production
