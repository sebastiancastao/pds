// Geocoding utility using Nominatim (OpenStreetMap) - Free, no API key required
// Rate limit: 1 request per second

export interface GeocodingResult {
  latitude: number;
  longitude: number;
  display_name?: string;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface Region {
  id: string;
  name: string;
  center_lat: number;
  center_lng: number;
  radius_miles: number;
}

/**
 * Geocode an address to latitude/longitude coordinates
 * Uses OpenStreetMap Nominatim service (free, no API key required)
 */
export async function geocodeAddress(
  address: string,
  city: string,
  state: string,
  zipCode?: string
): Promise<GeocodingResult | null> {
  try {
    // Build the query string
    const parts = [address, city, state, zipCode].filter(Boolean);
    const query = parts.join(', ');

    // Use Nominatim API (OpenStreetMap)
    const url = `https://nominatim.openstreetmap.org/search?` +
      `q=${encodeURIComponent(query)}` +
      `&format=json` +
      `&limit=1` +
      `&addressdetails=1` +
      `&countrycodes=us`; // Limit to US addresses

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'PDS-Event-Management-System' // Required by Nominatim
      }
    });

    if (!response.ok) {
      console.error('Geocoding API error:', response.status);
      return null;
    }

    const data = await response.json();

    if (data && data.length > 0) {
      const result = data[0];
      return {
        latitude: parseFloat(result.lat),
        longitude: parseFloat(result.lon),
        display_name: result.display_name
      };
    }

    console.warn('No geocoding results found for:', query);
    return null;
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
}

/**
 * Add delay between geocoding requests (Nominatim rate limit: 1 req/sec)
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Geocode multiple addresses with rate limiting
 */
export async function geocodeMultiple(
  addresses: Array<{
    id: string;
    address: string;
    city: string;
    state: string;
    zipCode?: string;
  }>
): Promise<Array<{ id: string; result: GeocodingResult | null }>> {
  const results = [];

  for (const addr of addresses) {
    const result = await geocodeAddress(
      addr.address,
      addr.city,
      addr.state,
      addr.zipCode
    );

    results.push({
      id: addr.id,
      result
    });

    // Wait 1 second between requests to respect rate limit
    if (addresses.indexOf(addr) < addresses.length - 1) {
      await delay(1100); // 1.1 seconds to be safe
    }
  }

  return results;
}

/**
 * Calculate distance between two points using Haversine formula
 * @param lat1 Latitude of point 1
 * @param lon1 Longitude of point 1
 * @param lat2 Latitude of point 2
 * @param lon2 Longitude of point 2
 * @returns Distance in miles
 */
export function calculateDistanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3959; // Earth's radius in miles
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return distance;
}

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Check if a coordinate is within a region's radius
 * @param userLat User's latitude
 * @param userLon User's longitude
 * @param regionCenterLat Region center latitude
 * @param regionCenterLon Region center longitude
 * @param regionRadiusMiles Region radius in miles
 * @returns true if user is within region
 */
export function isWithinRegion(
  userLat: number | null,
  userLon: number | null,
  regionCenterLat: number | null,
  regionCenterLon: number | null,
  regionRadiusMiles: number | null
): boolean {
  if (
    userLat == null ||
    userLon == null ||
    regionCenterLat == null ||
    regionCenterLon == null ||
    regionRadiusMiles == null
  ) {
    return false;
  }

  const distance = calculateDistanceMiles(
    userLat,
    userLon,
    regionCenterLat,
    regionCenterLon
  );

  return distance <= regionRadiusMiles;
}

/**
 * Get user's region based on their coordinates
 * @param userLat User's latitude
 * @param userLon User's longitude
 * @param regions Array of regions with center coordinates and radius
 * @returns Region object if within a region, null otherwise
 */
export function getUserRegion(
  userLat: number | null,
  userLon: number | null,
  regions: Region[]
): Region | null {
  if (userLat == null || userLon == null) {
    return null;
  }

  // Find the first region that contains the user
  // If user is in multiple overlapping regions, return the closest one
  let closestRegion: Region | null = null;
  let minDistance = Infinity;

  for (const region of regions) {
    const distance = calculateDistanceMiles(
      userLat,
      userLon,
      region.center_lat,
      region.center_lng
    );

    if (distance <= region.radius_miles && distance < minDistance) {
      closestRegion = region;
      minDistance = distance;
    }
  }

  return closestRegion;
}

/**
 * Get distance from user to region center
 * @param userLat User's latitude
 * @param userLon User's longitude
 * @param regionCenterLat Region center latitude
 * @param regionCenterLon Region center longitude
 * @returns Distance in miles, or null if coordinates are missing
 */
export function getDistanceToRegion(
  userLat: number | null,
  userLon: number | null,
  regionCenterLat: number | null,
  regionCenterLon: number | null
): number | null {
  if (
    userLat == null ||
    userLon == null ||
    regionCenterLat == null ||
    regionCenterLon == null
  ) {
    return null;
  }

  return calculateDistanceMiles(
    userLat,
    userLon,
    regionCenterLat,
    regionCenterLon
  );
}
