-- Migration 039: Add per-user targeting to check-in codes
-- Enables generating unique codes per user (prevents sharing)

ALTER TABLE public.checkin_codes
ADD COLUMN IF NOT EXISTS target_user_id UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_checkin_codes_target_user_id
  ON public.checkin_codes(target_user_id);

-- Update worker read policy to avoid exposing other users' personal codes
DROP POLICY IF EXISTS "workers_read_active_codes" ON public.checkin_codes;

CREATE POLICY "workers_read_active_codes" ON public.checkin_codes
  FOR SELECT USING (
    is_active = true
    AND expires_at > now()
    AND (
      target_user_id IS NULL
      OR target_user_id = auth.uid()
    )
  );

