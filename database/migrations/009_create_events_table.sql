create table events (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    artist text,
    artist_share_percent numeric(5,2),
    venue_share_percent numeric(5,2),
    pds_share_percent numeric(5,2),
    venue text not null,
    event_type text not null,
    datetime timestamptz not null,
    tax_bracket_city text,
    tax_bracket_state text,
    created_by uuid references users(id) not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz,
    is_archived boolean default false
);
