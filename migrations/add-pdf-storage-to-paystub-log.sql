-- Migration: add pdf_storage_path to paystub_distribution_log
-- Stores the Supabase Storage path so employees can download their paystub.

ALTER TABLE paystub_distribution_log
  ADD COLUMN IF NOT EXISTS pdf_storage_path TEXT;

-- Create the private storage bucket for paystubs (run once; ignored if it already exists)
INSERT INTO storage.buckets (id, name, public)
VALUES ('paystubs', 'paystubs', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: employees can read only their own files (path starts with their user id)
CREATE POLICY "Employees can download their own paystubs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'paystubs'
    AND auth.uid()::text = (string_to_array(name, '/'))[1]
  );

-- HR/admins can read all paystub files
CREATE POLICY "HR and admins can download all paystubs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'paystubs'
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('admin', 'exec', 'hr', 'hr_admin', 'manager', 'supervisor', 'supervisor3')
    )
  );

-- Only service role can insert/delete paystub files
CREATE POLICY "Service role can manage paystub files"
  ON storage.objects FOR ALL
  USING (bucket_id = 'paystubs' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'paystubs' AND auth.role() = 'service_role');
