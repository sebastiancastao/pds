-- Add Las Vegas region (idempotent)
INSERT INTO regions (name, description, center_lat, center_lng, radius_miles, is_active)
VALUES (
  'Las Vegas',
  'Las Vegas Metropolitan Area',
  36.1699,
  -115.1398,
  50.0,
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
