-- Migration: Add payroll_additional_info table
-- Purpose: Store additional information from the web form for NY Payroll Packet
-- Created: 2025-01-11

-- Create the table
CREATE TABLE IF NOT EXISTS payroll_additional_info (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  preferred_name VARCHAR(255),
  pronouns VARCHAR(100),
  uniform_size VARCHAR(10) NOT NULL,
  dietary_restrictions TEXT,
  transportation_method VARCHAR(100) NOT NULL,
  availability_notes TEXT,
  previous_experience TEXT,
  references TEXT,
  background_check_consent BOOLEAN DEFAULT FALSE,
  terms_agreed BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_payroll_additional_info_user_id ON payroll_additional_info(user_id);
CREATE INDEX IF NOT EXISTS idx_payroll_additional_info_submitted_at ON payroll_additional_info(submitted_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE payroll_additional_info ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can insert their own data
CREATE POLICY "Users can insert their own additional info"
  ON payroll_additional_info
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can view their own data
CREATE POLICY "Users can view their own additional info"
  ON payroll_additional_info
  FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: HR/Admins can view all data (role_id = 3 for Finance)
CREATE POLICY "HR can view all additional info"
  ON payroll_additional_info
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role_id = 3
    )
  );

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_payroll_additional_info_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_payroll_additional_info_updated_at
  BEFORE UPDATE ON payroll_additional_info
  FOR EACH ROW
  EXECUTE FUNCTION update_payroll_additional_info_updated_at();

-- Add comment to table
COMMENT ON TABLE payroll_additional_info IS 'Stores additional information from the NY Payroll Packet web form, supplementing the fillable PDF data';




