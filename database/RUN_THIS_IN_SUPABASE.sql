-- ========================================
-- COMPLETE SQL TO RUN IN SUPABASE SQL EDITOR
-- Run this entire file to fix the vendor invitations error
-- ========================================

-- Step 1: Create the vendor_invitations table
CREATE TABLE IF NOT EXISTS public.vendor_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token TEXT NOT NULL UNIQUE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  availability JSONB,
  notes TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Step 2: Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_vendor_invitations_token ON public.vendor_invitations(token);
CREATE INDEX IF NOT EXISTS idx_vendor_invitations_event_id ON public.vendor_invitations(event_id);
CREATE INDEX IF NOT EXISTS idx_vendor_invitations_vendor_id ON public.vendor_invitations(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_invitations_status ON public.vendor_invitations(status);

-- Step 3: Add updated_at trigger
CREATE OR REPLACE FUNCTION update_vendor_invitations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vendor_invitations_updated_at
  BEFORE UPDATE ON public.vendor_invitations
  FOR EACH ROW
  EXECUTE FUNCTION update_vendor_invitations_updated_at();

-- Step 4: Enable RLS
ALTER TABLE public.vendor_invitations ENABLE ROW LEVEL SECURITY;

-- Step 5: Add RLS policies

-- Policy: Admins can view all invitations
CREATE POLICY "Admins can view all vendor invitations"
  ON public.vendor_invitations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Policy: Vendors can view their own invitations
CREATE POLICY "Vendors can view their own invitations"
  ON public.vendor_invitations
  FOR SELECT
  USING (vendor_id = auth.uid());

-- Policy: Admins can create invitations
CREATE POLICY "Admins can create vendor invitations"
  ON public.vendor_invitations
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Policy: Vendors can update their own invitations (respond)
CREATE POLICY "Vendors can update their own invitations"
  ON public.vendor_invitations
  FOR UPDATE
  USING (vendor_id = auth.uid())
  WITH CHECK (vendor_id = auth.uid());

-- Policy: Admins can update all invitations
CREATE POLICY "Admins can update all vendor invitations"
  ON public.vendor_invitations
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Step 6: Add comments
COMMENT ON TABLE public.vendor_invitations IS 'Tracks event invitations sent to vendors with their availability responses';
COMMENT ON COLUMN public.vendor_invitations.token IS 'Unique token for the invitation link';
COMMENT ON COLUMN public.vendor_invitations.availability IS 'JSON object containing the vendor''s availability for the next 21 days';
COMMENT ON COLUMN public.vendor_invitations.status IS 'Invitation status: pending, accepted, declined, or expired';

-- Step 7: Update venue_reference table with all venues and coordinates
-- Update existing venues with corrected coordinates
UPDATE public.venue_reference
SET
  latitude = 33.943813,
  longitude = -118.342621,
  full_address = '3930 W Century Blvd, Inglewood, CA 90303'
WHERE venue_name = 'Intuit Dome';

UPDATE public.venue_reference
SET
  latitude = 33.958073,
  longitude = -118.342270,
  full_address = '3900 W Manchester Blvd, Inglewood, CA 90305'
WHERE venue_name = 'Kia Forum';

UPDATE public.venue_reference
SET
  latitude = 34.0730219,
  longitude = -117.566315,
  full_address = '4000 E Ontario Center Pkwy, Ontario, CA 91764'
WHERE venue_name = 'Toyota Arena';

UPDATE public.venue_reference
SET
  latitude = 32.773880,
  longitude = -117.074844,
  full_address = '5500 Canyon Crest Dr, San Diego, CA 92182'
WHERE venue_name = 'Viejas Arena';

UPDATE public.venue_reference
SET
  latitude = 32.772708,
  longitude = -117.076511,
  full_address = '5500 Campanile Dr, San Diego, CA 92182'
WHERE venue_name = 'CAL COAST SDSU';

UPDATE public.venue_reference
SET
  latitude = 33.1958,
  longitude = -117.3795,
  full_address = '3475 Hero Dr, Oceanside, CA 92056'
WHERE venue_name = 'Frontwave Arena';

UPDATE public.venue_reference
SET
  latitude = 43.045231,
  longitude = -87.917923,
  full_address = '1111 Vel R Phillips Ave, Milwaukee, WI 53203'
WHERE venue_name = 'Fiserv Forum';

UPDATE public.venue_reference
SET
  latitude = 33.5319,
  longitude = -112.2613,
  full_address = '9400 W Maryland Ave, Glendale, AZ 85305'
WHERE venue_name = 'Desert Diamond Arena';

UPDATE public.venue_reference
SET
  latitude = 37.750328,
  longitude = -122.203300,
  full_address = '7000 Coliseum Way, Oakland, CA 94621'
WHERE venue_name = 'Oakland Arena';

UPDATE public.venue_reference
SET
  latitude = 36.8097,
  longitude = -119.7386,
  full_address = '2650 E Shaw Ave, Fresno, CA 93710'
WHERE venue_name = 'SaveMart Center';

UPDATE public.venue_reference
SET
  latitude = 37.751637,
  longitude = -122.201553,
  full_address = '7000 Coliseum Way, Oakland, CA 94621'
WHERE venue_name = 'RingCentral Coliseum';

UPDATE public.venue_reference
SET
  latitude = 34.4181,
  longitude = -119.5621,
  full_address = '3300 Via Real, Carpinteria, CA 93013'
WHERE venue_name = 'Santa Barbara Polo Club';

-- Insert additional venue name variations
INSERT INTO public.venue_reference (venue_name, city, state, full_address, latitude, longitude) VALUES
  ('Intuit Dome', 'Inglewood', 'CA', '3930 W Century Blvd, Inglewood, CA 90303', 33.943813, -118.342621),
  ('Kia Forum', 'Inglewood', 'CA', '3900 W Manchester Blvd, Inglewood, CA 90305', 33.958073, -118.342270),
  ('Toyota Arena', 'Ontario', 'CA', '4000 E Ontario Center Pkwy, Ontario, CA 91764', 34.0730219, -117.566315),
  ('Viejas Arena', 'San Diego', 'CA', '5500 Canyon Crest Dr, San Diego, CA 92182', 32.773880, -117.074844),
  ('Viejas', 'San Diego', 'CA', '5500 Canyon Crest Dr, San Diego, CA 92182', 32.773880, -117.074844),
  ('CAL COAST SDSU', 'San Diego', 'CA', '5500 Campanile Dr, San Diego, CA 92182', 32.772708, -117.076511),
  ('Frontwave Arena', 'Oceanside', 'CA', '3475 Hero Dr, Oceanside, CA 92056', 33.1958, -117.3795),
  ('Frontwave', 'Oceanside', 'CA', '3475 Hero Dr, Oceanside, CA 92056', 33.1958, -117.3795),
  ('Fiserv Forum', 'Milwaukee', 'WI', '1111 Vel R Phillips Ave, Milwaukee, WI 53203', 43.045231, -87.917923),
  ('Fiserv', 'Milwaukee', 'WI', '1111 Vel R Phillips Ave, Milwaukee, WI 53203', 43.045231, -87.917923),
  ('Desert Diamond Arena', 'Glendale', 'AZ', '9400 W Maryland Ave, Glendale, AZ 85305', 33.5319, -112.2613),
  ('Desert Diamond', 'Glendale', 'AZ', '9400 W Maryland Ave, Glendale, AZ 85305', 33.5319, -112.2613),
  ('Oakland Arena', 'Oakland', 'CA', '7000 Coliseum Way, Oakland, CA 94621', 37.750328, -122.203300),
  ('Oakland', 'Oakland', 'CA', '7000 Coliseum Way, Oakland, CA 94621', 37.750328, -122.203300),
  ('SaveMart Center', 'Fresno', 'CA', '2650 E Shaw Ave, Fresno, CA 93710', 36.8097, -119.7386),
  ('Savemart', 'Fresno', 'CA', '2650 E Shaw Ave, Fresno, CA 93710', 36.8097, -119.7386),
  ('SaveMart', 'Fresno', 'CA', '2650 E Shaw Ave, Fresno, CA 93710', 36.8097, -119.7386),
  ('RingCentral Coliseum', 'Oakland', 'CA', '7000 Coliseum Way, Oakland, CA 94621', 37.751637, -122.201553),
  ('Ring Central', 'Oakland', 'CA', '7000 Coliseum Way, Oakland, CA 94621', 37.751637, -122.201553),
  ('Santa Barbara Polo Club', 'Carpinteria', 'CA', '3300 Via Real, Carpinteria, CA 93013', 34.4181, -119.5621),
  ('Santa Barbara Polo club', 'Carpinteria', 'CA', '3300 Via Real, Carpinteria, CA 93013', 34.4181, -119.5621),
  ('Intuit', 'Inglewood', 'CA', '3930 W Century Blvd, Inglewood, CA 90303', 33.943813, -118.342621),
  ('Toyota', 'Ontario', 'CA', '4000 E Ontario Center Pkwy, Ontario, CA 91764', 34.0730219, -117.566315)
ON CONFLICT (venue_name) DO UPDATE SET
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  full_address = EXCLUDED.full_address,
  city = EXCLUDED.city,
  state = EXCLUDED.state;

-- Step 8: Create additional index for venue coordinates
CREATE INDEX IF NOT EXISTS idx_venue_reference_coordinates ON public.venue_reference(latitude, longitude);

-- ========================================
-- DONE! The vendor_invitations table is now created and ready to use.
-- The venue_reference table has been updated with all venues and coordinates.
-- ========================================
