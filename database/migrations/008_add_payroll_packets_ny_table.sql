-- Migration: Add payroll_packets_ny table
-- Purpose: Store complete NY Payroll Packet submissions from web form
-- Created: 2025-01-11

-- Create the table
CREATE TABLE IF NOT EXISTS payroll_packets_ny (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Personal Information
  first_name VARCHAR(255) NOT NULL,
  middle_name VARCHAR(255),
  last_name VARCHAR(255) NOT NULL,
  ssn VARCHAR(11) NOT NULL, -- Format: XXX-XX-XXXX
  date_of_birth DATE NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  
  -- Address Information
  street_address TEXT NOT NULL,
  apartment VARCHAR(50),
  city VARCHAR(100) NOT NULL,
  state VARCHAR(2) NOT NULL DEFAULT 'NY',
  zip_code VARCHAR(10) NOT NULL,
  
  -- Employment Information
  position VARCHAR(255) NOT NULL,
  start_date DATE NOT NULL,
  employment_type VARCHAR(50) NOT NULL, -- Full-Time, Part-Time, Contractor, Seasonal
  
  -- W-4 Federal Tax Withholding
  filing_status VARCHAR(50) NOT NULL, -- Single, Married, etc.
  dependents INTEGER DEFAULT 0,
  extra_withholding DECIMAL(10, 2) DEFAULT 0.00,
  
  -- Direct Deposit
  bank_name VARCHAR(255) NOT NULL,
  account_type VARCHAR(20) NOT NULL, -- Checking, Savings
  routing_number VARCHAR(9) NOT NULL,
  account_number VARCHAR(50) NOT NULL,
  
  -- Emergency Contact
  emergency_contact_name VARCHAR(255) NOT NULL,
  emergency_contact_relationship VARCHAR(100) NOT NULL,
  emergency_contact_phone VARCHAR(20) NOT NULL,
  
  -- I-9 Employment Eligibility
  citizenship_status VARCHAR(100) NOT NULL, -- US Citizen, Permanent Resident, etc.
  alien_registration_number VARCHAR(50),
  
  -- Additional Information
  preferred_name VARCHAR(255),
  pronouns VARCHAR(100),
  uniform_size VARCHAR(10) NOT NULL,
  dietary_restrictions TEXT,
  transportation_method VARCHAR(100) NOT NULL,
  availability_notes TEXT,
  previous_experience TEXT,
  references TEXT,
  
  -- Meal Waivers
  meal_waiver_6_hour BOOLEAN NOT NULL DEFAULT FALSE,
  meal_waiver_10_hour BOOLEAN NOT NULL DEFAULT FALSE,
  meal_waiver_date DATE,
  meal_waiver_printed_name VARCHAR(255),
  meal_waiver_signature VARCHAR(255),
  
  -- Certifications
  background_check_consent BOOLEAN DEFAULT FALSE,
  certification BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- Status & Tracking
  status VARCHAR(50) DEFAULT 'pending_review', -- pending_review, approved, needs_revision
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  notes TEXT, -- For HR notes/feedback
  
  -- Timestamps
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_payroll_packets_ny_user_id ON payroll_packets_ny(user_id);
CREATE INDEX IF NOT EXISTS idx_payroll_packets_ny_submitted_at ON payroll_packets_ny(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_packets_ny_status ON payroll_packets_ny(status);
CREATE INDEX IF NOT EXISTS idx_payroll_packets_ny_ssn ON payroll_packets_ny(ssn);

-- Enable Row Level Security (RLS)
ALTER TABLE payroll_packets_ny ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can insert their own data
CREATE POLICY "Users can insert their own payroll packet"
  ON payroll_packets_ny
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can view their own data
CREATE POLICY "Users can view their own payroll packet"
  ON payroll_packets_ny
  FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: HR/Finance can view all data (role_id = 3)
CREATE POLICY "HR can view all payroll packets"
  ON payroll_packets_ny
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role_id = 3
    )
  );

-- RLS Policy: HR/Finance can update status and notes
CREATE POLICY "HR can update payroll packets"
  ON payroll_packets_ny
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role_id = 3
    )
  );

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_payroll_packets_ny_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_payroll_packets_ny_updated_at
  BEFORE UPDATE ON payroll_packets_ny
  FOR EACH ROW
  EXECUTE FUNCTION update_payroll_packets_ny_updated_at();

-- Add comment to table
COMMENT ON TABLE payroll_packets_ny IS 'Complete NY Payroll Packet submissions including all required tax forms, employment information, and additional operational details';

-- Add column comments for clarity
COMMENT ON COLUMN payroll_packets_ny.status IS 'Status: pending_review, approved, needs_revision';
COMMENT ON COLUMN payroll_packets_ny.ssn IS 'Stored as XXX-XX-XXXX format, encrypted at rest';
COMMENT ON COLUMN payroll_packets_ny.account_number IS 'Bank account number, encrypted at rest';
COMMENT ON COLUMN payroll_packets_ny.routing_number IS '9-digit bank routing number';
COMMENT ON COLUMN payroll_packets_ny.certification IS 'Employee certification that all information is accurate';


