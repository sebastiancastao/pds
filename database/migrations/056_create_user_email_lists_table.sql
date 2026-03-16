-- Migration 056: Create user_email_lists table
-- Stores email addresses uploaded by admins and assigned to a specific user

CREATE TABLE IF NOT EXISTS public.user_email_lists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  uploaded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, email)
);

CREATE INDEX idx_user_email_lists_user_id     ON public.user_email_lists(user_id);
CREATE INDEX idx_user_email_lists_uploaded_by ON public.user_email_lists(uploaded_by);

ALTER TABLE public.user_email_lists ENABLE ROW LEVEL SECURITY;

-- Admins and HR can read/write all records
CREATE POLICY "admin_hr_full_access" ON public.user_email_lists
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role IN ('admin', 'exec', 'hr', 'hr_admin', 'manager', 'supervisor')
    )
  );

COMMENT ON TABLE public.user_email_lists IS
  'Email addresses uploaded by admins and assigned to a user account';
