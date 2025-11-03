# Global Calendar - Regional Vendor Filtering

## Summary

The Global Calendar page already had the regions dropdown and geographic filtering implemented! I just added debugging logs to match the dashboard for consistency.

## ✅ Features Already Present

### 1. **Regions State Management** (Lines 117-118)
```typescript
const [selectedRegion, setSelectedRegion] = useState<string>("all");
const [regions, setRegions] = useState<Array<{ id: string; name: string }>>([]);
```

### 2. **Load Regions Function** (Lines 295-313)
```typescript
const loadRegions = async () => {
  console.log('[GLOBAL-CALENDAR] 📍 Loading regions...');
  // Fetches all regions from /api/regions
  // Now includes debug logging
}
```

### 3. **Load Vendors with Geographic Filtering** (Lines 317-368)
```typescript
const loadAllVendors = async (regionId: string = selectedRegion) => {
  // Use geographic filtering when a region is selected
  const useGeoFilter = regionId !== "all";
  const url = `/api/all-vendors${regionId !== "all" ? `?region_id=${regionId}&geo_filter=true` : ""}`;
  // Includes comprehensive debug logging
}
```

### 4. **Region Change Handler** (Lines 389-394)
```typescript
const handleRegionChange = async (newRegion: string) => {
  console.log('[GLOBAL-CALENDAR] 🌍 Region changed:', { from: selectedRegion, to: newRegion });
  setSelectedRegion(newRegion);
  setSelectedVendors(new Set());
  loadAllVendors(newRegion);
};
```

### 5. **Region Dropdown UI** (Lines 1320-1349)
Located in the Calendar Availability Request modal:

```typescript
<div className="mb-6">
  <label className="block text-sm font-semibold text-gray-700 mb-2">
    Filter by Region
    {regions.length > 0 && (
      <span className="ml-2 text-xs font-normal text-gray-500">({regions.length} regions)</span>
    )}
  </label>
  <select
    value={selectedRegion}
    onChange={(e) => handleRegionChange(e.target.value)}
    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
  >
    <option value="all">🌎 All Regions</option>
    {regions.map((r) => (
      <option key={r.id} value={r.id}>
        📍 {r.name}
      </option>
    ))}
  </select>
  <div className="flex items-center justify-between mt-1.5">
    <p className="text-xs text-gray-500">
      {selectedRegion === "all" ? "Showing vendors from all regions" : "Filtered by region"}
    </p>
    {selectedRegion !== "all" && (
      <button onClick={() => handleRegionChange("all")} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
        Clear filter
      </button>
    )}
  </div>
</div>
```

## 🆕 What I Added

### Debug Logging
Added comprehensive console logging to match the dashboard page:

1. **loadRegions** (Line 296, 305, 308, 311):
   - Logs when regions are being loaded
   - Shows count and full array of regions
   - Logs errors with status codes

2. **handleRegionChange** (Line 390):
   - Logs region change with old and new values
   - Helps track user interactions

## 📊 How It Works

### When Opening the Modal

1. **User clicks "Calendar Availability Request"** button
2. `openVendorModal()` is called (Line 371)
3. Loads regions: `loadRegions()` (Line 376)
4. Loads all vendors: `loadAllVendors("all")` (Line 377)

**Console Output:**
```
[GLOBAL-CALENDAR] 📍 Loading regions...
[GLOBAL-CALENDAR] ✅ Regions loaded: 5 [{ id: "...", name: "LA Metro", ... }, ...]
[GLOBAL-CALENDAR] 🔍 loadAllVendors called with regionId: all
[GLOBAL-CALENDAR] 📡 Fetching vendors from: /api/all-vendors
```

### When Selecting a Region

1. **User selects "Los Angeles Area"** from dropdown
2. `handleRegionChange(regionId)` is called (Line 389)
3. Updates state and fetches filtered vendors
4. Geographic filtering is applied

