-- Lets HR/admin staff reply to or compose a new message directly from an
-- employee's Inbox (/employees/[id]) instead of only viewing automated
-- system emails. Composed messages are still real emails sent via Resend and
-- logged through the existing email_logs pipeline (see lib/email.ts) — these
-- two columns just distinguish a human-composed send from an automated one
-- and link a reply back to the message it answered.

alter table public.email_logs
  add column if not exists sender_user_id uuid references public.users(id) on delete set null,
  add column if not exists in_reply_to_id uuid references public.email_logs(id) on delete set null;

create index if not exists idx_email_logs_in_reply_to_id
  on public.email_logs (in_reply_to_id);

comment on column public.email_logs.sender_user_id is
  'Staff member who composed this email from the Inbox UI (Reply / New Message). Null for automated system emails.';
comment on column public.email_logs.in_reply_to_id is
  'The email_logs row this message replies to, when composed as a reply from the Inbox UI. Null for a fresh message or an automated email.';
