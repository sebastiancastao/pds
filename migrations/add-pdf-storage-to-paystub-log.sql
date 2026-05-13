-- Run this ONLY if you already ran create-paystub-distribution-log.sql
-- without the pdf_storage_path column and the storage bucket setup.
-- If you are starting fresh, run create-paystub-distribution-log.sql instead.

ALTER TABLE paystub_distribution_log
  ADD COLUMN IF NOT EXISTS pdf_storage_path TEXT;

INSERT INTO storage.buckets (id, name, public)
VALUES ('paystubs', 'paystubs', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY IF NOT EXISTS "Employees can download their own paystubs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'paystubs'
    AND auth.uid()::text = (string_to_array(name, '/'))[1]
  );

CREATE POLICY IF NOT EXISTS "HR and admins can download all paystubs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'paystubs'
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('admin', 'exec', 'hr', 'hr_admin', 'manager', 'supervisor', 'supervisor3')
    )
  );

CREATE POLICY IF NOT EXISTS "Service role can manage paystub files"
  ON storage.objects FOR ALL
  USING (bucket_id = 'paystubs' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'paystubs' AND auth.role() = 'service_role');
