-- Manually-corrected availability answers, applied once a
-- vendor_availability_change_requests row is approved. Consulted by
-- lib/vendorAvailability.ts's getMergedVendorAvailability() as the
-- highest-priority layer for its date — it always wins over whatever the
-- vendor's raw vendor_invitations submissions say for that same date, since
-- it represents an explicitly reviewed and approved correction. Kept as its
-- own table (rather than mutating vendor_invitations.availability JSONB in
-- place) so the original submission history stays intact for audit.

CREATE TABLE IF NOT EXISTS public.vendor_availability_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  available BOOLEAN NOT NULL,
  notes TEXT,
  change_request_id UUID REFERENCES public.vendor_availability_change_requests(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vendor_id, date)
);

CREATE INDEX IF NOT EXISTS idx_vendor_availability_corrections_vendor_id
  ON public.vendor_availability_corrections(vendor_id);

ALTER TABLE public.vendor_availability_corrections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendor_availability_corrections_select_own" ON public.vendor_availability_corrections;
CREATE POLICY "vendor_availability_corrections_select_own"
  ON public.vendor_availability_corrections FOR SELECT
  USING (vendor_id = auth.uid());

-- Written only by the service role from PATCH /api/vendor-availability-change-requests
-- once a request is approved — no client ever inserts/updates this table directly.
DROP POLICY IF EXISTS "vendor_availability_corrections_privileged_all" ON public.vendor_availability_corrections;
CREATE POLICY "vendor_availability_corrections_privileged_all"
  ON public.vendor_availability_corrections FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role IN ('exec', 'hr', 'manager', 'supervisor', 'supervisor2', 'supervisor3', 'supervisor4', 'finance')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role IN ('exec', 'hr', 'manager', 'supervisor', 'supervisor2', 'supervisor3', 'supervisor4', 'finance')
    )
  );

CREATE OR REPLACE FUNCTION public.update_vendor_availability_corrections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_vendor_availability_corrections_timestamp ON public.vendor_availability_corrections;
CREATE TRIGGER update_vendor_availability_corrections_timestamp
  BEFORE UPDATE ON public.vendor_availability_corrections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_vendor_availability_corrections_updated_at();

COMMENT ON TABLE public.vendor_availability_corrections IS
  'Approved per-date availability corrections; takes precedence over vendor_invitations-derived availability for the same vendor+date.';
