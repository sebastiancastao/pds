-- Add outcome columns to audit_logs so audit filtering can distinguish success/failure.
-- This reconciles the live table with the app code and generated TS types.

ALTER TABLE public.audit_logs
ADD COLUMN IF NOT EXISTS success BOOLEAN,
ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Best-effort historical backfill for older rows created before these columns existed.
UPDATE public.audit_logs
SET success = CASE
  WHEN action ~* '(failed|error|rate_limited|duplicate|inactive_account|locked_account|denied|rejected)'
    THEN FALSE
  ELSE TRUE
END
WHERE success IS NULL;

ALTER TABLE public.audit_logs
ALTER COLUMN success SET DEFAULT TRUE;

ALTER TABLE public.audit_logs
ALTER COLUMN success SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_success_created_at
  ON public.audit_logs(success, created_at DESC);

COMMENT ON COLUMN public.audit_logs.success IS
  'Outcome flag for the audit event. True for success, false for failure.';

COMMENT ON COLUMN public.audit_logs.error_message IS
  'Optional failure detail captured when the audited action did not succeed.';

SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'audit_logs'
  AND column_name IN ('success', 'error_message')
ORDER BY column_name;
