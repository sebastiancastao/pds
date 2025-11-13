-- Migration: Create state_rates table
-- Description: Store state-specific wage rates, overtime, doubletime, and tax information
-- Date: 2025-01-13

-- Create state_rates table
CREATE TABLE IF NOT EXISTS state_rates (
  id SERIAL PRIMARY KEY,
  state_code VARCHAR(2) NOT NULL UNIQUE,
  state_name VARCHAR(100) NOT NULL,
  base_rate DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  overtime_enabled BOOLEAN NOT NULL DEFAULT true,
  overtime_rate DECIMAL(5, 2) NOT NULL DEFAULT 1.5,
  doubletime_enabled BOOLEAN NOT NULL DEFAULT false,
  doubletime_rate DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
  tax_rate DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index on state_code for fast lookups
CREATE INDEX idx_state_rates_state_code ON state_rates(state_code);

-- Create index on effective_date for historical queries
CREATE INDEX idx_state_rates_effective_date ON state_rates(effective_date DESC);

-- Insert default rates for existing states
INSERT INTO state_rates (state_code, state_name, base_rate, overtime_enabled, overtime_rate, doubletime_enabled, doubletime_rate, tax_rate, effective_date)
VALUES
  ('CA', 'California', 17.28, true, 1.5, true, 2.0, 0.00, CURRENT_DATE),
  ('NY', 'New York', 17.00, true, 1.5, false, 0.00, 0.00, CURRENT_DATE),
  ('AZ', 'Arizona', 14.70, true, 1.5, false, 0.00, 0.00, CURRENT_DATE),
  ('WI', 'Wisconsin', 15.00, true, 1.5, false, 0.00, 0.00, CURRENT_DATE)
ON CONFLICT (state_code) DO NOTHING;

-- Add trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_state_rates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_state_rates_updated_at
  BEFORE UPDATE ON state_rates
  FOR EACH ROW
  EXECUTE FUNCTION update_state_rates_updated_at();

-- Add comments for documentation
COMMENT ON TABLE state_rates IS 'Stores state-specific wage rates, overtime, doubletime, and tax information';
COMMENT ON COLUMN state_rates.state_code IS 'Two-letter state abbreviation (e.g., CA, NY)';
COMMENT ON COLUMN state_rates.state_name IS 'Full state name';
COMMENT ON COLUMN state_rates.base_rate IS 'Base hourly rate in USD';
COMMENT ON COLUMN state_rates.overtime_enabled IS 'Whether overtime pay applies (typically after 8 hours)';
COMMENT ON COLUMN state_rates.overtime_rate IS 'Overtime multiplier (typically 1.5x for time-and-a-half)';
COMMENT ON COLUMN state_rates.doubletime_enabled IS 'Whether doubletime pay applies (typically after 12 hours)';
COMMENT ON COLUMN state_rates.doubletime_rate IS 'Doubletime multiplier (typically 2.0x for double time)';
COMMENT ON COLUMN state_rates.tax_rate IS 'Tax rate as a percentage (0-100)';
COMMENT ON COLUMN state_rates.effective_date IS 'Date when these rates become effective';

-- Grant permissions (adjust based on your security model)
-- GRANT SELECT ON state_rates TO authenticated;
-- GRANT ALL ON state_rates TO service_role;

-- Example queries:

-- Get current rates for a state
-- SELECT * FROM state_rates WHERE state_code = 'CA' ORDER BY effective_date DESC LIMIT 1;

-- Get all active rates
-- SELECT * FROM state_rates ORDER BY state_name;

-- Calculate overtime and doubletime rates
-- SELECT
--   state_code,
--   state_name,
--   base_rate,
--   CASE WHEN overtime_enabled THEN base_rate * overtime_rate ELSE 0 END as overtime_hourly_rate,
--   CASE WHEN doubletime_enabled THEN base_rate * doubletime_rate ELSE 0 END as doubletime_hourly_rate
-- FROM state_rates
-- ORDER BY state_name;
