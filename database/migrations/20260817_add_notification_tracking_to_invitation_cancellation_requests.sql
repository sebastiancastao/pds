-- Tracks whether the two emails sent by app/api/invitation-cancellation-requests
-- actually went out, so a failed send (e.g. a transient Resend error) is visible
-- via a DB query instead of only a server console.error that nobody sees.
--
-- Two separate pairs of columns because this table has two distinct notification
-- events: the "awaiting approval" email (sent to reviewers on POST) and the
-- outcome email (sent to the employee on PATCH approve/reject).

ALTER TABLE public.invitation_cancellation_requests
  ADD COLUMN IF NOT EXISTS approval_notification_sent BOOLEAN,
  ADD COLUMN IF NOT EXISTS approval_notification_error TEXT,
  ADD COLUMN IF NOT EXISTS outcome_notification_sent BOOLEAN,
  ADD COLUMN IF NOT EXISTS outcome_notification_error TEXT;

COMMENT ON COLUMN public.invitation_cancellation_requests.approval_notification_sent IS
  'Whether the "awaiting approval" email to reviewers (jenvillar@1pds.net, sebastiancastao379@gmail.com) sent successfully when this request was filed.';
COMMENT ON COLUMN public.invitation_cancellation_requests.outcome_notification_sent IS
  'Whether the approve/reject outcome email to the employee sent successfully when this request was reviewed.';
