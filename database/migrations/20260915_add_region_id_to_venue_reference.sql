-- Adds region_id to venue_reference so each venue can be scoped to a region.
-- app/api/venues/route.ts now requires region_id on venue create/update
-- (see app/venue-management/page.tsx for the admin UI), so that region-scoped
-- vendor lookups always have a region to filter by.
-- Nullable at the DB level so existing venues aren't broken by this migration;
-- the venue-management UI flags venues with no region set so admins can
-- backfill them.
ALTER TABLE venue_reference
  ADD COLUMN IF NOT EXISTS region_id UUID REFERENCES regions(id);

CREATE INDEX IF NOT EXISTS idx_venue_reference_region_id
  ON venue_reference(region_id);
