# Manager Region Detection Enhancement

## Overview
Enhanced the dashboard's region detection system to automatically geocode manager addresses and filter vendors/employees based on geographic regions. Managers now have full control over region selection with an interactive dropdown in both the Calendar Availability Request modal and HR Employees tab.

## Latest Update (v2.1)
**Fixed region filtering for managers**:
- Removed the restriction that prevented managers from changing regions
- `handleRegionChange` function now works for both managers and executives
- Managers can freely select any region from the dropdown
- Vendor list updates immediately when region changes
- Auto-detected region is still highlighted with "(Your Region)" label

## Previous Update (v2)
**Added region dropdown control for managers**:
- Managers can now change their region filter using a dropdown (previously read-only)
- Both Calendar Availability Request modal and HR Employees tab show the region dropdown
- Auto-detected region is highlighted with "(Your Region)" label in the dropdown
- Info banner notifies managers their region was auto-detected but can be changed
- Maintains backward compatibility with executives who always had full control

## Changes Made

### 1. Automatic Address Geocoding
When a manager logs in, the system now automatically geocodes their address if coordinates aren't already stored:

**Location**: [app/dashboard/page.tsx:328-364](app/dashboard/page.tsx#L328-L364)

```typescript
// If no coordinates but user has address, geocode it
if ((!userLat || !userLng) && profileData?.city && profileData?.state) {
  const geocodeResult = await geocodeAddress(
    '', // No street address needed
    profileData.city,
    profileData.state
  );

  if (geocodeResult) {
    userLat = geocodeResult.latitude;
    userLng = geocodeResult.longitude;
  }
}
```

**Benefits**:
- Managers don't need pre-stored coordinates in their profile
- Uses city and state from the profiles table
- Falls back gracefully if geocoding fails

### 2. Improved Region Detection
Refactored region detection to use the standardized `getUserRegion()` utility function from the geocoding library.

**Location**: [app/dashboard/page.tsx:390-427](app/dashboard/page.tsx#L390-L427)

```typescript
// Use the geocoding utility to find the user's region
const userRegion = getUserRegion(userLat, userLng, allRegions);

if (userRegion) {
  setDetectedRegion({ id: userRegion.id, name: userRegion.name });

  // For managers, auto-set their region filter
  if (role === 'manager') {
    setSelectedRegion(userRegion.id);
    setSelectedEmployeeRegion(userRegion.id);
  }
}
```

**Benefits**:
- Consistent distance calculation using Haversine formula
- Finds the closest region if user is in multiple overlapping regions
- More maintainable code using shared utilities

### 3. Region Filtering Flow

#### For Managers:
1. **Login**: Manager authenticates
2. **Geocoding**: System geocodes their profile address (city, state)
3. **Region Detection**: Determines which region contains their coordinates
4. **Auto-Filter**: Automatically sets region filter for both:
   - Calendar Availability Request modal (vendor list)
   - HR → Employees tab (employee list)

#### For Executives:
1. Can see all regions
2. Can manually change region filter
3. No automatic filtering applied

## Region Display

### Calendar Availability Request Modal
**Location**: [app/dashboard/page.tsx:1692-1737](app/dashboard/page.tsx#L1692-L1737)

For managers, displays:
```
┌─────────────────────────────────────────────┐
│ ℹ Your region was auto-detected: Region Name│
│   You can change it below if needed.        │
├─────────────────────────────────────────────┤
│ Filter by Region                            │
│ [Dropdown: All Regions / Region List]       │
│ Showing N vendors in [Region Name]          │
└─────────────────────────────────────────────┘
```

**Features**:
- Auto-detection notice banner (blue info box)
- Fully functional region dropdown
- Manager's region marked as "(Your Region)" in dropdown
- Can change to other regions or "All Regions"
- Real-time vendor count display

### HR → Employees Tab
**Location**: [app/dashboard/page.tsx:1371-1425](app/dashboard/page.tsx#L1371-L1425)

For managers, displays:
```
┌─────────────────────────────────────────────┐
│ Search: [___] [Region Dropdown▼]            │
├─────────────────────────────────────────────┤
│ ℹ Your region was auto-detected: Region Name│
│   • Showing N employees                     │
└─────────────────────────────────────────────┘
```

**Features**:
- Region dropdown in filter bar (visible for both managers and executives)
- Manager's region marked as "(Your Region)" in dropdown
- Auto-detection info banner below filters
- Executive users also see State and Department dropdowns

## Data Flow

### User Profile Data Required
The system uses the following fields from the `profiles` table:
- `city` - City name (required for geocoding)
- `state` - State abbreviation (required for geocoding)
- `latitude` - Cached latitude (optional, will be geocoded if missing)
- `longitude` - Cached longitude (optional, will be geocoded if missing)

### Region Data Structure
Regions are defined in the database with:
- `id` - Unique identifier
- `name` - Display name (e.g., "Chicago Metropolitan Area")
- `center_lat` - Center point latitude
- `center_lng` - Center point longitude
- `radius_miles` - Radius in miles

## API Integration

### Employees API
**Endpoint**: `/api/employees`

Supports the following query parameters:
- `region_id` - Filter by region ID
- `geo_filter=true` - Enable geographic filtering (calculates distance)
- `state` - Filter by state

Example for manager in region "chicago":
```
GET /api/employees?region_id=chicago&geo_filter=true
```

Response includes:
```json
{
  "employees": [...],
  "region": {
    "id": "chicago",
    "name": "Chicago Metropolitan Area",
    "center_lat": 41.8781,
    "center_lng": -87.6298,
    "radius_miles": 50
  },
  "geo_filtered": true
}
```

## Fallback Mechanisms

The system includes multiple fallback strategies:

1. **Primary**: Profile coordinates (latitude/longitude)
2. **Fallback 1**: Geocode from profile address (city, state)
3. **Fallback 2**: Browser geolocation API
4. **Fallback 3**: Database region_id field
5. **Final Fallback**: Show all regions (for executives)

## Error Handling

All geocoding operations are wrapped in try-catch blocks:
- Geocoding failures don't block dashboard access
- Console warnings logged for debugging
- Graceful degradation to fallback methods

## Testing Checklist

- [ ] Manager logs in with city/state but no coordinates → Address geocoded
- [ ] Manager sees auto-detected region in Calendar modal
- [ ] Manager sees auto-detected region in HR Employees tab
- [ ] Vendor list filtered to manager's region
- [ ] Employee list filtered to manager's region
- [ ] Executive can change region filter
- [ ] Fallback to region_id if geocoding fails
- [ ] Error handling doesn't break dashboard

## Related Files

- [lib/geocoding.ts](lib/geocoding.ts) - Geocoding utilities
- [app/api/employees/route.ts](app/api/employees/route.ts) - Employee API with region filtering
- [app/api/regions/route.ts](app/api/regions/route.ts) - Region definitions
- [app/dashboard/page.tsx](app/dashboard/page.tsx) - Main dashboard component

## Future Enhancements

1. Cache geocoded coordinates back to profiles table to reduce API calls
2. Add background job to geocode all users missing coordinates
3. Show distance from region center for each vendor/employee
4. Allow managers to request access to additional regions
5. Add region boundary visualization on a map
