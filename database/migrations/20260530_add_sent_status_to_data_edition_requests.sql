ALTER TABLE data_edition_requests
  DROP CONSTRAINT IF EXISTS data_edition_requests_status_check;

ALTER TABLE data_edition_requests
  ADD CONSTRAINT data_edition_requests_status_check
  CHECK (status IN ('pending', 'sent', 'approved', 'rejected'));
