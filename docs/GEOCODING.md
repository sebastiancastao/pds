# Geocoding and Regional Filtering System

## Overview

The PDS Event Management system includes a comprehensive geocoding and geographic filtering system that allows:
- Automatic geocoding of user addresses to latitude/longitude coordinates
- Geographic filtering of vendors by region using proximity calculations
- Region-based vendor assignment using distance calculations (Haversine formula)

## Database Schema

### Regions Table
The `regions` table stores geographic areas with their center coordinates and radius:

```sql
CREATE TABLE regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  center_lat NUMERIC(10, 7),    -- Center latitude
  center_lng NUMERIC(10, 7),    -- Center longitude
  radius_miles INTEGER,          -- Radius in miles
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Predefined Regions:**
- **LA Metro**: Los Angeles (34.0522, -118.2437) - 75 mile radius
- **Phoenix Metro**: Phoenix (33.4484, -112.0740) - 50 mile radius
- **SF Metro**: San Francisco (37.7749, -122.4194) - 60 mile radius
- **NY Metro**: New York (40.7128, -74.0060) - 60 mile radius
- **Wisconsin**: Wisconsin State (44.5000, -89.5000) - 150 mile radius

### User Profiles with Geocoding
The `profiles` table includes geocoding fields:

```sql
ALTER TABLE profiles ADD COLUMN latitude NUMERIC(10, 7);
ALTER TABLE profiles ADD COLUMN longitude NUMERIC(10, 7);
ALTER TABLE profiles ADD COLUMN geocoded_address TEXT;
ALTER TABLE profiles ADD COLUMN geocoded_at TIMESTAMP WITH TIME ZONE;
```

## Setup

### 1. Run Database Migrations

Execute these SQL files in your Supabase SQL Editor:

```bash
# Create regions table with geographic data
sql/create_regions.sql

# Add geocoding columns to profiles
sql/add_user_geocoding.sql
```

### 2. Geocoding Service

The system uses **OpenStreetMap Nominatim** (free, no API key required):
- Rate limit: 1 request per second
- Automatically handles rate limiting in batch operations
- No API key or credit card required

**Optional**: You can configure Google Maps Geocoding API by setting:
```env
GOOGLE_MAPS_API_KEY=your_api_key_here
```

## API Endpoints

### 1. Get Vendors with Region Filtering

**Endpoint:** `GET /api/all-vendors`

**Query Parameters:**
- `region_id` (optional): Filter by region ID
- `geo_filter` (optional): Set to `'true'` to use geographic proximity instead of region_id

**Standard Region Filtering (by region_id):**
```javascript
// Get all vendors in LA Metro region
const response = await fetch('/api/all-vendors?region_id=<la-metro-uuid>');
const { vendors } = await response.json();
```

**Geographic Proximity Filtering:**
```javascript
// Get vendors within LA Metro's geographic radius (75 miles from center)
const response = await fetch('/api/all-vendors?region_id=<la-metro-uuid>&geo_filter=true');
const { vendors, region, geo_filtered } = await response.json();

// Vendors are sorted by distance from region center
vendors.forEach(vendor => {
  console.log(`${vendor.profiles.first_name} - ${vendor.distance_from_center} miles away`);
});
```

**Response Format:**
```json
{
  "vendors": [
    {
      "id": "uuid",
      "email": "vendor@example.com",
      "profiles": {
        "first_name": "John",
        "last_name": "Doe",
        "latitude": 34.0522,
        "longitude": -118.2437,
        "city": "Los Angeles",
        "state": "CA"
      },
      "distance_from_center": 15.3,  // Only with geo_filter=true
      "region_id": "uuid"
    }
  ],
  "region": {
    "id": "uuid",
    "name": "LA Metro",
    "center_lat": 34.0522,
    "center_lng": -118.2437,
    "radius_miles": 75
  },
  "geo_filtered": true  // true if geo_filter was used
}
```

### 2. Geocode User Address

**Endpoint:** `POST /api/users/geocode`

**Body:**
```json
{
  "userId": "uuid",  // Optional, defaults to authenticated user
  "address": "123 Main St",
  "city": "Los Angeles",
  "state": "CA",
  "zipCode": "90001"  // Optional
}
```

**Response:**
```json
{
  "success": true,
  "latitude": 34.0522,
  "longitude": -118.2437,
  "geocoded_address": "123 Main St, Los Angeles, CA 90001, USA",
  "profile": { /* updated profile data */ }
}
```

**Permissions:**
- Users can geocode their own address
- Admins can geocode any user's address

### 3. Batch Geocode Users

**Endpoint:** `PUT /api/users/geocode/batch`

**Admin Only** - Geocodes multiple users at once

**Body:**
```json
{
  "userIds": ["uuid1", "uuid2"],  // Specific users
  // OR
  "all": true  // Geocode all users with addresses
}
```

**Response:**
```json
{
  "success": true,
  "message": "Batch geocoding complete",
  "geocoded": 150,
  "failed": 5,
  "total": 155,
  "errors": [
    "uuid1: Failed to geocode",
    "uuid2: Address not found"
  ]
}
```

**Note:** Batch geocoding respects rate limits (1.1 seconds between requests)

## Utility Functions

### JavaScript/TypeScript ([lib/geocoding.ts](lib/geocoding.ts))

```typescript
import {
  calculateDistanceMiles,
  isWithinRegion,
  getUserRegion,
  geocodeAddress
} from '@/lib/geocoding';

