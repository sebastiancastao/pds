-- PDS Time Tracking System - Database Schema
-- Supabase PostgreSQL with Row Level Security (RLS)
-- AES-256 Encryption for PII fields

-- ============================================
-- Enable Extensions
-- ============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- Custom Types (Enums)
-- ============================================

CREATE TYPE user_role AS ENUM ('worker', 'manager', 'finance', 'exec');
CREATE TYPE division_type AS ENUM ('vendor', 'trailers', 'both');
CREATE TYPE document_type AS ENUM ('i9', 'w4', 'w9', 'direct_deposit', 'handbook', 'other');
CREATE TYPE onboarding_status AS ENUM ('pending', 'in_progress', 'completed');
CREATE TYPE clock_action AS ENUM ('clock_in', 'clock_out');

-- ============================================
-- Users Table (Auth.users is managed by Supabase)
-- ============================================

CREATE TABLE public.users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  role user_role NOT NULL DEFAULT 'worker',
  division division_type NOT NULL DEFAULT 'vendor',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login TIMESTAMPTZ
);

-- Index for faster lookups
CREATE INDEX idx_users_email ON public.users(email);
CREATE INDEX idx_users_role ON public.users(role);

-- ============================================
-- Profiles Table (PII - ENCRYPTED)
-- ============================================

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  
  -- Encrypted PII fields (use encryption functions)
  first_name TEXT NOT NULL, -- ENCRYPTED
  last_name TEXT NOT NULL, -- ENCRYPTED
  phone TEXT, -- ENCRYPTED
  address TEXT, -- ENCRYPTED
  city TEXT,
  state CHAR(2) NOT NULL,
  zip_code VARCHAR(10),
  
  -- Authentication
  pin_hash TEXT, -- Hashed 6-digit PIN for workers
  pin_salt TEXT,
  qr_code_data TEXT, -- QR code for worker auth
  totp_secret TEXT, -- 2FA secret for admins
  totp_enabled BOOLEAN NOT NULL DEFAULT false,
  
  -- Onboarding
  onboarding_status onboarding_status NOT NULL DEFAULT 'pending',
  onboarding_completed_at TIMESTAMPTZ,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(user_id)
);

-- Indexes
CREATE INDEX idx_profiles_user_id ON public.profiles(user_id);
CREATE INDEX idx_profiles_state ON public.profiles(state);
CREATE INDEX idx_profiles_onboarding_status ON public.profiles(onboarding_status);

-- ============================================
-- Documents Table (High-Sensitivity PII)
-- ============================================

CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  
  document_type document_type NOT NULL,
  file_path TEXT NOT NULL, -- Encrypted S3 path
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  
  -- Retention & Deletion
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retention_until TIMESTAMPTZ, -- Auto-calculated based on document type
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES public.users(id),
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX idx_documents_user_id ON public.documents(user_id);
CREATE INDEX idx_documents_type ON public.documents(document_type);
CREATE INDEX idx_documents_retention ON public.documents(retention_until) WHERE is_deleted = false;

-- ============================================
-- Audit Logs Table (IMMUTABLE)
-- ============================================

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Who
  user_id UUID REFERENCES public.users(id),
  ip_address INET,
  user_agent TEXT,
  
  -- What
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  
  -- When
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Details
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes for fast querying
CREATE INDEX idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX idx_audit_logs_resource ON public.audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- ============================================
-- Time Tracking Table
-- ============================================

CREATE TABLE public.time_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  
  action clock_action NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Location (optional, for compliance)
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  
  -- Metadata
  division division_type NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_time_entries_user_id ON public.time_entries(user_id);
CREATE INDEX idx_time_entries_timestamp ON public.time_entries(timestamp DESC);
CREATE INDEX idx_time_entries_division ON public.time_entries(division);

-- ============================================
-- Events Table
-- ============================================

CREATE TABLE public.events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by UUID NOT NULL REFERENCES public.users(id),
  
  -- Event Details
  event_name TEXT NOT NULL,
  artist TEXT,
  venue TEXT NOT NULL,
  
  -- Timing
  event_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  
  -- Financial
  ticket_sales INTEGER DEFAULT 0,
  artist_share_percent DECIMAL(5, 2),
  venue_share_percent DECIMAL(5, 2),
  pds_share_percent DECIMAL(5, 2),
  commission_pool DECIMAL(10, 2),
  
  -- Staffing
  required_staff INTEGER DEFAULT 0,
  confirmed_staff INTEGER DEFAULT 0,
  
  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_events_date ON public.events(event_date DESC);
CREATE INDEX idx_events_venue ON public.events(venue);
CREATE INDEX idx_events_created_by ON public.events(created_by);

