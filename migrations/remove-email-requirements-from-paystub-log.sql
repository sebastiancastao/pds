-- Migration: remove email requirements from paystub_distribution_log
-- Keeps legacy data, but allows profile-only paystub distribution.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'paystub_distribution_log'
      AND column_name = 'recipient_email'
  ) THEN
    ALTER TABLE public.paystub_distribution_log
      ALTER COLUMN recipient_email DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'paystub_distribution_log'
      AND column_name = 'email_message_id'
  ) THEN
    ALTER TABLE public.paystub_distribution_log
      DROP COLUMN email_message_id;
  END IF;
END $$;
