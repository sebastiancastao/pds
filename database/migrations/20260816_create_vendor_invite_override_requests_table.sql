-- Admin-initiated requests to send a vendor a calendar-availability invite
-- (vendor_invitations row) even though that vendor was already invited
-- within the cooldown window (see VENDOR_INVITE_COOLDOWN_DAYS in
-- lib/vendorInvites.ts — currently 7 days). Filed from the "Send Invites"
-- modal on /global-calendar and /dashboard when one or more selected
-- vendors are blocked by the cooldown; takes effect only after a privileged
-- reviewer approves it, at which point the invite is actually sent (mirrors
-- the "blocked action -> approval -> effect" shape of
-- invitation_cancellation_requests).

CREATE TABLE IF NOT EXISTS public.vendor_invite_override_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  last_invitation_id UUID REFERENCES public.vendor_invitations(id) ON DELETE SET NULL,
  last_invited_at TIMESTAMPTZ,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  sent_invitation_id UUID REFERENCES public.vendor_invitations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approval_notification_sent BOOLEAN,
  approval_notification_error TEXT,
  outcome_notification_sent BOOLEAN,
  outcome_notification_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_vendor_invite_override_requests_vendor_id
  ON public.vendor_invite_override_requests(vendor_id);

CREATE INDEX IF NOT EXISTS idx_vendor_invite_override_requests_status
  ON public.vendor_invite_override_requests(status);

CREATE INDEX IF NOT EXISTS idx_vendor_invite_override_requests_created_at
  ON public.vendor_invite_override_requests(created_at DESC);

-- Only one pending override request may exist per vendor at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_invite_override_requests_one_pending
  ON public.vendor_invite_override_requests(vendor_id)
  WHERE status = 'pending';

ALTER TABLE public.vendor_invite_override_requests ENABLE ROW LEVEL SECURITY;

-- This is an internal admin-to-admin workflow (the vendor being invited is
-- never the caller), so unlike invitation_cancellation_requests there is no
-- "own row" self-service policy — only privileged roles touch this table.
-- Mirrors the role set used by invitation_cancellation_requests. Note:
-- public.users.role is the `user_role` enum, which has no 'admin' label
-- (only exec/hr/manager/supervisor*/finance/employee/worker/backgroundchecker)
-- even though some app-level role checks (e.g. /global-calendar) also allow
-- 'admin' — an IN-list literal that isn't a valid enum label errors at
-- query time, so it's intentionally omitted here; the API route's own
-- PRIVILEGED_ROLES check (which runs against a plain string, not this enum)
-- still includes it for consistency with that app-level convention.
DROP POLICY IF EXISTS "vendor_invite_override_requests_privileged_all" ON public.vendor_invite_override_requests;
CREATE POLICY "vendor_invite_override_requests_privileged_all"
  ON public.vendor_invite_override_requests FOR ALL
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

CREATE OR REPLACE FUNCTION public.update_vendor_invite_override_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_vendor_invite_override_requests_timestamp ON public.vendor_invite_override_requests;
CREATE TRIGGER update_vendor_invite_override_requests_timestamp
  BEFORE UPDATE ON public.vendor_invite_override_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_vendor_invite_override_requests_updated_at();

COMMENT ON TABLE public.vendor_invite_override_requests IS
  'Admin-filed requests (from /global-calendar or /dashboard) to re-invite a vendor within the invite cooldown window; require privileged approval before the invitation is actually sent.';
COMMENT ON COLUMN public.vendor_invite_override_requests.last_invitation_id IS
  'The vendor_invitations row that triggered the cooldown block, snapshotted at request time.';
COMMENT ON COLUMN public.vendor_invite_override_requests.sent_invitation_id IS
  'The vendor_invitations row created when this request was approved and the invite actually sent.';
