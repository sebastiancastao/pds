-- Employee-initiated requests to cancel an already-responded (confirmed/declined)
-- event invitation. Filed from the employee's profile page (/employees/[id]);
-- takes effect only after a privileged reviewer approves it, at which point the
-- underlying event_teams / event_location_assignments row is removed (mirrors
-- the existing "uninvite" effect in app/api/events/[id]/team/[memberId]/route.ts)
-- and the removal is recorded in event_team_uninvites for audit continuity.

CREATE TABLE IF NOT EXISTS public.invitation_cancellation_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('team', 'location')),
  team_member_id UUID REFERENCES public.event_teams(id) ON DELETE SET NULL,
  location_assignment_id UUID REFERENCES public.event_location_assignments(id) ON DELETE SET NULL,
  previous_status TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invitation_cancellation_requests_user_id
  ON public.invitation_cancellation_requests(user_id);

CREATE INDEX IF NOT EXISTS idx_invitation_cancellation_requests_status
  ON public.invitation_cancellation_requests(status);

CREATE INDEX IF NOT EXISTS idx_invitation_cancellation_requests_event_id
  ON public.invitation_cancellation_requests(event_id);

CREATE INDEX IF NOT EXISTS idx_invitation_cancellation_requests_created_at
  ON public.invitation_cancellation_requests(created_at DESC);

-- Only one pending cancellation request may exist per invitation at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitation_cancellation_requests_one_pending
  ON public.invitation_cancellation_requests(source, COALESCE(team_member_id, location_assignment_id))
  WHERE status = 'pending';

ALTER TABLE public.invitation_cancellation_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invitation_cancellation_requests_select_own" ON public.invitation_cancellation_requests;
CREATE POLICY "invitation_cancellation_requests_select_own"
  ON public.invitation_cancellation_requests FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "invitation_cancellation_requests_insert_own" ON public.invitation_cancellation_requests;
CREATE POLICY "invitation_cancellation_requests_insert_own"
  ON public.invitation_cancellation_requests FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Privileged roles can view/insert/update/approve any employee's requests.
-- Mirrors the role set used by data_edition_requests, plus supervisor4/hr which
-- exist in this database's user_role enum.
DROP POLICY IF EXISTS "invitation_cancellation_requests_privileged_all" ON public.invitation_cancellation_requests;
CREATE POLICY "invitation_cancellation_requests_privileged_all"
  ON public.invitation_cancellation_requests FOR ALL
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

CREATE OR REPLACE FUNCTION public.update_invitation_cancellation_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_invitation_cancellation_requests_timestamp ON public.invitation_cancellation_requests;
CREATE TRIGGER update_invitation_cancellation_requests_timestamp
  BEFORE UPDATE ON public.invitation_cancellation_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_invitation_cancellation_requests_updated_at();

COMMENT ON TABLE public.invitation_cancellation_requests IS
  'Employee-filed requests (from /employees/[id]) to cancel an already-responded event invitation; require privileged approval before the invitation is actually removed.';
COMMENT ON COLUMN public.invitation_cancellation_requests.previous_status IS
  'Snapshot of the event_teams.status (confirmed/declined) at the time the cancellation was requested.';
