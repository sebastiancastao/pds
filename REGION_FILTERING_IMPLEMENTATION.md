# Region Filtering Implementation Guide

## Overview

This implementation adds a comprehensive region-based filtering system for vendors, allowing admins to filter vendors by geographic regions when sending calendar availability requests. The system uses PostGIS for accurate geocoding and distance calculations.

## What Was Added

### 1. Database Layer

#### Migration File: `database/migrations/025_create_regions_table.sql`

This migration creates:
- **`regions` table** with PostGIS support for geocoding
- Two region definition methods:
  - **Radius-based**: Center point (lat/lng) + radius in miles
  - **Boundary-based**: Polygon geometry for complex shapes
- **Helper functions**:
  - `is_point_in_region()` - Check if coordinates are within a polygon region
  - `is_point_in_region_radius()` - Check if coordinates are within a radius region
  - `find_vendor_region()` - Automatically determine vendor's region
  - `update_vendor_region()` - Update a single vendor's region
  - `update_all_vendor_regions()` - Bulk update all vendor regions
- **Automatic trigger** - Updates vendor region when coordinates change
- **Sample regions** - Pre-populated US metro areas (NYC, LA, SF, Chicago, Miami)
- **RLS policies** - Security for the regions table
- **View**: `vendors_with_regions` - Easy querying of vendors with their regions

#### New Column: `profiles.region_id`

Added to cache the vendor's region assignment for performance.

### 2. API Layer

#### New Endpoint: `app/api/regions/route.ts`

**GET /api/regions**
- Fetches all active regions
- Query parameters:
  - `include_inactive=true` - Include inactive regions
  - `with_vendor_count=true` - Include vendor count per region
- Returns: `{ regions: [...], count: number }`

**POST /api/regions** (Admin only)
- Creates a new region
- Body:
  ```json
  {
    "name": "Region Name",
    "description": "Description",
    "center_lat": 40.7128,
    "center_lng": -74.0060,
    "radius_miles": 50.0
  }
  ```

#### Updated Endpoint: `app/api/vendors/route.ts`

**GET /api/vendors**
- Added `region_id` query parameter for filtering
- Returns vendors filtered by region
- Example: `/api/vendors?venue=Madison%20Square%20Garden&region_id=uuid-here`

### 3. Frontend Layer

#### Updated: `app/dashboard/page.tsx`

**New State Variables:**
```typescript
const [selectedRegion, setSelectedRegion] = useState<string>("all");
const [regions, setRegions] = useState<Array<{id: string; name: string}>>([]);
```

**New Functions:**
- `loadRegions()` - Fetches available regions from API
- `handleRegionChange()` - Handles region selection and reloads vendors

**UI Changes:**
- Added region dropdown filter in Vendor Invitation Modal
- Dropdown appears between the info banner and vendor list
- Automatically reloads vendors when region changes
- Clears vendor selection when region changes

## How to Use

### Step 1: Apply the Database Migration

1. Open Supabase Dashboard
2. Go to **SQL Editor**
3. Copy contents from `database/migrations/025_create_regions_table.sql`
4. Paste and **RUN**

See detailed instructions in: `database/APPLY_MIGRATION_025.md`

### Step 2: Populate Vendor Regions

After migration, run this SQL to assign regions to all vendors:

```sql
SELECT update_all_vendor_regions();
```

This will return the number of vendors updated.

### Step 3: Test the Feature

1. Go to Dashboard → Events tab
2. Click **"Calendar Availability Request"** button
3. The modal will open with a **"Filter by Region"** dropdown
4. Select a region to filter vendors by that geographic area
5. Only vendors in the selected region will appear in the list

## Region Management

### View All Regions

```sql
SELECT id, name, description, center_lat, center_lng, radius_miles, is_active
FROM regions
ORDER BY name;
```

### Add a New Region

#### Radius-Based (Simple)

