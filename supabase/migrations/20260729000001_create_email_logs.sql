-- Central log of every outbound email the app sends via Resend, one row per
-- "to"/"cc" recipient, linked to the matching public.users account (by email)
-- when one exists. Written from lib/email.ts's sendResendEmail() chokepoint,
-- so every send* helper in that file (temp password, invite, MFA code, event
-- invitations, helpdesk notifications, paystub links, etc.) is covered
-- automatically without touching each call site.
--
-- Intentionally excludes bcc recipients: internal monitoring copies
-- (MONITORING_BCC / EMAIL_GLOBAL_BCC) and admin "blast" audiences sent in
-- bcc-mode aren't meant to populate an individual employee's inbox.
--
-- Powers the "Inbox" section on /employees/[id].

create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),

  -- Recipient this row represents (matched by email against public.users;
  -- null when no account matches the address).
  recipient_user_id uuid references public.users(id) on delete set null,
  recipient_email text not null,
  recipient_type text not null default 'to' check (recipient_type in ('to', 'cc')),

  from_address text not null,
  subject text not null,
  html_body text not null,

  status text not null default 'sent' check (status in ('sent', 'failed')),
  error_message text,
  provider_message_id text,

  created_at timestamptz not null default now()
);

create index if not exists idx_email_logs_recipient_user_id
  on public.email_logs (recipient_user_id, created_at desc);
create index if not exists idx_email_logs_recipient_email
  on public.email_logs (recipient_email);
create index if not exists idx_email_logs_created_at
  on public.email_logs (created_at desc);

alter table public.email_logs enable row level security;

drop policy if exists "HR and admins can read all email logs" on public.email_logs;
create policy "HR and admins can read all email logs"
  on public.email_logs for select
  using (
    exists (
      select 1 from public.users
      where users.id = auth.uid()
        and users.role in ('exec', 'hr', 'manager', 'supervisor', 'supervisor2', 'supervisor3', 'supervisor4')
    )
  );

drop policy if exists "Employees can read their own email logs" on public.email_logs;
create policy "Employees can read their own email logs"
  on public.email_logs for select
  using (recipient_user_id = auth.uid());

drop policy if exists "Service role can manage email logs" on public.email_logs;
create policy "Service role can manage email logs"
  on public.email_logs for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

comment on table public.email_logs is
  'Audit log of outbound app emails (to/cc recipients only), linked to the matching user account. Powers the per-employee Inbox on /employees/[id].';
