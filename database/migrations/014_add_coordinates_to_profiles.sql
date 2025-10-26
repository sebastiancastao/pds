-- Add latitude and longitude to profiles table for distance calculations

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8);

-- Create index for geospatial queries
CREATE INDEX IF NOT EXISTS idx_profiles_coordinates ON public.profiles(latitude, longitude);

COMMENT ON COLUMN public.profiles.latitude IS 'Latitude coordinate for vendor location (for distance calculations)';
COMMENT ON COLUMN public.profiles.longitude IS 'Longitude coordinate for vendor location (for distance calculations)';
