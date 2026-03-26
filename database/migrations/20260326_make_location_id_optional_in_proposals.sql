-- Make location_id optional in vendor_location_proposals
-- so proposals can be submitted from team modals without selecting a location.

ALTER TABLE public.vendor_location_proposals
  ALTER COLUMN location_id DROP NOT NULL;

-- Drop and recreate the partial unique index to handle NULLs correctly.
-- (NULL != NULL in SQL, so a NULL location_id would never conflict anyway,
--  but we still want to prevent duplicate pending proposals for the same
--  event+vendor when no location is specified.)
DROP INDEX IF EXISTS public.idx_vlp_pending_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vlp_pending_unique_with_location
  ON public.vendor_location_proposals(event_id, location_id, vendor_id)
  WHERE status = 'pending' AND location_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vlp_pending_unique_no_location
  ON public.vendor_location_proposals(event_id, vendor_id)
  WHERE status = 'pending' AND location_id IS NULL;
