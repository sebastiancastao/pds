-- Migration 040: Make check-in codes permanent (no expiration)

-- Set default to "infinity" so codes never expire
ALTER TABLE public.checkin_codes
ALTER COLUMN expires_at SET DEFAULT 'infinity'::timestamptz;

-- Ensure existing rows are permanent
UPDATE public.checkin_codes
SET expires_at = 'infinity'::timestamptz
WHERE expires_at IS NULL OR expires_at < now();

-- Update worker read policy to remove expiration requirement
DROP POLICY IF EXISTS "workers_read_active_codes" ON public.checkin_codes;

CREATE POLICY "workers_read_active_codes" ON public.checkin_codes
  FOR SELECT USING (
    is_active = true
    AND (
      target_user_id IS NULL
      OR target_user_id = auth.uid()
    )
  );

