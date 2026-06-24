-- Enforce that no two ACTIVE check-in codes can share the same `code` value.
--
-- Why: the kiosk resolves a typed code with
--   .from("checkin_codes").eq("code", code).eq("is_active", true).single()
-- in validate / action / sync. PostgREST `.single()` returns NO row when more
-- than one matches, so a duplicate active code makes BOTH affected workers get
-- "Invalid or expired code" and unable to check in. Uniqueness is currently only
-- enforced in application code (generateUniqueCodes); a concurrent generation or a
-- manual/legacy insert could still create a collision. This index makes the
-- database the source of truth.
--
-- Scope: partial index on is_active = true only. Deactivated codes are allowed to
-- repeat (they are never looked up) and historical rows are left untouched.
--
-- SAFETY / OPERATIONS:
--   * Run during a maintenance window, NOT during a live event.
--   * CONCURRENTLY avoids locking writes to checkin_codes, but it CANNOT run
--     inside a transaction block — execute this statement on its own.
--   * Verify there are no existing active duplicates first:
--       SELECT code, COUNT(*) FROM checkin_codes
--       WHERE is_active = true GROUP BY code HAVING COUNT(*) > 1;
--     (Confirmed empty as of 2026-06-24.) If the build fails, resolve the
--     duplicates above and re-run.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uniq_checkin_codes_active_code
  ON public.checkin_codes (code)
  WHERE is_active = true;
