-- Add San Diego region (idempotent)
INSERT INTO regions (name, description, center_lat, center_lng, radius_miles, is_active)
VALUES (
  'San Diego',
  'Greater San Diego Area including San Diego, Chula Vista, El Cajon, and surrounding communities',
  32.7157,
  -117.1611,
  40.0,
  true
)
ON CONFLICT (name) DO UPDATE
SET
  description = EXCLUDED.description,
  center_lat = EXCLUDED.center_lat,
  center_lng = EXCLUDED.center_lng,
  radius_miles = EXCLUDED.radius_miles,
  is_active = true,
  updated_at = NOW();