// Calculate distance between two points
const distance = calculateDistanceMiles(
  34.0522, -118.2437,  // LA
  37.7749, -122.4194   // SF
);
console.log(`Distance: ${distance} miles`);  // ~347 miles

// Check if user is within a region
const isInRegion = isWithinRegion(
  34.0522, -118.2437,     // User coordinates
  34.0522, -118.2437,     // Region center
  75                       // Region radius (miles)
);

// Find which region a user belongs to
const region = getUserRegion(
  34.0522, -118.2437,     // User coordinates
  regions                  // Array of regions
);
console.log(`User is in: ${region?.name}`);

// Geocode an address
const result = await geocodeAddress(
  '123 Main St',
  'Los Angeles',
  'CA',
  '90001'
);
console.log(`Coordinates: ${result.latitude}, ${result.longitude}`);
```

### PostgreSQL Functions

```sql
-- Calculate distance in miles
SELECT calculate_distance_miles(
  34.0522, -118.2437,  -- Point 1 (LA)
  37.7749, -122.4194   -- Point 2 (SF)
);  -- Returns ~347

-- Check if user is in region
SELECT is_user_in_region(
  34.0522, -118.2437,  -- User lat/lng
  34.0522, -118.2437,  -- Region center lat/lng
  75                    -- Region radius (miles)
);  -- Returns true/false
```

## Usage Examples

### Frontend: Calendar Availability Modal

**Current Implementation** ([app/dashboard/page.tsx:316-346](app/dashboard/page.tsx#L316-L346)):

```typescript
const loadAllVendors = async (regionId: string = selectedRegion) => {
  setLoadingVendors(true);
  try {
    const { data: { session } } = await supabase.auth.getSession();

    // Fetch vendors filtered by region
    const res = await fetch(
      `/api/all-vendors${regionId !== "all" ? `?region_id=${regionId}` : ""}`,
      {
        method: "GET",
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        },
      }
    );

    const data = await res.json();
    setVendors(data.vendors || []);
  } catch (err: any) {
    console.error("Error loading vendors:", err);
  }
  setLoadingVendors(false);
};
```

**With Geographic Filtering:**

```typescript
const loadAllVendors = async (regionId: string = selectedRegion, useGeoFilter: boolean = true) => {
  setLoadingVendors(true);
  try {
    const { data: { session } } = await supabase.auth.getSession();

    // Use geographic proximity filtering
    const params = new URLSearchParams();
    if (regionId !== "all") params.append("region_id", regionId);
    if (useGeoFilter) params.append("geo_filter", "true");

    const res = await fetch(`/api/all-vendors?${params.toString()}`, {
      method: "GET",
      headers: {
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
      },
    });

    const data = await res.json();
    setVendors(data.vendors || []);

    // Show region info
    if (data.region) {
      console.log(`Loading vendors within ${data.region.radius_miles} miles of ${data.region.name}`);
    }
  } catch (err: any) {
    console.error("Error loading vendors:", err);
  }
  setLoadingVendors(false);
};
```

### Admin: Bulk Geocode All Users

```typescript
const geocodeAllUsers = async () => {
  try {
    const response = await fetch('/api/users/geocode/batch', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true })
    });

    const result = await response.json();
    console.log(`Geocoded ${result.geocoded} users successfully`);
    if (result.errors) {
      console.error('Failed geocoding:', result.errors);
    }
  } catch (error) {
    console.error('Batch geocode error:', error);
  }
};
```

## Testing

### Test Distance Calculations

```sql
-- Test distances between major cities
SELECT
  'LA to SF' as route,
  calculate_distance_miles(34.0522, -118.2437, 37.7749, -122.4194) as distance_miles;
