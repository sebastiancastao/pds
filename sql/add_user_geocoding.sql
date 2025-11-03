-- Add geocoding columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 7);
ALTER TABLE users ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7);
ALTER TABLE users ADD COLUMN IF NOT EXISTS geocoded_address TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMP WITH TIME ZONE;

-- Create indexes for geographic queries
CREATE INDEX IF NOT EXISTS idx_users_latitude ON users(latitude);
CREATE INDEX IF NOT EXISTS idx_users_longitude ON users(longitude);
CREATE INDEX IF NOT EXISTS idx_users_lat_lng ON users(latitude, longitude);

-- Function to calculate distance between two points using Haversine formula
-- Returns distance in miles
CREATE OR REPLACE FUNCTION calculate_distance_miles(
  lat1 NUMERIC,
  lon1 NUMERIC,
  lat2 NUMERIC,
  lon2 NUMERIC
)
RETURNS NUMERIC AS $$
DECLARE
  r NUMERIC := 3959; -- Earth's radius in miles
  dlat NUMERIC;
  dlon NUMERIC;
  a NUMERIC;
  c NUMERIC;
BEGIN
  -- Convert degrees to radians
  dlat := radians(lat2 - lat1);
  dlon := radians(lon2 - lon1);

  -- Haversine formula
  a := sin(dlat/2) * sin(dlat/2) +
       cos(radians(lat1)) * cos(radians(lat2)) *
       sin(dlon/2) * sin(dlon/2);
  c := 2 * atan2(sqrt(a), sqrt(1-a));

  RETURN r * c;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to check if a user is within a region's radius
CREATE OR REPLACE FUNCTION is_user_in_region(
  user_lat NUMERIC,
  user_lon NUMERIC,
  region_center_lat NUMERIC,
  region_center_lon NUMERIC,
  region_radius_miles INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
  distance NUMERIC;
BEGIN
  IF user_lat IS NULL OR user_lon IS NULL OR
     region_center_lat IS NULL OR region_center_lon IS NULL THEN
    RETURN FALSE;
  END IF;

  distance := calculate_distance_miles(user_lat, user_lon, region_center_lat, region_center_lon);
  RETURN distance <= region_radius_miles;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON COLUMN users.latitude IS 'Latitude coordinate from geocoded address';
COMMENT ON COLUMN users.longitude IS 'Longitude coordinate from geocoded address';
COMMENT ON COLUMN users.geocoded_address IS 'The address string that was geocoded';
COMMENT ON COLUMN users.geocoded_at IS 'Timestamp when address was last geocoded';
