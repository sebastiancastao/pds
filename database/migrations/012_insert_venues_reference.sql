-- Insert common venues with their city and state information
-- This is a reference table to help standardize venue names and locations

-- Create a venues reference table (optional, for future use)
CREATE TABLE IF NOT EXISTS public.venue_reference (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  venue_name TEXT NOT NULL UNIQUE,
  city TEXT NOT NULL,
  state CHAR(2) NOT NULL,
  full_address TEXT,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert all venues with standardized names, locations, and coordinates
INSERT INTO public.venue_reference (venue_name, city, state, full_address, latitude, longitude) VALUES
  ('Kia Forum', 'Inglewood', 'CA', '3900 W Manchester Blvd, Inglewood, CA 90305', 33.9581, -118.3417),
  ('Intuit Dome', 'Inglewood', 'CA', '3930 W Century Blvd, Inglewood, CA 90303', 33.9581, -118.3417),
  ('Toyota Arena', 'Ontario', 'CA', '4000 E Ontario Center Pkwy, Ontario, CA 91764', 34.0636, -117.5629),
  ('Viejas Arena', 'San Diego', 'CA', '5500 Canyon Crest Dr, San Diego, CA 92182', 32.7757, -117.0719),
  ('CAL COAST SDSU', 'San Diego', 'CA', '5500 Campanile Dr, San Diego, CA 92182', 32.7757, -117.0719),
  ('Frontwave Arena', 'Oceanside', 'CA', '300 The Strand N, Oceanside, CA 92054', 33.1958, -117.3795),
  ('Fiserv Forum', 'Milwaukee', 'WI', '1111 Vel R Phillips Ave, Milwaukee, WI 53203', 43.0451, -87.9172),
  ('Desert Diamond Arena', 'Glendale', 'AZ', '9400 W Maryland Ave, Glendale, AZ 85305', 33.5319, -112.2613),
  ('Oakland Arena', 'Oakland', 'CA', '7000 Coliseum Way, Oakland, CA 94621', 37.7502, -122.2008),
  ('SaveMart Center', 'Fresno', 'CA', '2650 E Shaw Ave, Fresno, CA 93710', 36.7378, -119.7871),
  ('RingCentral Coliseum', 'Oakland', 'CA', '7000 Coliseum Way, Oakland, CA 94621', 37.7516, -122.2005),
  ('Santa Barbara Polo Club', 'Carpinteria', 'CA', '3375 Foothill Rd, Carpinteria, CA 93013', 34.3987, -119.5185)
ON CONFLICT (venue_name) DO NOTHING;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_venue_reference_name ON public.venue_reference(venue_name);
CREATE INDEX IF NOT EXISTS idx_venue_reference_location ON public.venue_reference(city, state);

COMMENT ON TABLE public.venue_reference IS 'Reference table for standardized venue names and locations';