-- Expected: ~347 miles

SELECT
  'NY to LA' as route,
  calculate_distance_miles(40.7128, -74.0060, 34.0522, -118.2437) as distance_miles;
-- Expected: ~2451 miles
```

### Test Region Membership

```sql
-- Check if a Santa Monica location (within LA Metro 75-mile radius) is in LA Metro
SELECT is_user_in_region(
  34.0195, -118.4912,  -- Santa Monica, CA
  34.0522, -118.2437,  -- LA Metro center
  75                    -- LA Metro radius
);
-- Expected: true

-- Check if San Diego (outside LA Metro) is in LA Metro
SELECT is_user_in_region(
  32.7157, -117.1611,  -- San Diego, CA
  34.0522, -118.2437,  -- LA Metro center
  75                    -- LA Metro radius
);
-- Expected: false (~120 miles away)
```

## Filtering Modes Comparison

| Mode | Filter Method | Use Case | Pros | Cons |
|------|---------------|----------|------|------|
| **region_id** | Database column match | User explicitly assigned to region | Fast, simple | Requires manual assignment |
| **geo_filter** | Proximity calculation | Automatic based on coordinates | Accurate, automatic | Requires geocoded addresses |

### When to Use Each:

**Use `region_id` filtering:**
- When vendors manually select their region during signup
- For administrative regions that don't match geography exactly
- When you need fast queries without distance calculations

**Use `geo_filter=true`:**
- When you want accurate proximity-based filtering
- To automatically determine region membership
- When vendors' physical locations matter (e.g., travel distance)
- To show vendors sorted by distance

## Best Practices

1. **Geocode on User Creation/Update**
   - Geocode addresses when users enter or update them
   - Store coordinates in the database for fast filtering

2. **Hybrid Approach**
   - Use `region_id` for quick filtering in most UI
   - Use `geo_filter` for admin tools and analytics
   - Let admins assign vendors to regions based on geocoded coordinates

3. **Handle Missing Coordinates**
   - Always check if latitude/longitude exist before using geo_filter
   - Fall back to region_id filtering if coordinates are missing
   - Prompt users to verify/update their address if geocoding fails

4. **Rate Limiting**
   - Respect Nominatim's 1 req/sec rate limit
   - Use batch endpoint for bulk operations
   - Consider caching geocoding results

5. **Privacy**
   - Store coordinates in encrypted profiles if needed
   - Only expose coordinates to authorized users
   - Consider fuzzing coordinates for display (round to 2-3 decimals)

## Troubleshooting

### Geocoding Fails
**Problem:** Address returns no results

**Solution:**
- Verify address format (street, city, state)
- Try without zip code
- Use more general address (e.g., city only)
- Check Nominatim status: https://status.openstreetmap.org/

### No Vendors Found in Region
**Problem:** Region filter returns empty array

**Solution:**
1. Check if vendors have `region_id` set (for region_id filter)
2. Check if vendors have `latitude`/`longitude` set (for geo_filter)
3. Verify region radius is appropriate
4. Run batch geocode to populate coordinates

### Distance Calculations Seem Off
**Problem:** Distances don't match Google Maps

**Solution:**
- Haversine formula gives "as the crow flies" distance
- Actual driving distance will be longer
- For precise routing, use Google Maps Distance Matrix API

## Future Enhancements

- [ ] Add support for multiple overlapping regions
- [ ] Implement region auto-assignment based on coordinates
- [ ] Add UI for admins to view vendors on a map
- [ ] Cache geocoding results to reduce API calls
- [ ] Add driving distance calculations (requires Google Maps API)
- [ ] Support for custom region shapes (polygons instead of circles)
