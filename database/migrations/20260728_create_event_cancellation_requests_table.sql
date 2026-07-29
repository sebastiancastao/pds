-- Records cancellations of confirmed team members for an event.
-- Keeps a formal, permanent record and drives the room-manager notification email.

CREATE TABLE IF NOT EXISTS public.event_cancellation_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  team_member_id UUID REFERENCES public.event_teams(id) ON DELETE SET NULL,
  vendor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  cancellation_date DATE NOT NULL,
  reason TEXT NOT NULL,
  requested_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  room_manager_emails TEXT[] NOT NULL DEFAULT '{}',
  notification_sent BOOLEAN NOT NULL DEFAULT false,
  notification_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_cancellation_requests_event_id
  ON public.event_cancellation_requests(event_id);

CREATE INDEX IF NOT EXISTS idx_event_cancellation_requests_team_member_id
  ON public.event_cancellation_requests(team_member_id);

CREATE INDEX IF NOT EXISTS idx_event_cancellation_requests_vendor_id
  ON public.event_cancellation_requests(vendor_id);

CREATE INDEX IF NOT EXISTS idx_event_cancellation_requests_created_at
  ON public.event_cancellation_requests(created_at DESC);

ALTER TABLE public.event_cancellation_requests ENABLE ROW LEVEL SECURITY;

-- Service role (used by the API routes) bypasses RLS. These policies cover
-- any direct client access from exec/manager/supervisor roles.
-- NOTE: 'admin' is intentionally omitted — it is not a valid value of the
-- public.user_role enum in this database (checked via pg_enum).
CREATE POLICY "event_cancellation_requests_select" ON public.event_cancellation_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role IN ('exec', 'manager', 'supervisor', 'supervisor2', 'supervisor3')
    )
  );

CREATE POLICY "event_cancellation_requests_insert" ON public.event_cancellation_requests
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role IN ('exec', 'manager', 'supervisor', 'supervisor2', 'supervisor3')
    )
  );

COMMENT ON TABLE public.event_cancellation_requests IS
  'Formal record of cancellations by confirmed team members; drives the room-manager notification email.';
COMMENT ON COLUMN public.event_cancellation_requests.cancellation_date IS
  'Date the team member cancelled for (may differ from the day the request was filed).';
COMMENT ON COLUMN public.event_cancellation_requests.room_manager_emails IS
  'Snapshot of the venue room manager email(s) the notification was sent to at the time of filing.';
