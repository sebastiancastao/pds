-- Adds read tracking to public.email_logs so the "Inbox" on /employees/[id]
-- can show a "Read" chip once someone (the employee or an HR/admin viewer)
-- opens an email.

alter table public.email_logs
  add column if not exists read_at timestamptz,
  add column if not exists read_by uuid references public.users(id) on delete set null;

create index if not exists idx_email_logs_read_at
  on public.email_logs (read_at);

comment on column public.email_logs.read_at is
  'When this email was first opened in the Inbox UI. Null = unread.';
comment on column public.email_logs.read_by is
  'User who first opened/read this email.';
