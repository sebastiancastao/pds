-- Venue performance data received from venues (attendance, sales, staffing).
-- One row per venue + event date + event name. Entered on /venue-data (form or
-- CSV import) and summarised on /venue-dashboard.
-- Accessed only through the service-role API routes under /api/venue-data
-- (RLS on, no policies), which restrict access to exec/admin users.

create table if not exists public.venue_data_entries (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venue_reference(id) on delete cascade,
  event_date date not null,
  event_name text,
  attendance integer check (attendance is null or attendance >= 0),
  capacity integer check (capacity is null or capacity > 0),
  gross_sales numeric(12, 2) check (gross_sales is null or gross_sales >= 0),
  staff_count integer check (staff_count is null or staff_count >= 0),
  notes text,
  source text not null default 'manual' check (source in ('manual', 'csv')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint venue_data_entries_has_metric check (
    attendance is not null
    or capacity is not null
    or gross_sales is not null
    or staff_count is not null
  )
);

-- Stops the same report from being counted twice (e.g. a CSV uploaded twice).
create unique index if not exists venue_data_entries_unique_event
  on public.venue_data_entries (venue_id, event_date, lower(btrim(coalesce(event_name, ''))));

create index if not exists idx_venue_data_entries_event_date
  on public.venue_data_entries (event_date desc);

create index if not exists idx_venue_data_entries_venue_date
  on public.venue_data_entries (venue_id, event_date desc);

alter table public.venue_data_entries enable row level security;

comment on table public.venue_data_entries is
  'Per-event venue performance data (attendance, capacity, gross sales, staff count) received from venues; feeds /venue-dashboard.';
