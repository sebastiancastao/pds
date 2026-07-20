-- Even split is now the default tip distribution method for all events.
-- Prorated (by hours) remains available as a manual per-event override.
ALTER TABLE events
ALTER COLUMN tips_distribution_mode SET DEFAULT 'equal';
