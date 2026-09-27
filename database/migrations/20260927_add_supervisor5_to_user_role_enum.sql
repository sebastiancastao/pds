-- Add supervisor5 (view-only supervisor) to the user_role enum (idempotent).
-- Applied to the live project on 2026-09-27. Write blocking lives in
-- middleware.ts / lib/roles.ts, not in the database.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'supervisor5';
