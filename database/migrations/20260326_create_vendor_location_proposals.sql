-- Migration: create vendor_location_proposals table
-- Purpose: store proposals to invite out-of-venue vendors to event locations

CREATE TABLE IF NOT EXISTS public.vendor_location_proposals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.event_locations(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  proposed_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vlp_status
  ON public.vendor_location_proposals(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vlp_event
  ON public.vendor_location_proposals(event_id);

CREATE INDEX IF NOT EXISTS idx_vlp_vendor
  ON public.vendor_location_proposals(vendor_id);

-- Allow re-submission after a prior approval/decline while still blocking duplicate
-- pending requests for the same vendor/location/event.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vlp_pending_unique
  ON public.vendor_location_proposals(event_id, location_id, vendor_id)
  WHERE status = 'pending';

ALTER TABLE public.vendor_location_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "exec_admin_manager_can_view_proposals" ON public.vendor_location_proposals;
CREATE POLICY "exec_admin_manager_can_view_proposals"
  ON public.vendor_location_proposals
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('exec', 'admin', 'manager', 'supervisor', 'supervisor2', 'supervisor3')
    )
  );

DROP POLICY IF EXISTS "authenticated_can_insert_proposals" ON public.vendor_location_proposals;
CREATE POLICY "authenticated_can_insert_proposals"
  ON public.vendor_location_proposals
  FOR INSERT
  WITH CHECK (auth.uid() = proposed_by);

DROP POLICY IF EXISTS "exec_admin_can_update_proposals" ON public.vendor_location_proposals;
CREATE POLICY "exec_admin_can_update_proposals"
  ON public.vendor_location_proposals
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('exec', 'admin')
    )
  );

DROP TRIGGER IF EXISTS update_vendor_location_proposals_updated_at ON public.vendor_location_proposals;
CREATE TRIGGER update_vendor_location_proposals_updated_at
  BEFORE UPDATE ON public.vendor_location_proposals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
