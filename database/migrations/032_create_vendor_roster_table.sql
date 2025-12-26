-- =====================================================
-- CREATE VENDOR ROSTER TABLE
-- =====================================================
-- This table stores vendor/contractor information for reference

CREATE TABLE IF NOT EXISTS vendor_roster (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    address_line1 TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    cell_phone TEXT,
    email TEXT,
    new_hire_packet BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_vendor_roster_name ON vendor_roster(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_vendor_roster_email ON vendor_roster(email);

-- Enable RLS
ALTER TABLE vendor_roster ENABLE ROW LEVEL SECURITY;

-- Policy: All authenticated users can view vendor roster
CREATE POLICY "Authenticated users can view vendor roster"
    ON vendor_roster
    FOR SELECT
    USING (
        auth.uid() IS NOT NULL
    );

-- Policy: Only exec and admin can insert/update/delete vendor roster
CREATE POLICY "Exec and admin can manage vendor roster"
    ON vendor_roster
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('exec', 'admin')
        )
    );

-- Trigger for updated_at
CREATE TRIGGER update_vendor_roster_updated_at
    BEFORE UPDATE ON vendor_roster
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE vendor_roster IS 'Stores vendor/contractor information for reference';
COMMENT ON COLUMN vendor_roster.first_name IS 'Vendor first name';
COMMENT ON COLUMN vendor_roster.last_name IS 'Vendor last name';
COMMENT ON COLUMN vendor_roster.address_line1 IS 'Street address';
COMMENT ON COLUMN vendor_roster.city IS 'City';
COMMENT ON COLUMN vendor_roster.state IS 'State';
COMMENT ON COLUMN vendor_roster.zip IS 'ZIP code';
COMMENT ON COLUMN vendor_roster.cell_phone IS 'Cell phone number';
COMMENT ON COLUMN vendor_roster.email IS 'Email address';
COMMENT ON COLUMN vendor_roster.new_hire_packet IS 'Whether the new hire packet has been completed';
