-- Timesheet edits made from the event dashboard store the editor's reason on their
-- signature row. A save that changes no time entry (nothing changed, or only
-- deletions) leaves no "Manual edit" note behind, so this is the only place its
-- reason is kept. The event dashboard's "edited by" badge reads it.
ALTER TABLE form_signatures
  ADD COLUMN IF NOT EXISTS edit_reason text;

COMMENT ON COLUMN form_signatures.edit_reason IS
  'Reason given for a timesheet_edit signature (event dashboard timesheet edits). Null for other form types.';
