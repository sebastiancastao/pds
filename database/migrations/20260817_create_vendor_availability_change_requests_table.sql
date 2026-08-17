-- Vendor-initiated (or admin-on-behalf) requests to correct their already-
-- submitted availability answer for one or more specific dates, filed from
-- the "Personal Calendar" on /employees/[id]. Takes effect only after a
-- privileged reviewer approves it via PATCH, at which point each date's
-- corrected value is written to vendor_availability_corrections (see that
-- migration) — mirrors the "blocked action -> approval -> effect" shape of
-- invitation_cancellation_requests and vendor_invite_override_requests.

CREATE TABLE IF NOT EXISTS public.vendor_availability_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- [{date: 'YYYY-MM-DD', current_available: boolean|null, requested_available: boolean}]
  date_changes JSONB NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approval_notification_sent BOOLEAN,
  approval_notification_error TEXT,
  outcome_notification_sent BOOLEAN,
  outcome_notification_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_vendor_availability_change_requests_vendor_id
  ON public.vendor_availability_change_requests(vendor_id);

CREATE INDEX IF NOT EXISTS idx_vendor_availability_change_requests_status
  ON public.vendor_availability_change_requests(status);

CREATE INDEX IF NOT EXISTS idx_vendor_availability_change_requests_created_at
  ON public.vendor_availability_change_requests(created_at DESC);

-- Only one pending change request may exist per vendor at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_availability_change_requests_one_pending
  ON public.vendor_availability_change_requests(vendor_id)
  WHERE status = 'pending';

ALTER TABLE public.vendor_availability_change_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendor_availability_change_requests_select_own" ON public.vendor_availability_change_requests;
CREATE POLICY "vendor_availability_change_requests_select_own"
  ON public.vendor_availability_change_requests FOR SELECT
  USING (vendor_id = auth.uid());

DROP POLICY IF EXISTS "vendor_availability_change_requests_insert_own" ON public.vendor_availability_change_requests;
CREATE POLICY "vendor_availability_change_requests_insert_own"
  ON public.vendor_availability_change_requests FOR INSERT
  WITH CHECK (vendor_id = auth.uid());

-- Privileged roles can view/insert/update/approve any vendor's requests.
-- Mirrors the role set used by invitation_cancellation_requests. Note:
-- public.users.role is the `user_role` enum, which has no 'admin' label —
-- an IN-list literal that isn't a valid enum label errors at query time, so
-- it's intentionally omitted here (see vendor_invite_override_requests).
DROP POLICY IF EXISTS "vendor_availability_change_requests_privileged_all" ON public.vendor_availability_change_requests;
CREATE POLICY "vendor_availability_change_requests_privileged_all"
  ON public.vendor_availability_change_requests FOR ALL
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

CREATE OR REPLACE FUNCTION public.update_vendor_availability_change_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_vendor_availability_change_requests_timestamp ON public.vendor_availability_change_requests;
CREATE TRIGGER update_vendor_availability_change_requests_timestamp
  BEFORE UPDATE ON public.vendor_availability_change_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_vendor_availability_change_requests_updated_at();

COMMENT ON TABLE public.vendor_availability_change_requests IS
  'Vendor-filed requests (from /employees/[id]) to correct their submitted availability for specific dates; require privileged approval before vendor_availability_corrections is updated.';
