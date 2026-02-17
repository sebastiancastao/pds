-- =====================================================
-- CREATE EVENT LOCATIONS + TEAM ASSIGNMENTS TABLES
-- =====================================================
-- Allows each event to define custom working locations and
-- assign event team members to exactly one location.

CREATE TABLE IF NOT EXISTS event_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    notes TEXT,
    display_order INTEGER DEFAULT 0,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id, name)
);

CREATE TABLE IF NOT EXISTS event_location_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES event_locations(id) ON DELETE CASCADE,
    vendor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id, vendor_id),
    UNIQUE(location_id, vendor_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_event_locations_event_id ON event_locations(event_id);
CREATE INDEX IF NOT EXISTS idx_event_locations_display_order ON event_locations(event_id, display_order);
CREATE INDEX IF NOT EXISTS idx_event_location_assignments_event_id ON event_location_assignments(event_id);
CREATE INDEX IF NOT EXISTS idx_event_location_assignments_location_id ON event_location_assignments(location_id);
CREATE INDEX IF NOT EXISTS idx_event_location_assignments_vendor_id ON event_location_assignments(vendor_id);

-- Enable RLS
ALTER TABLE event_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_location_assignments ENABLE ROW LEVEL SECURITY;

-- Policies (service-role managed API writes)
DROP POLICY IF EXISTS "Service role can manage event locations" ON event_locations;
CREATE POLICY "Service role can manage event locations"
    ON event_locations
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can manage event location assignments" ON event_location_assignments;
CREATE POLICY "Service role can manage event location assignments"
    ON event_location_assignments
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_event_locations_updated_at ON event_locations;
CREATE TRIGGER update_event_locations_updated_at
    BEFORE UPDATE ON event_locations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_event_location_assignments_updated_at ON event_location_assignments;
CREATE TRIGGER update_event_location_assignments_updated_at
    BEFORE UPDATE ON event_location_assignments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE event_locations IS 'Custom locations/scopes inside an event (e.g., gate, merch, parking)';
COMMENT ON COLUMN event_locations.display_order IS 'Manual ordering for event location display';
COMMENT ON TABLE event_location_assignments IS 'Assignment of event team members to event locations';
COMMENT ON COLUMN event_location_assignments.vendor_id IS 'Event team member user id assigned to a location';