```sql
INSERT INTO regions (name, description, center_lat, center_lng, radius_miles, is_active)
VALUES (
    'Boston Metro',
    'Greater Boston Area',
    42.3601,
    -71.0589,
    30.0,
    true
);
```

#### Boundary-Based (Advanced)

```sql
INSERT INTO regions (name, description, boundary, is_active)
VALUES (
    'Custom Region',
    'Custom polygon region',
    ST_GeographyFromText('POLYGON((-118.5 34.0, -118.0 34.0, -118.0 34.5, -118.5 34.5, -118.5 34.0))'),
    true
);
```

**Tip**: Use [geojson.io](https://geojson.io/) to draw polygons and get coordinates.

### Update a Region

```sql
UPDATE regions
SET radius_miles = 40.0,
    description = 'Updated description'
WHERE name = 'Boston Metro';
```

### Disable a Region

```sql
UPDATE regions
SET is_active = false
WHERE name = 'Old Region';
```

### View Vendor Count Per Region

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

## How It Works

### Geocoding Process

1. **Vendor Location**: Each vendor has `latitude` and `longitude` in their profile
2. **Region Definition**: Each region is defined by either:
   - Center point + radius (circle)
   - Polygon boundary (any shape)
3. **Automatic Assignment**: When a vendor updates their coordinates, a trigger automatically:
   - Calculates which region they belong to
   - Updates their `region_id` in the profiles table
4. **Filtering**: When filtering by region:
   - API queries vendors where `region_id = selected_region`
   - Only vendors in that region are returned

### Performance Optimization

- **Spatial Indexes**: PostGIS spatial indexes on region boundaries for fast queries
- **Cached Regions**: Vendor's `region_id` is cached in profiles table
- **Automatic Updates**: Trigger keeps region assignments up-to-date

## Architecture Diagram

```
┌─────────────────┐
│   Dashboard     │
│   (Frontend)    │
└────────┬────────┘
         │ 1. Load regions
         ↓
┌─────────────────┐
│ /api/regions    │
│   (GET)         │
└────────┬────────┘
         │ 2. Fetch from DB
         ↓
┌─────────────────┐
│ regions table   │
│ (Database)      │
└─────────────────┘

┌─────────────────┐
│   Dashboard     │
│  (User selects) │
└────────┬────────┘
         │ 3. Filter by region
         ↓
┌─────────────────┐
│ /api/vendors    │
│ ?region_id=...  │
└────────┬────────┘
         │ 4. Query vendors
         ↓
┌─────────────────┐
│  users table    │
│  JOIN profiles  │
│  WHERE region_id│
└─────────────────┘
```

## Pre-Populated Regions

The migration includes these sample regions:

1. **New York Metro** - 50 mile radius
   - Center: 40.7128°N, 74.0060°W

2. **Los Angeles Area** - 40 mile radius
   - Center: 34.0522°N, 118.2437°W

3. **San Francisco Bay Area** - 50 mile radius
   - Center: 37.7749°N, 122.4194°W

4. **Chicago Metro** - 45 mile radius
   - Center: 41.8781°N, 87.6298°W

5. **Miami-Fort Lauderdale** - 35 mile radius
   - Center: 25.7617°N, 80.1918°W

6. **Manhattan** - Polygon boundary
   - Custom boundary for Manhattan borough

## Troubleshooting

### Issue: Vendors Not Showing Up in Region

**Solution**: Update vendor regions manually:
```sql
SELECT update_all_vendor_regions();
```

### Issue: Vendor Has No Region

**Check if vendor has coordinates:**
```sql
SELECT u.email, p.latitude, p.longitude, p.region_id
FROM users u
JOIN profiles p ON u.id = p.id
WHERE u.role = 'vendor' AND p.region_id IS NULL;
```

If they lack coordinates, they need to update their profile.

### Issue: Region Filter Not Working

1. Check if regions API is returning data:
   - Open browser console
   - Look for `/api/regions` request
   - Verify it returns regions

2. Check if vendors API is filtering:
   - Look for `/api/vendors?venue=...&region_id=...` request
   - Verify `region_id` parameter is present

3. Check database:
```sql
SELECT COUNT(*) FROM regions WHERE is_active = true;
SELECT COUNT(*) FROM profiles WHERE region_id IS NOT NULL;
```

## Files Changed/Added

### New Files
- `database/migrations/025_create_regions_table.sql` - Database schema
- `database/APPLY_MIGRATION_025.md` - Migration guide
- `app/api/regions/route.ts` - Regions API endpoint
- `REGION_FILTERING_IMPLEMENTATION.md` - This file

### Modified Files
- `app/dashboard/page.tsx` - Added region dropdown and filtering logic
- `app/api/vendors/route.ts` - Added region_id parameter support

## Future Enhancements

### Possible Improvements

1. **Admin UI for Region Management**
   - Create/edit/delete regions from admin panel
   - Visual map interface for drawing boundaries
   - Region analytics and statistics

2. **Multiple Region Assignment**
   - Allow vendors to work in multiple regions
   - Create junction table for many-to-many relationship

3. **Region Hierarchy**
   - Parent/child regions (e.g., "Northeast" contains "New York Metro")
   - Nested filtering capabilities

4. **Advanced Filtering**
   - Combine region + distance filtering
   - Filter by multiple regions simultaneously
   - Exclude regions

5. **Performance Optimization**
   - Cache region data in frontend
   - Implement pagination for large vendor lists
   - Add vendor count to region dropdown

## Testing Checklist

- [ ] Migration applied successfully
- [ ] Sample regions created
- [ ] Vendor regions populated (`update_all_vendor_regions()`)
- [ ] API `/api/regions` returns regions
- [ ] API `/api/vendors` accepts `region_id` parameter
- [ ] Dashboard dropdown shows regions
- [ ] Selecting a region filters vendors correctly
- [ ] "All Regions" shows all vendors
- [ ] Vendor selection clears when region changes
- [ ] Can send invitations to filtered vendors

## API Reference

### GET /api/regions

**Request:**
```
GET /api/regions
GET /api/regions?include_inactive=true
GET /api/regions?with_vendor_count=true
```

**Response:**
```json
{
  "regions": [
    {
      "id": "uuid",
      "name": "New York Metro",
      "description": "Greater NYC Area",
      "center_lat": 40.7128,
      "center_lng": -74.0060,
      "radius_miles": 50.0,
      "boundary": null,
      "is_active": true,
      "created_at": "2024-01-01T00:00:00Z",
      "vendor_count": 45  // if with_vendor_count=true
    }
  ],
  "count": 5
}
```

### GET /api/vendors

**Request:**
```
GET /api/vendors?venue=Madison%20Square%20Garden
GET /api/vendors?venue=Madison%20Square%20Garden&region_id=uuid-here
```

**Response:**
```json
{
  "vendors": [
    {
      "id": "uuid",
      "email": "vendor@example.com",
      "role": "vendor",
      "division": "vendor",
      "is_active": true,
      "profiles": {
        "first_name": "John",
        "last_name": "Doe",
        "phone": "(555) 123-4567",
        "city": "New York",
        "state": "NY",
        "latitude": 40.7589,
        "longitude": -73.9851,
        "profile_photo_url": "data:image/jpeg;base64,..."
      },
      "region_id": "uuid",
      "distance": 2.5,
      "hasCoordinates": true
    }
  ],
  "venue": {
    "name": "Madison Square Garden",
    "city": "New York",
    "state": "NY"
  }
}
```

## Support

For questions or issues:
1. Check `APPLY_MIGRATION_025.md` for migration help
2. Review sample queries in the migration SQL file
3. Test queries in Supabase SQL Editor before production use

---

**Implementation Date**: 2025-10-29
**Version**: 1.0
**Dependencies**: PostGIS extension, Supabase
