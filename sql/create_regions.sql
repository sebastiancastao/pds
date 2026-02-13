-- Create regions table if it doesn't exist
CREATE TABLE IF NOT EXISTS regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  center_lat NUMERIC(10, 7),
  center_lng NUMERIC(10, 7),
  radius_miles INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert the metro regions with geographic coordinates
INSERT INTO regions (name, description, center_lat, center_lng, radius_miles) VALUES
  ('LA Metro', 'Los Angeles Metropolitan Area', 34.0522, -118.2437, 75),
  ('Las Vegas', 'Las Vegas Metropolitan Area', 36.1699, -115.1398, 50),
  ('Phoenix Metro', 'Phoenix Metropolitan Area', 33.4484, -112.0740, 50),
  ('SF Metro', 'San Francisco Bay Area', 37.7749, -122.4194, 60),
  ('NY Metro', 'New York Metropolitan Area', 40.7128, -74.0060, 60),
  ('Wisconsin', 'Wisconsin State', 44.5000, -89.5000, 150)
ON CONFLICT (name) DO NOTHING;

-- Add region_id column to users table if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'region_id'
  ) THEN
    ALTER TABLE users ADD COLUMN region_id UUID REFERENCES regions(id);
  END IF;
END $$;

-- Create index on region_id for faster queries
CREATE INDEX IF NOT EXISTS idx_users_region_id ON users(region_id);

-- Display the created regions
SELECT * FROM regions ORDER BY name;