**Console Output:**
```
[GLOBAL-CALENDAR] 🌍 Region changed: { from: "all", to: "0d30b13f-..." }
[GLOBAL-CALENDAR] 🔍 loadAllVendors called with regionId: 0d30b13f-...
[GLOBAL-CALENDAR] 📡 Fetching vendors from: /api/all-vendors?region_id=0d30b13f-...&geo_filter=true { useGeoFilter: true }
[GLOBAL-CALENDAR] 📥 Response status: 200 ✅
[ALL-VENDORS] 🔍 Query parameters: { regionId: "0d30b13f-...", useGeoFilter: true }
[ALL-VENDORS] ✅ Region data fetched: { name: "Los Angeles Area", center_lat: 34.0522, ... }
[ALL-VENDORS] 🌍 Geographic filtering will be applied after fetching
[ALL-VENDORS] 📦 Raw vendors fetched: 11
[ALL-VENDORS] 🌍 Applying geographic filter: { region: "Los Angeles Area", center: "34.0522, -118.2437", radius: 75 }
[ALL-VENDORS] 🔍 Vendor vendor@example.com: { coordinates: "34.05, -118.24", distance: "5.2 miles", withinRegion: true }
[ALL-VENDORS] ✅ Geographic filtering complete: { filtered_count: 5, sorted_by: "distance" }
[GLOBAL-CALENDAR] 📦 Received data: { vendors_count: 5, region: "Los Angeles Area", geo_filtered: true }
[GLOBAL-CALENDAR] ✅ Setting vendors state: 5
```

## 🎯 Features

### Geographic Filtering
- ✅ Automatically enabled when a region is selected
- ✅ Uses lat/lng coordinates from profiles table
- ✅ Calculates distance using Haversine formula
- ✅ Filters vendors within region radius
- ✅ Sorts by distance (closest first)

### Region Dropdown
- ✅ Shows all 5 regions (LA Metro, Phoenix Metro, SF Metro, NY Metro, Wisconsin)
- ✅ "All Regions" option to see everyone
- ✅ Clear filter button appears when region is selected
- ✅ Shows helpful text about current filter state
- ✅ Displays region count badge

### Vendor Display
- ✅ Shows distance badge when using geo_filter
- ✅ "No location" badge for vendors without coordinates
- ✅ Profile photos with fallback initials
- ✅ Email, phone, city, state, division, role
- ✅ Checkbox selection for bulk invites

## 🔍 Testing

### Test the Region Filtering

1. **Open Global Calendar** (admin/exec only)
2. **Click "Calendar Availability Request"** button
3. **Check Console** - should see:
   ```
   [GLOBAL-CALENDAR] 📍 Loading regions...
   [GLOBAL-CALENDAR] ✅ Regions loaded: 5
   ```
4. **Select "Los Angeles Area"** from dropdown
5. **Check Console** - should see geographic filtering logs
6. **Verify Vendors** - should show only LA area vendors

### Expected Behavior

**If vendors have lat/lng:**
- ✅ Vendors within 75 miles of LA center appear
- ✅ Sorted by distance (closest first)
- ✅ Distance badge shows miles from center

**If vendors DON'T have lat/lng:**
- ⚠️ They won't appear (excluded by geo filter)
- 📝 Need to geocode their addresses

## 📝 Comparison with Dashboard

Both pages now have identical functionality:

| Feature | Dashboard | Global Calendar |
|---------|-----------|-----------------|
| Region dropdown | ✅ | ✅ |
| Geographic filtering | ✅ | ✅ |
| Debug logging | ✅ | ✅ |
| Distance sorting | ✅ | ✅ |
| Clear filter button | ✅ | ✅ |

## 🚀 Next Steps

1. **Test on both pages** to ensure consistent behavior
2. **Geocode vendors** if they don't have coordinates
3. **Adjust region radii** if needed
4. **Monitor console logs** for any issues

## 📖 Related Documentation

- [docs/GEOGRAPHIC_FILTERING_FIX.md](GEOGRAPHIC_FILTERING_FIX.md) - Main fix explanation
- [docs/DEBUGGING_REGIONS.md](DEBUGGING_REGIONS.md) - Debugging guide
- [docs/GEOCODING.md](GEOCODING.md) - Geocoding system overview
