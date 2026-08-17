-- The invite-override approval rule changed from a flat 7-day cooldown to a
-- period-based rule: a vendor who already submitted availability for their
-- current invitation period (vendor_invitations.start_date–end_date, ~4
-- months) can't be re-invited until that period ends. This column
-- snapshots that period's end_date so reviewers at /vendor-invite-requests
-- can see when the block naturally lifts, without joining back to
-- vendor_invitations.

ALTER TABLE public.vendor_invite_override_requests
  ADD COLUMN IF NOT EXISTS period_end_at TIMESTAMPTZ;

COMMENT ON COLUMN public.vendor_invite_override_requests.period_end_at IS
  'end_date of the vendor_invitations row (last_invitation_id) that triggered this request — the date the block lifts on its own.';
