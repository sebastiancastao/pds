-- Proposed timesheet times attached to an edit request.
--
-- Shape: { "workDate": "YYYY-MM-DD" | null,
--          "requested": { firstIn, firstMealStart, lastMealEnd, secondMealStart, secondMealEnd, lastOut },
--          "previous":  same keys, or null }
-- Every time is "HH:MM" (24 hour, event local time) or an empty string.
-- NULL means the request only carries a written reason.
ALTER TABLE timesheet_edit_requests
  ADD COLUMN IF NOT EXISTS requested_changes JSONB NULL;

COMMENT ON COLUMN timesheet_edit_requests.requested_changes IS
  'Proposed clock in, meal and clock out times the requester wants on the timesheet, plus the times recorded when the request was filed.';
