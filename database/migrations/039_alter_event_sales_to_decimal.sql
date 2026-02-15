-- Migration: Change ticket_sales, tips, and tax_rate_percent columns to DECIMAL
-- to allow decimal values (e.g., $0.50)

ALTER TABLE public.events
  ALTER COLUMN ticket_sales TYPE DECIMAL(12, 2) USING ticket_sales::DECIMAL(12, 2);

-- If tips column exists on events, alter it too
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'tips'
  ) THEN
    EXECUTE 'ALTER TABLE public.events ALTER COLUMN tips TYPE DECIMAL(12, 2) USING tips::DECIMAL(12, 2)';
  END IF;
END $$;
