-- Repair migration for early vendor_location_proposals versions that pointed to
-- auth.users or used a global UNIQUE constraint.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = 'vendor_location_proposals'
  ) THEN
    ALTER TABLE public.vendor_location_proposals
      DROP CONSTRAINT IF EXISTS vendor_location_proposals_event_id_fkey,
      DROP CONSTRAINT IF EXISTS vendor_location_proposals_location_id_fkey,
      DROP CONSTRAINT IF EXISTS vendor_location_proposals_vendor_id_fkey,
      DROP CONSTRAINT IF EXISTS vendor_location_proposals_proposed_by_fkey,
      DROP CONSTRAINT IF EXISTS vendor_location_proposals_reviewed_by_fkey,
      DROP CONSTRAINT IF EXISTS vendor_location_proposals_event_id_location_id_vendor_id_key;

    ALTER TABLE public.vendor_location_proposals
      ADD CONSTRAINT vendor_location_proposals_event_id_fkey
        FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE,
      ADD CONSTRAINT vendor_location_proposals_location_id_fkey
        FOREIGN KEY (location_id) REFERENCES public.event_locations(id) ON DELETE CASCADE,
      ADD CONSTRAINT vendor_location_proposals_vendor_id_fkey
        FOREIGN KEY (vendor_id) REFERENCES public.users(id) ON DELETE CASCADE,
      ADD CONSTRAINT vendor_location_proposals_proposed_by_fkey
        FOREIGN KEY (proposed_by) REFERENCES public.users(id) ON DELETE CASCADE,
      ADD CONSTRAINT vendor_location_proposals_reviewed_by_fkey
        FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

DROP INDEX IF EXISTS public.idx_vlp_pending_unique;
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
