-- Optional explicit IANA timezone per user, overriding the state-derived zone.
-- Used by the event-reminder edge function (resolveUserTimezone): when set, the
-- reminder is computed in this timezone instead of the one mapped from
-- profiles.state. Lets non-US / traveling users (e.g. America/Bogota) get
-- reminders in their real local time. NULL = fall back to the state mapping.

alter table public.profiles add column if not exists timezone text;

comment on column public.profiles.timezone is
  'Optional IANA timezone (e.g. America/Bogota) that overrides the state-derived timezone for reminders/scheduling. NULL = fall back to the state mapping.';

-- Per-user values are data, e.g.:
--   update public.profiles set timezone = 'America/Bogota' where user_id = '<uuid>';
