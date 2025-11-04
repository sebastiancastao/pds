-- Create table to persist per-event merchandise breakdown
create table if not exists public.event_merchandise (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,

  -- Apparel
  apparel_gross numeric(12,2) default 0,
  apparel_tax_rate numeric(5,2) default 0,        -- percent 0-100
  apparel_cc_fee_rate numeric(5,2) default 0,     -- percent 0-100
  apparel_artist_percent numeric(5,2) default 0,  -- percent 0-100

  -- Other
  other_gross numeric(12,2) default 0,
  other_tax_rate numeric(5,2) default 0,
  other_cc_fee_rate numeric(5,2) default 0,
  other_artist_percent numeric(5,2) default 0,

  -- Music
  music_gross numeric(12,2) default 0,
  music_tax_rate numeric(5,2) default 0,
  music_cc_fee_rate numeric(5,2) default 0,
  music_artist_percent numeric(5,2) default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(event_id)
);

-- Helpful index
create index if not exists idx_event_merchandise_event_id on public.event_merchandise(event_id);

-- Enable RLS and allow event owners and admin/exec to access
alter table public.event_merchandise enable row level security;

do $$ begin
  create policy event_merch_select on public.event_merchandise
    for select
    using (
      exists (
        select 1 from public.events e
        where e.id = event_id
          and (
            e.created_by = auth.uid() or
            exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('exec','finance','manager'))
          )
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy event_merch_upsert on public.event_merchandise
    for insert with check (
      exists (
        select 1 from public.events e
        where e.id = event_id
          and (
            e.created_by = auth.uid() or
            exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('exec','finance','manager'))
          )
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy event_merch_update on public.event_merchandise
    for update using (
      exists (
        select 1 from public.events e
        where e.id = event_id
          and (
            e.created_by = auth.uid() or
            exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('exec','finance','manager'))
          )
      )
    );
exception when duplicate_object then null; end $$;

-- Updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_event_merchandise_updated_at on public.event_merchandise;
create trigger trg_event_merchandise_updated_at
before update on public.event_merchandise
for each row execute function public.set_updated_at();