-- ============================================
-- Event Staff Assignments
-- ============================================

CREATE TABLE public.event_staff (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  
  -- Status
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, accepted, rejected
  
  UNIQUE(event_id, user_id)
);

-- Indexes
CREATE INDEX idx_event_staff_event_id ON public.event_staff(event_id);
CREATE INDEX idx_event_staff_user_id ON public.event_staff(user_id);
CREATE INDEX idx_event_staff_status ON public.event_staff(status);

-- ============================================
-- Payroll/Payouts Table
-- ============================================

CREATE TABLE public.payouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id),
  event_id UUID REFERENCES public.events(id),
  
  -- Wages
  regular_hours DECIMAL(5, 2) DEFAULT 0,
  overtime_hours DECIMAL(5, 2) DEFAULT 0,
  double_time_hours DECIMAL(5, 2) DEFAULT 0,
  hourly_rate DECIMAL(10, 2) NOT NULL,
  
  -- Commission & Tips
  commission_amount DECIMAL(10, 2) DEFAULT 0,
  tips_amount DECIMAL(10, 2) DEFAULT 0,
  
  -- Total
  gross_pay DECIMAL(10, 2) NOT NULL,
  
  -- Approval
  approved_by_manager UUID REFERENCES public.users(id),
  approved_by_finance UUID REFERENCES public.users(id),
  manager_approved_at TIMESTAMPTZ,
  finance_approved_at TIMESTAMPTZ,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected, paid
  
  -- ADP Export
  exported_to_adp BOOLEAN NOT NULL DEFAULT false,
  exported_at TIMESTAMPTZ,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_payouts_user_id ON public.payouts(user_id);
CREATE INDEX idx_payouts_event_id ON public.payouts(event_id);
CREATE INDEX idx_payouts_status ON public.payouts(status);
CREATE INDEX idx_payouts_export ON public.payouts(exported_to_adp, exported_at);

-- ============================================
-- Updated At Trigger Function
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payouts_updated_at BEFORE UPDATE ON public.payouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Document Retention Calculation Function
-- ============================================

CREATE OR REPLACE FUNCTION calculate_document_retention()
RETURNS TRIGGER AS $$
BEGIN
  -- Set retention date based on document type
  CASE NEW.document_type
    WHEN 'i9' THEN
      -- 3 years after hire OR 1 year after termination (we'll use 4 years as safe default)
      NEW.retention_until := NEW.uploaded_at + INTERVAL '4 years';
    WHEN 'w4' THEN
      -- 4 years minimum
      NEW.retention_until := NEW.uploaded_at + INTERVAL '4 years';
    WHEN 'w9' THEN
      -- 4 years minimum
      NEW.retention_until := NEW.uploaded_at + INTERVAL '4 years';
    WHEN 'handbook' THEN
      -- During employment + 3-6 years (we'll use 7 years)
      NEW.retention_until := NEW.uploaded_at + INTERVAL '7 years';
    WHEN 'direct_deposit' THEN
      -- As long as necessary (we'll use 4 years)
      NEW.retention_until := NEW.uploaded_at + INTERVAL '4 years';
    ELSE
      -- Default: 7 years
      NEW.retention_until := NEW.uploaded_at + INTERVAL '7 years';
  END CASE;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_document_retention BEFORE INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION calculate_document_retention();

-- ============================================
-- Row Level Security (RLS) Policies
-- See rls_policies.sql for full implementation
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;

-- ============================================
-- Comments for Documentation
-- ============================================

COMMENT ON TABLE public.users IS 'User accounts with role and division';
COMMENT ON TABLE public.profiles IS 'User profiles with ENCRYPTED PII data';
COMMENT ON TABLE public.documents IS 'High-sensitivity documents (I-9, W-4, etc.) with encryption';
COMMENT ON TABLE public.audit_logs IS 'IMMUTABLE audit trail for compliance';
COMMENT ON TABLE public.time_entries IS 'Employee clock in/out records (FLSA compliant)';
COMMENT ON TABLE public.events IS 'Events requiring staffing';
COMMENT ON TABLE public.payouts IS 'Payroll/commission calculations for ADP export';

COMMENT ON COLUMN public.profiles.first_name IS 'ENCRYPTED: Use encryption functions to access';
COMMENT ON COLUMN public.profiles.last_name IS 'ENCRYPTED: Use encryption functions to access';
COMMENT ON COLUMN public.profiles.phone IS 'ENCRYPTED: Use encryption functions to access';
COMMENT ON COLUMN public.profiles.address IS 'ENCRYPTED: Use encryption functions to access';


