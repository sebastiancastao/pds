# Geographic Filtering Fix - Summary

## Problem Identified

Based on your console logs, the issue was clear:

```
[DASHBOARD] 📦 Received data:
Object { vendors_count: 11, region: "all", geo_filtered: false, ... }  ✅ Works

[DASHBOARD] 📦 Received data:
Object { vendors_count: 0, region: "Los Angeles Area", geo_filtered: false, ... }  ❌ Fails
```

**Root Cause**: Vendors have `latitude` and `longitude` in the profiles table, but they don't have `region_id` set. When filtering by `region_id`, the database query returns 0 results because no vendors match the region UUID.

## Solution Implemented

✅ **Enabled Geographic Proximity Filtering**

Instead of filtering by `region_id` (which vendors don't have), the system now uses their **latitude/longitude coordinates** to determine if they're within a region's radius.

### Changes Made

#### 1. [app/dashboard/page.tsx](app/dashboard/page.tsx#L327-330)
```typescript
// Before:
const url = `/api/all-vendors${regionId !== "all" ? `?region_id=${regionId}` : ""}`;

// After:
const useGeoFilter = regionId !== "all";
const url = `/api/all-vendors${regionId !== "all" ? `?region_id=${regionId}&geo_filter=true` : ""}`;
```

**What this does**: Adds `&geo_filter=true` parameter when a region is selected, which tells the API to use proximity-based filtering instead of database column filtering.

#### 2. [app/global-calendar/page.tsx](app/global-calendar/page.tsx#L324-327)
Same change applied to the global calendar page for consistency.

#### 3. Sorting Update
```typescript
// When using geo_filter, vendors are already sorted by distance
// Otherwise, sort alphabetically
const allVendors = data.geo_filtered
  ? data.vendors  // Keep distance-based sorting
  : (data.vendors || []).sort(...);  // Alphabetical sorting
```

**What this does**: Respects the distance-based sorting when using geographic filtering (vendors are sorted by proximity to region center).

## How It Works Now

### When "All Regions" is selected:
1. Fetches all 11 vendors
2. No filtering applied
3. Sorts alphabetically

### When "Los Angeles Area" is selected:
1. Fetches all 11 vendors from database
2. Fetches LA Metro region data (center: 34.0522, -118.2437, radius: 75 miles)
3. For each vendor:
   - Checks if they have `latitude` and `longitude`
   - Calculates distance from LA Metro center
   - Includes only vendors within 75 miles
4. Sorts by distance (closest first)
5. Returns filtered vendors

### Expected Console Output

When you select "Los Angeles Area", you should now see:

```
[DASHBOARD] 🌍 Region changed: { from: "all", to: "0d30b13f-2b4d-4abb-a3eb-bb06080ac3cb" }
[DASHBOARD] 🔍 loadAllVendors called with regionId: 0d30b13f-2b4d-4abb-a3eb-bb06080ac3cb
[DASHBOARD] 📡 Fetching vendors from: /api/all-vendors?region_id=0d30b13f-2b4d-4abb-a3eb-bb06080ac3cb&geo_filter=true
[ALL-VENDORS] 🔍 Query parameters: { regionId: "...", useGeoFilter: true }
[ALL-VENDORS] ✅ Region data fetched: { name: "Los Angeles Area", center_lat: 34.0522, ... }
[ALL-VENDORS] 🌍 Geographic filtering will be applied after fetching
[ALL-VENDORS] 📦 Raw vendors fetched: 11
[ALL-VENDORS] 🌍 Applying geographic filter: { region: "Los Angeles Area", center: "34.0522, -118.2437", radius: 75 }
[ALL-VENDORS] 🔍 Vendor vendor1@example.com: { coordinates: "34.05, -118.24", distance: "5.2 miles", withinRegion: true }
[ALL-VENDORS] 🔍 Vendor vendor2@example.com: { coordinates: "33.95, -118.15", distance: "8.7 miles", withinRegion: true }
[ALL-VENDORS] ⚠️ Vendor vendor3 excluded: missing coordinates
[ALL-VENDORS] ✅ Geographic filtering complete: { filtered_count: 5, sorted_by: "distance" }
[DASHBOARD] 📦 Received data: { vendors_count: 5, region: "Los Angeles Area", geo_filtered: true }
```

## Testing Steps

1. **Refresh your browser** to load the new code
2. **Open DevTools Console** (F12)
3. **Go to Dashboard**
4. **Click "Calendar Availability Request"**
5. **Select "Los Angeles Area"** from the dropdown

### Expected Results

**If vendors have latitude/longitude:**
- ✅ You should see vendors that are within 75 miles of LA center
- ✅ Vendors sorted by distance (closest first)
- ✅ Console shows `geo_filtered: true` and each vendor's distance

**If vendors DON'T have latitude/longitude:**
- ⚠️ You'll see: `[ALL-VENDORS] ⚠️ Vendor <id> excluded: missing coordinates`
- ⚠️ Result: 0 vendors (because they can't be geolocated)
- 📝 **Solution**: Run the geocoding script (see below)

## If Vendors Don't Have Coordinates

If you see `missing coordinates` warnings, you need to geocode your vendors' addresses:

### Option 1: Geocode All Vendors at Once (Admin)

```bash
# In your browser console or via API client:
await fetch('/api/users/geocode/batch', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ all: true })
});
```

**Note**: This respects rate limits (1.1 seconds between requests), so it may take time for many vendors.

### Option 2: Geocode Individual Vendor

```bash
await fetch('/api/users/geocode', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'vendor-uuid',
    address: '123 Main St',
    city: 'Los Angeles',
    state: 'CA',
    zipCode: '90001'
  })
});
```

### Option 3: Manually Update Database

If you know the coordinates, you can update them directly:

```sql
-- Update a specific vendor's coordinates
UPDATE profiles
SET
  latitude = 34.0522,
  longitude = -118.2437,
  geocoded_at = NOW()
WHERE id = 'vendor-uuid';
```

## Fallback: If You Want to Use region_id Instead

If you prefer to manually assign vendors to regions (instead of using automatic geographic filtering), you can:

1. **Remove `&geo_filter=true`** from the code changes above
2. **Manually assign region_id** to each vendor:

```sql
-- Get region IDs
SELECT id, name FROM regions;

-- Assign vendors to LA Metro
UPDATE profiles
SET region_id = '0d30b13f-2b4d-4abb-a3eb-bb06080ac3cb'
WHERE id IN (
  SELECT id FROM users
  WHERE email IN ('vendor1@example.com', 'vendor2@example.com', ...)
);
```

## Advantages of Geographic Filtering

✅ **Automatic**: No manual assignment needed
✅ **Accurate**: Based on actual distances
✅ **Dynamic**: Vendors automatically belong to regions based on location
✅ **Sorted**: Shows closest vendors first
✅ **Flexible**: Works with overlapping regions

## Region Radius Settings

Current settings (from [sql/create_regions.sql](sql/create_regions.sql)):

| Region | Center | Radius |
|--------|--------|--------|
| **LA Metro** | 34.0522, -118.2437 | 75 miles |
| **Phoenix Metro** | 33.4484, -112.0740 | 50 miles |
| **SF Metro** | 37.7749, -122.4194 | 60 miles |
| **NY Metro** | 40.7128, -74.0060 | 60 miles |
| **Wisconsin** | 44.5000, -89.5000 | 150 miles |

You can adjust these radii in the database if needed:

```sql
UPDATE regions SET radius_miles = 100 WHERE name = 'LA Metro';
```

## Troubleshooting

### Issue: Still showing 0 vendors

**Check console for:**
```
[ALL-VENDORS] ⚠️ Vendor <id> excluded: missing coordinates
```

**Solution**: Vendors need latitude/longitude. Run geocoding (see above).

### Issue: Wrong vendors showing up

**Check console for:**
```
[ALL-VENDORS] 🔍 Vendor vendor@email.com: { distance: "85.3 miles", withinRegion: false }
```

**Possible causes:**
- Vendor's address is incorrect
- Vendor's coordinates are wrong
- Region radius is too small

**Solution**:
- Re-geocode vendor with correct address
- Or adjust region radius

### Issue: Want to use region_id instead

**Solution**:
1. Remove `&geo_filter=true` from the code
2. Assign vendors to regions in database:
   ```sql
   UPDATE profiles SET region_id = '<region-uuid>' WHERE id = '<vendor-uuid>';
   ```

## Next Steps

1. ✅ **Test the fix** - Select a region and check console logs
2. 📍 **Geocode vendors** - If needed, run the geocoding API
3. 🔧 **Adjust radii** - If regions are too small/large, update in database
4. 📊 **Monitor logs** - Check for any vendors without coordinates

## Summary

The fix is **already deployed** in your code. Just:
1. Refresh your browser
2. Select a region
3. Vendors within that region's radius will appear (if they have coordinates)

If vendors have coordinates → It will work immediately ✅
If vendors don't have coordinates → Run geocoding first 📍
