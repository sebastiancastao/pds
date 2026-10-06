-- Add supervisor6 to the user_role enum (idempotent).
-- Applied to the live project on 2026-10-06.
-- supervisor6 = base supervisor visibility, plus: records rest breaks and signs
-- off the timesheet on /event-dashboard, and can delete events on /dashboard.
-- It cannot edit timesheet times anywhere. Permissions live in app code, not here.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'supervisor6';
