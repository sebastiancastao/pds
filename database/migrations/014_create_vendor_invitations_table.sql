-- Create vendor_invitations table to track event invitations sent to vendors
CREATE TABLE IF NOT EXISTS public.vendor_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token TEXT NOT NULL UNIQUE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  availability JSONB, -- Store the vendor's availability response
  notes TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_vendor_invitations_token ON public.vendor_invitations(token);
CREATE INDEX IF NOT EXISTS idx_vendor_invitations_event_id ON public.vendor_invitations(event_id);
CREATE INDEX IF NOT EXISTS idx_vendor_invitations_vendor_id ON public.vendor_invitations(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_invitations_status ON public.vendor_invitations(status);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_vendor_invitations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vendor_invitations_updated_at
  BEFORE UPDATE ON public.vendor_invitations
  FOR EACH ROW
  EXECUTE FUNCTION update_vendor_invitations_updated_at();

-- Add RLS policies
ALTER TABLE public.vendor_invitations ENABLE ROW LEVEL SECURITY;

-- Policy: Admins can view all invitations
CREATE POLICY "Admins can view all vendor invitations"
  ON public.vendor_invitations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Policy: Vendors can view their own invitations
CREATE POLICY "Vendors can view their own invitations"
  ON public.vendor_invitations
  FOR SELECT
  USING (vendor_id = auth.uid());

-- Policy: Admins can create invitations
CREATE POLICY "Admins can create vendor invitations"
  ON public.vendor_invitations
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Policy: Vendors can update their own invitations (respond)
CREATE POLICY "Vendors can update their own invitations"
  ON public.vendor_invitations
  FOR UPDATE
  USING (vendor_id = auth.uid())
  WITH CHECK (vendor_id = auth.uid());

-- Policy: Admins can update all invitations
CREATE POLICY "Admins can update all vendor invitations"
  ON public.vendor_invitations
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

COMMENT ON TABLE public.vendor_invitations IS 'Tracks event invitations sent to vendors with their availability responses';
COMMENT ON COLUMN public.vendor_invitations.token IS 'Unique token for the invitation link';
COMMENT ON COLUMN public.vendor_invitations.availability IS 'JSON object containing the vendor''s availability for the next 21 days';
COMMENT ON COLUMN public.vendor_invitations.status IS 'Invitation status: pending, accepted, declined, or expired';
