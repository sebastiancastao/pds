-- Migration: Add explicit clock-out attestation outcome to time entries
-- Purpose: Persist whether kiosk clock-out attestation was accepted or rejected
-- Date: 2026-02-21

ALTER TABLE public.time_entries
ADD COLUMN IF NOT EXISTS attestation_accepted BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_time_entries_attestation_accepted_clock_out
  ON public.time_entries(attestation_accepted)
  WHERE action = 'clock_out';

COMMENT ON COLUMN public.time_entries.attestation_accepted IS
  'Clock-out attestation outcome from kiosk flow (TRUE=accepted, FALSE=rejected, NULL=not captured)';
