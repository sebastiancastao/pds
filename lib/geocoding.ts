// Geocoding utility using Nominatim (OpenStreetMap) - Free, no API key required
// Rate limit: 1 request per second

export interface GeocodingResult {
  latitude: number;
  longitude: number;
  display_name?: string;
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
