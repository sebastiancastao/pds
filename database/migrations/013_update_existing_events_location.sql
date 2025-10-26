-- Update existing events with city and state based on their venue names
-- This script maps venue names to their correct locations

-- Update Kia Forum events (case insensitive)
UPDATE public.events
SET city = 'Inglewood', state = 'CA'
WHERE LOWER(TRIM(venue)) = 'kia forum' AND (city IS NULL OR state IS NULL);

-- Update Intuit Dome events
UPDATE public.events
SET city = 'Inglewood', state = 'CA'
WHERE LOWER(TRIM(venue)) = 'intuit' AND (city IS NULL OR state IS NULL);

-- Update Toyota Arena events
UPDATE public.events
SET city = 'Ontario', state = 'CA'
WHERE LOWER(TRIM(venue)) = 'toyota' AND (city IS NULL OR state IS NULL);

-- Update Viejas Arena events
UPDATE public.events
SET city = 'San Diego', state = 'CA'
WHERE LOWER(TRIM(venue)) = 'viejas' AND (city IS NULL OR state IS NULL);

-- Update CAL COAST SDSU events
UPDATE public.events
SET city = 'San Diego', state = 'CA'
WHERE LOWER(TRIM(venue)) = 'cal coast sdsu' AND (city IS NULL OR state IS NULL);

-- Update Frontwave Arena events (with space variations)
UPDATE public.events
SET city = 'Oceanside', state = 'CA'
WHERE LOWER(TRIM(venue)) IN ('frontwave', 'frontwave ') AND (city IS NULL OR state IS NULL);

-- Update Fiserv Forum events
UPDATE public.events
SET city = 'Milwaukee', state = 'WI'
WHERE LOWER(TRIM(venue)) = 'fiserv' AND (city IS NULL OR state IS NULL);

-- Update Desert Diamond Arena events (with space variations)
UPDATE public.events
SET city = 'Glendale', state = 'AZ'
WHERE LOWER(TRIM(venue)) IN ('desert diamond', ' desert diamond') AND (city IS NULL OR state IS NULL);

-- Update Oakland Arena events
UPDATE public.events
SET city = 'Oakland', state = 'CA'
WHERE LOWER(TRIM(venue)) = 'oakland' AND (city IS NULL OR state IS NULL);

-- Update SaveMart Center events (case insensitive)
UPDATE public.events
SET city = 'Fresno', state = 'CA'
WHERE LOWER(TRIM(venue)) = 'savemart' AND (city IS NULL OR state IS NULL);

-- Update RingCentral Coliseum events (with space variations)
UPDATE public.events
SET city = 'Oakland', state = 'CA'
WHERE LOWER(TRIM(venue)) IN ('ring central', 'ring central ') AND (city IS NULL OR state IS NULL);

-- Update Santa Barbara Polo Club events
UPDATE public.events
SET city = 'Carpinteria', state = 'CA'
WHERE LOWER(TRIM(venue)) = 'santa barbara polo club' AND (city IS NULL OR state IS NULL);

-- Display summary of updates
DO $$
DECLARE
  total_events INTEGER;
  updated_events INTEGER;
  missing_location INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_events FROM public.events;
  SELECT COUNT(*) INTO updated_events FROM public.events WHERE city IS NOT NULL AND state IS NOT NULL;
  SELECT COUNT(*) INTO missing_location FROM public.events WHERE city IS NULL OR state IS NULL;

  RAISE NOTICE 'Event Location Update Summary:';
  RAISE NOTICE '  Total events: %', total_events;
  RAISE NOTICE '  Events with location: %', updated_events;
  RAISE NOTICE '  Events missing location: %', missing_location;
END $$;
