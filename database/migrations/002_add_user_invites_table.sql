-- User Invites System - No Service Role Key Required!
-- This table stores invite links instead of creating accounts directly

CREATE TABLE IF NOT EXISTS public.user_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  role user_role NOT NULL,
  division division_type NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  state CHAR(2) NOT NULL,
  invite_token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  created_by UUID, -- Admin user who sent the invite
  CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- Indexes for performance
CREATE INDEX idx_user_invites_email ON public.user_invites(email);
CREATE INDEX idx_user_invites_token ON public.user_invites(invite_token);
CREATE INDEX idx_user_invites_status ON public.user_invites(status);
CREATE INDEX idx_user_invites_expires ON public.user_invites(expires_at);

-- Function to auto-expire invites
CREATE OR REPLACE FUNCTION expire_old_invites()
RETURNS void AS $$
BEGIN
  UPDATE public.user_invites
  SET status = 'expired'
  WHERE status = 'pending'
    AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Optional: Create a scheduled job to run this daily
-- (Requires pg_cron extension)
-- SELECT cron.schedule('expire-invites', '0 0 * * *', 'SELECT expire_old_invites()');

COMMENT ON TABLE public.user_invites IS 'User invites for secure onboarding without admin password creation';
COMMENT ON COLUMN public.user_invites.invite_token IS 'Cryptographically secure token for invite link';
COMMENT ON COLUMN public.user_invites.status IS 'pending = not yet used, accepted = user completed signup, expired = past expiration date';



