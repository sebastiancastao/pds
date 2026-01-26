// PDS Time keeping System - Geofencing Utilities
// Location validation and geofence zone management

/**
 * Geolocation coordinates
 */
export interface Coordinates {
  latitude: number;
  longitude: number;
  accuracy?: number; // GPS accuracy in meters
}

/**
 * Geofence zone definition
 */
export interface GeofenceZone {
  id: string;
  name: string;
  description?: string;
  zoneType: 'circle' | 'polygon';
  
  // Circle zone properties
  centerLatitude?: number;
  centerLongitude?: number;
  radiusMeters?: number;
  
  // Polygon zone properties
  polygonCoordinates?: Coordinates[];
  
  // Settings
  isActive: boolean;
  appliesToRoles: string[];
}

/**
 * Geofence validation result
 */
export interface GeofenceValidation {
  isWithinGeofence: boolean;
  matchedZoneId?: string;
  matchedZoneName?: string;
  distanceMeters?: number;
  errorMessage?: string;
}

/**
 * Browser geolocation options
 * - enableHighAccuracy: Use GPS for precise location
 * - timeout: How long to wait for position (30 seconds)
 * - maximumAge: How old a cached browser position can be (5 minutes)
 *   Note: This is the browser's internal cache, separate from our localStorage cache
 */
const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 30000, // 30 seconds (increased for mobile GPS)
  maximumAge: 300000, // 5 minutes - browser can return cached position within this age
};

/**
 * Get user's current location from browser
 * @returns Promise with coordinates
 */
export const getCurrentLocation = (): Promise<Coordinates> => {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        let errorMessage = 'Failed to get location';
        
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = 'Location permission denied. Please enable location access in your browser settings.';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = 'Location information unavailable. Please try again.';
            break;
          case error.TIMEOUT:
            errorMessage = 'Location request timed out. Please try again.';
            break;
        }
        
        reject(new Error(errorMessage));
      },
      GEOLOCATION_OPTIONS
    );
  });
};

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param lat1 - Latitude of point 1
 * @param lon1 - Longitude of point 1
 * @param lat2 - Latitude of point 2
 * @param lon2 - Longitude of point 2
 * @returns Distance in meters
 */
export const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371000; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
};

/**
 * Check if coordinates are within a circular geofence zone
 * @param coords - User's coordinates
 * @param zone - Geofence zone
 * @returns Validation result
 */
export const checkCircularZone = (
  coords: Coordinates,
  zone: GeofenceZone
): GeofenceValidation => {
  if (
    !zone.centerLatitude ||
    !zone.centerLongitude ||
    !zone.radiusMeters
  ) {
    return {
      isWithinGeofence: false,
      errorMessage: 'Invalid zone configuration',
    };
  }

  const distance = calculateDistance(
    coords.latitude,
    coords.longitude,
    zone.centerLatitude,
    zone.centerLongitude
  );

  const isWithin = distance <= zone.radiusMeters;

  return {
    isWithinGeofence: isWithin,
    matchedZoneId: isWithin ? zone.id : undefined,
    matchedZoneName: isWithin ? zone.name : undefined,
    distanceMeters: Math.round(distance),
  };
};

/**
 * Check if coordinates are within a polygon geofence zone
 * Uses ray casting algorithm
 * @param coords - User's coordinates
 * @param zone - Geofence zone
 * @returns Validation result
 */
export const checkPolygonZone = (
  coords: Coordinates,
  zone: GeofenceZone
): GeofenceValidation => {
  if (!zone.polygonCoordinates || zone.polygonCoordinates.length < 3) {
    return {
      isWithinGeofence: false,
      errorMessage: 'Invalid polygon configuration (need at least 3 points)',
    };
  }

  let isInside = false;
  const polygon = zone.polygonCoordinates;

  // Ray casting algorithm
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].latitude;
    const yi = polygon[i].longitude;
    const xj = polygon[j].latitude;
    const yj = polygon[j].longitude;

    const intersect =
      yi > coords.longitude !== yj > coords.longitude &&
      coords.latitude < ((xj - xi) * (coords.longitude - yi)) / (yj - yi) + xi;

    if (intersect) isInside = !isInside;
  }

  return {
    isWithinGeofence: isInside,
    matchedZoneId: isInside ? zone.id : undefined,
    matchedZoneName: isInside ? zone.name : undefined,
  };
};

/**
 * Validate coordinates against all active geofence zones
 * @param coords - User's coordinates
 * @param zones - Array of geofence zones
 * @param userRole - User's role
 * @returns Validation result
 */
export const validateGeofence = (
  coords: Coordinates,
  zones: GeofenceZone[],
  userRole: string
): GeofenceValidation => {
  // Filter zones that apply to this user's role and are active
  const applicableZones = zones.filter(
    (zone) => zone.isActive && zone.appliesToRoles.includes(userRole)
  );

  if (applicableZones.length === 0) {
    // No geofence restrictions for this role
    return {
      isWithinGeofence: true,
      errorMessage: 'No geofence restrictions apply',
    };
  }

  let minDistance = Infinity;
  let nearestZoneName = '';

  // Check each zone
  for (const zone of applicableZones) {
    let result: GeofenceValidation;

    if (zone.zoneType === 'circle') {
      result = checkCircularZone(coords, zone);
    } else {
      result = checkPolygonZone(coords, zone);
    }

    // If within any zone, allow access
    if (result.isWithinGeofence) {
      return result;
    }

    // Track nearest zone for error message
    if (result.distanceMeters && result.distanceMeters < minDistance) {
      minDistance = result.distanceMeters;
      nearestZoneName = zone.name;
    }
  }

  // Not within any geofence
  return {
    isWithinGeofence: false,
    distanceMeters: minDistance !== Infinity ? Math.round(minDistance) : undefined,
    errorMessage:
      minDistance !== Infinity
        ? `You are ${Math.round(minDistance)}m away from ${nearestZoneName}. Please move closer to an authorized location.`
        : 'You are not within an authorized location.',
  };
};

/**
 * Format distance for display
 * @param meters - Distance in meters
 * @returns Formatted string (e.g., "500m" or "1.2km")
 */
export const formatDistance = (meters: number): string => {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
};

/**
 * Check if browser supports geolocation
 * @returns True if geolocation is supported
 */
export const isGeolocationSupported = (): boolean => {
  return 'geolocation' in navigator;
};

/**
 * Request location permission from user
 * This is a soft check that doesn't trigger the actual permission prompt
 * @returns Promise with permission state
 */
export const checkLocationPermission = async (): Promise<PermissionState | 'unsupported'> => {
  if (!navigator.permissions) {
    return 'unsupported';
  }

  try {
    const result = await navigator.permissions.query({ name: 'geolocation' });
    return result.state;
  } catch (error) {
    console.error('Failed to check location permission:', error);
    return 'unsupported';
  }
};

/**
 * Validate coordinate values
 * @param coords - Coordinates to validate
 * @returns True if valid
 */
export const isValidCoordinates = (coords: Coordinates): boolean => {
  return (
    coords.latitude >= -90 &&
    coords.latitude <= 90 &&
    coords.longitude >= -180 &&
    coords.longitude <= 180 &&
    !isNaN(coords.latitude) &&
    !isNaN(coords.longitude)
  );
};

