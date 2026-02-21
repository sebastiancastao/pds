-- =====================================================
-- PDS Database Complete Schema
-- =====================================================
-- This file contains all CREATE TABLE statements for the PDS system
-- Generated: 2025-11-26
-- =====================================================

-- =====================================================
-- Extensions
-- =====================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis"; -- For geographic data

-- =====================================================
-- Custom Types and Enums
-- =====================================================

CREATE TYPE user_role AS ENUM ('worker', 'manager', 'finance', 'exec');
CREATE TYPE division_type AS ENUM ('vendor', 'trailers', 'both');
CREATE TYPE document_type AS ENUM ('i9', 'w4', 'w9', 'direct_deposit', 'handbook', 'other');
CREATE TYPE onboarding_status AS ENUM ('pending', 'in_progress', 'completed');
CREATE TYPE clock_action AS ENUM ('clock_in', 'clock_out', 'meal_start', 'meal_end');
CREATE TYPE leave_status AS ENUM ('pending', 'approved', 'denied');

-- =====================================================
-- Core Authentication & User Management
-- =====================================================

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    role user_role NOT NULL DEFAULT 'worker',
    division division_type,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ,
    failed_login_attempts INTEGER DEFAULT 0,
    account_locked_until TIMESTAMPTZ,
    is_temporary_password BOOLEAN DEFAULT false,
    must_change_password BOOLEAN DEFAULT false,
    password_expires_at TIMESTAMPTZ,
    last_password_change TIMESTAMPTZ
);

-- User profiles with encrypted PII
CREATE TABLE profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    address TEXT,
    city TEXT,
    state CHAR(2),
    zip_code TEXT,
    password_hash TEXT,
    mfa_secret TEXT,
    mfa_enabled BOOLEAN DEFAULT false,
    backup_codes TEXT[],
    onboarding_status onboarding_status DEFAULT 'pending',
    onboarding_completed_at TIMESTAMPTZ,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    region_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User invitations
CREATE TABLE user_invites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    role user_role NOT NULL,
    division division_type,
    first_name TEXT,
    last_name TEXT,
    state CHAR(2),
    invite_token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id)
);

-- Sessions
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_activity TIMESTAMPTZ DEFAULT NOW()
);

-- Password resets
CREATE TABLE password_resets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- Security & Compliance
-- =====================================================

-- Audit logs
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    ip_address INET,
    user_agent TEXT,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB
);

-- Form audit trail for I-9/W-4 compliance
CREATE TABLE form_audit_trail (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    form_id TEXT NOT NULL,
    form_type TEXT NOT NULL,
    user_id UUID REFERENCES users(id),
    action TEXT NOT NULL CHECK (action IN ('created', 'viewed', 'edited', 'signed', 'reviewed', 'certified')),
    action_details JSONB,
    ip_address TEXT,
    user_agent TEXT,
    device_fingerprint TEXT,
    session_id TEXT,
    field_changed TEXT,
    old_value TEXT,
    new_value TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Form signatures with cryptographic binding
CREATE TABLE form_signatures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    form_id TEXT NOT NULL,
    form_type TEXT NOT NULL,
    user_id UUID REFERENCES users(id),
    signature_role TEXT NOT NULL CHECK (signature_role IN ('employee', 'employer')),
    signature_data TEXT NOT NULL,
    signature_type TEXT NOT NULL CHECK (signature_type IN ('typed', 'drawn')),
    form_data_hash TEXT NOT NULL,
    signature_hash TEXT NOT NULL,
    binding_hash TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    device_fingerprint TEXT,
    session_id TEXT,
    signed_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_valid BOOLEAN DEFAULT true,
    verification_attempts INTEGER DEFAULT 0,
    last_verified_at TIMESTAMPTZ,
    employer_title TEXT,
    employer_organization TEXT,
    documents_examined JSONB,
    examination_date DATE
);

-- Geofence zones
CREATE TABLE geofence_zones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    zone_type TEXT NOT NULL CHECK (zone_type IN ('circle', 'polygon')),
    center_latitude DECIMAL(10, 8),
    center_longitude DECIMAL(11, 8),
    radius_meters INTEGER,
    polygon_coordinates JSONB,
    is_active BOOLEAN DEFAULT true,
    applies_to_roles TEXT[],
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Login locations
CREATE TABLE login_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    accuracy_meters DECIMAL(10, 2),
    within_geofence BOOLEAN,
    matched_zone_id UUID REFERENCES geofence_zones(id),
    matched_zone_name TEXT,
    distance_to_zone_meters DECIMAL(10, 2),
    login_allowed BOOLEAN,
    login_denied_reason TEXT,
    ip_address TEXT,
    user_agent TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- Documents & Compliance
-- =====================================================

-- Documents
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    document_type document_type NOT NULL,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER,
    mime_type TEXT,
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    retention_until TIMESTAMPTZ,
    is_deleted BOOLEAN DEFAULT false,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES users(id),
    metadata JSONB
);

-- I-9 verification documents
CREATE TABLE i9_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    drivers_license_url TEXT,
    drivers_license_filename TEXT,
    drivers_license_uploaded_at TIMESTAMPTZ,
    ssn_document_url TEXT,
    ssn_document_filename TEXT,
    ssn_document_uploaded_at TIMESTAMPTZ,
    additional_doc_url TEXT,
    additional_doc_filename TEXT,
    additional_doc_uploaded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Background check PDFs
CREATE TABLE background_check_pdfs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    pdf_data TEXT NOT NULL,
    signature TEXT NOT NULL,
    signature_type VARCHAR(10) CHECK (signature_type IN ('type', 'draw')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vendor background checks
CREATE TABLE vendor_background_checks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    background_check_completed BOOLEAN DEFAULT false,
    completed_date TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- PDF form progress
CREATE TABLE pdf_form_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    form_name VARCHAR(255) NOT NULL,
    form_data BYTEA,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, form_name)
);

-- =====================================================
-- Payroll & HR
-- =====================================================

-- Payroll additional information
CREATE TABLE payroll_additional_info (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    preferred_name VARCHAR(100),
    pronouns VARCHAR(50),
    uniform_size VARCHAR(10),
    dietary_restrictions TEXT,
    transportation_method TEXT,
    availability_notes TEXT,
    previous_experience TEXT,
    references TEXT,
    background_check_consent BOOLEAN DEFAULT false,
    terms_agreed BOOLEAN DEFAULT false,
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- NY Payroll packets
CREATE TABLE payroll_packets_ny (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    first_name VARCHAR(100),
    middle_name VARCHAR(100),
    last_name VARCHAR(100),
    ssn VARCHAR(11),
    email TEXT,
    phone VARCHAR(20),
    date_of_birth DATE,
    street_address TEXT,
    apartment VARCHAR(20),
    city TEXT,
    state VARCHAR(2),
    zip_code VARCHAR(10),
    position VARCHAR(100),
    start_date VARCHAR(50),
    employment_type VARCHAR(50),
    filing_status VARCHAR(50),
    dependents INTEGER,
    extra_withholding DECIMAL(10, 2),
    bank_name VARCHAR(100),
    account_type VARCHAR(20),
    routing_number VARCHAR(9),
    account_number VARCHAR(20),
    emergency_contact_name VARCHAR(100),
    emergency_contact_relationship VARCHAR(50),
    emergency_contact_phone VARCHAR(20),
    citizenship_status VARCHAR(50),
    alien_registration_number VARCHAR(50),
    preferred_name VARCHAR(100),
    pronouns VARCHAR(50),
    uniform_size VARCHAR(10),
    dietary_restrictions TEXT,
    transportation_method TEXT,
    availability_notes TEXT,
    previous_experience TEXT,
    references TEXT,
    meal_waiver_6_hour BOOLEAN DEFAULT false,
    meal_waiver_10_hour BOOLEAN DEFAULT false,
    meal_waiver_date DATE,
    meal_waiver_printed_name VARCHAR(100),
    meal_waiver_signature VARCHAR(255),
    background_check_consent BOOLEAN DEFAULT false,
    certification BOOLEAN DEFAULT false,
    status VARCHAR(50) DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'needs_revision')),
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    notes TEXT,
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- State rates
CREATE TABLE state_rates (
    id SERIAL PRIMARY KEY,
    state_code VARCHAR(2) UNIQUE NOT NULL,
    state_name VARCHAR(100),
    base_rate DECIMAL(10, 2) NOT NULL,
    overtime_enabled BOOLEAN DEFAULT true,
    doubletime_enabled BOOLEAN DEFAULT false,
    overtime_rate DECIMAL(10, 2),
    doubletime_rate DECIMAL(10, 2),
    tax_rate DECIMAL(5, 2),
    effective_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- Time Keeping 
-- =====================================================

-- Time entries
CREATE TABLE time_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    action clock_action NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    division division_type,
    notes TEXT,
    attestation_accepted BOOLEAN,
    event_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sick leave requests
CREATE TABLE sick_leaves (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    duration_hours NUMERIC(6, 2) NOT NULL DEFAULT 0,
    status leave_status NOT NULL DEFAULT 'pending',
    reason TEXT,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (end_date >= start_date),
    CHECK (duration_hours >= 0)
);

CREATE INDEX idx_sick_leaves_user_id ON sick_leaves(user_id);
CREATE INDEX idx_sick_leaves_status ON sick_leaves(status);
CREATE INDEX idx_sick_leaves_start_date ON sick_leaves(start_date);

-- =====================================================
-- Events & Staffing
-- =====================================================

-- Events
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    artist TEXT,
    artist_share_percent NUMERIC(5, 2),
    venue_share_percent NUMERIC(5, 2),
    pds_share_percent NUMERIC(5, 2),
    venue TEXT,
    event_type TEXT,
    datetime TIMESTAMPTZ NOT NULL,
    tax_bracket_city TEXT,
    tax_bracket_state TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_archived BOOLEAN DEFAULT false
);

-- Event staff assignments
CREATE TABLE event_staff (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    invited_at TIMESTAMPTZ DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected'))
);

-- Event teams
CREATE TABLE event_teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    vendor_id UUID REFERENCES users(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'assigned' CHECK (status IN ('assigned', 'confirmed', 'declined', 'completed')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Event merchandise
CREATE TABLE event_merchandise (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    apparel_gross NUMERIC(12, 2) DEFAULT 0,
    other_gross NUMERIC(12, 2) DEFAULT 0,
    music_gross NUMERIC(12, 2) DEFAULT 0,
    apparel_tax_rate NUMERIC(5, 2) DEFAULT 0,
    other_tax_rate NUMERIC(5, 2) DEFAULT 0,
    music_tax_rate NUMERIC(5, 2) DEFAULT 0,
    apparel_cc_fee_rate NUMERIC(5, 2) DEFAULT 0,
    other_cc_fee_rate NUMERIC(5, 2) DEFAULT 0,
    music_cc_fee_rate NUMERIC(5, 2) DEFAULT 0,
    apparel_artist_percent NUMERIC(5, 2) DEFAULT 0,
    other_artist_percent NUMERIC(5, 2) DEFAULT 0,
    music_artist_percent NUMERIC(5, 2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- Vendor Invitations & Availability
-- =====================================================

-- Vendor invitations
CREATE TABLE vendor_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token TEXT UNIQUE NOT NULL,
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    vendor_id UUID REFERENCES users(id) ON DELETE CASCADE,
    invited_by UUID REFERENCES users(id),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
    availability JSONB,
    notes TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    responded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vendor availability
CREATE TABLE vendor_availability (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vendor_id UUID REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    is_available BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(vendor_id, date)
);

-- =====================================================
-- Payments & Payouts
-- =====================================================

-- Payouts
CREATE TABLE payouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    regular_hours DECIMAL(10, 2) DEFAULT 0,
    overtime_hours DECIMAL(10, 2) DEFAULT 0,
    double_time_hours DECIMAL(10, 2) DEFAULT 0,
    hourly_rate DECIMAL(10, 2),
    commission_amount DECIMAL(12, 2) DEFAULT 0,
    tips_amount DECIMAL(12, 2) DEFAULT 0,
    gross_pay DECIMAL(12, 2),
    approved_by_manager UUID REFERENCES users(id),
    approved_by_finance UUID REFERENCES users(id),
    manager_approved_at TIMESTAMPTZ,
    finance_approved_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
    exported_to_adp BOOLEAN DEFAULT false,
    exported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Event payments
CREATE TABLE event_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    commission_pool_percent DECIMAL(5, 2),
    commission_pool_dollars DECIMAL(12, 2),
    total_tips DECIMAL(12, 2) DEFAULT 0,
    total_regular_hours DECIMAL(10, 2) DEFAULT 0,
    total_overtime_hours DECIMAL(10, 2) DEFAULT 0,
    total_doubletime_hours DECIMAL(10, 2) DEFAULT 0,
    total_regular_pay DECIMAL(12, 2) DEFAULT 0,
    total_overtime_pay DECIMAL(12, 2) DEFAULT 0,
    total_doubletime_pay DECIMAL(12, 2) DEFAULT 0,
    total_commissions DECIMAL(12, 2) DEFAULT 0,
    total_tips_distributed DECIMAL(12, 2) DEFAULT 0,
    total_payment DECIMAL(12, 2) DEFAULT 0,
    base_rate DECIMAL(10, 2),
    net_sales DECIMAL(12, 2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

-- Event vendor payments
CREATE TABLE event_vendor_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_payment_id UUID REFERENCES event_payments(id) ON DELETE CASCADE,
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    actual_hours DECIMAL(10, 2) DEFAULT 0,
    regular_hours DECIMAL(10, 2) DEFAULT 0,
    overtime_hours DECIMAL(10, 2) DEFAULT 0,
    doubletime_hours DECIMAL(10, 2) DEFAULT 0,
    regular_pay DECIMAL(12, 2) DEFAULT 0,
    overtime_pay DECIMAL(12, 2) DEFAULT 0,
    doubletime_pay DECIMAL(12, 2) DEFAULT 0,
    commissions DECIMAL(12, 2) DEFAULT 0,
    tips DECIMAL(12, 2) DEFAULT 0,
    total_pay DECIMAL(12, 2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payment adjustments
CREATE TABLE payment_adjustments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    adjustment_amount DECIMAL(12, 2) NOT NULL,
    adjustment_note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

-- =====================================================
-- Geographic/Regional
-- =====================================================

-- Regions
CREATE TABLE regions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    boundary GEOGRAPHY(POLYGON, 4326),
    center_lat DECIMAL(10, 8),
    center_lng DECIMAL(11, 8),
    radius_miles DECIMAL(10, 2),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID
);

-- Venue reference
CREATE TABLE venue_reference (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    venue_name TEXT UNIQUE NOT NULL,
    city TEXT,
    state CHAR(2),
    full_address TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- Foreign Keys (Add after regions table is created)
-- =====================================================

ALTER TABLE profiles ADD CONSTRAINT fk_profiles_region
    FOREIGN KEY (region_id) REFERENCES regions(id);

ALTER TABLE time_entries ADD CONSTRAINT fk_time_entries_event
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL;

ALTER TABLE regions ADD CONSTRAINT fk_regions_created_by
    FOREIGN KEY (created_by) REFERENCES users(id);

-- =====================================================
-- Indexes for Performance
-- =====================================================

-- Users and authentication
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_division ON users(division);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_token_hash ON sessions(token_hash);

-- Profiles
CREATE INDEX idx_profiles_user_id ON profiles(user_id);
CREATE INDEX idx_profiles_region_id ON profiles(region_id);
CREATE INDEX idx_profiles_state ON profiles(state);

-- Events and staffing
CREATE INDEX idx_events_datetime ON events(datetime);
CREATE INDEX idx_events_created_by ON events(created_by);
CREATE INDEX idx_event_staff_event_id ON event_staff(event_id);
CREATE INDEX idx_event_staff_user_id ON event_staff(user_id);
CREATE INDEX idx_event_teams_event_id ON event_teams(event_id);
CREATE INDEX idx_event_teams_vendor_id ON event_teams(vendor_id);

-- Time Keeping 
CREATE INDEX idx_time_entries_user_id ON time_entries(user_id);
CREATE INDEX idx_time_entries_timestamp ON time_entries(timestamp);
CREATE INDEX idx_time_entries_event_id ON time_entries(event_id);
CREATE INDEX idx_time_entries_action ON time_entries(action);
CREATE INDEX idx_time_entries_attestation_accepted_clock_out
    ON time_entries(attestation_accepted)
    WHERE action = 'clock_out';

-- Payments
CREATE INDEX idx_payouts_user_id ON payouts(user_id);
CREATE INDEX idx_payouts_event_id ON payouts(event_id);
CREATE INDEX idx_payouts_status ON payouts(status);
CREATE INDEX idx_event_payments_event_id ON event_payments(event_id);
CREATE INDEX idx_event_vendor_payments_event_id ON event_vendor_payments(event_id);
CREATE INDEX idx_event_vendor_payments_user_id ON event_vendor_payments(user_id);

-- Audit and security
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_form_audit_trail_form_id ON form_audit_trail(form_id);
CREATE INDEX idx_form_audit_trail_user_id ON form_audit_trail(user_id);
CREATE INDEX idx_form_signatures_form_id ON form_signatures(form_id);
CREATE INDEX idx_login_locations_user_id ON login_locations(user_id);

-- Invitations
CREATE INDEX idx_vendor_invitations_token ON vendor_invitations(token);
CREATE INDEX idx_vendor_invitations_vendor_id ON vendor_invitations(vendor_id);
CREATE INDEX idx_vendor_invitations_event_id ON vendor_invitations(event_id);
CREATE INDEX idx_user_invites_token ON user_invites(invite_token);

-- Documents
CREATE INDEX idx_documents_user_id ON documents(user_id);
CREATE INDEX idx_i9_documents_user_id ON i9_documents(user_id);

-- =====================================================
-- Row Level Security (RLS) Setup
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE sick_leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE geofence_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_audit_trail ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_vendor_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE state_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE i9_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE background_check_pdfs ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_background_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_additional_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_packets_ny ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_form_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_merchandise ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_reference ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- Triggers for Updated_At Timestamps
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payouts_updated_at BEFORE UPDATE ON payouts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_event_teams_updated_at BEFORE UPDATE ON event_teams
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_event_payments_updated_at BEFORE UPDATE ON event_payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_event_vendor_payments_updated_at BEFORE UPDATE ON event_vendor_payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_adjustments_updated_at BEFORE UPDATE ON payment_adjustments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_regions_updated_at BEFORE UPDATE ON regions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_state_rates_updated_at BEFORE UPDATE ON state_rates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vendor_invitations_updated_at BEFORE UPDATE ON vendor_invitations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_geofence_zones_updated_at BEFORE UPDATE ON geofence_zones
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_i9_documents_updated_at BEFORE UPDATE ON i9_documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_background_check_pdfs_updated_at BEFORE UPDATE ON background_check_pdfs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vendor_background_checks_updated_at BEFORE UPDATE ON vendor_background_checks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payroll_additional_info_updated_at BEFORE UPDATE ON payroll_additional_info
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payroll_packets_ny_updated_at BEFORE UPDATE ON payroll_packets_ny
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_event_merchandise_updated_at BEFORE UPDATE ON event_merchandise
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vendor_availability_updated_at BEFORE UPDATE ON vendor_availability
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Comments
-- =====================================================

COMMENT ON TABLE users IS 'Core user accounts with role-based access';
COMMENT ON TABLE profiles IS 'User profile information with encrypted PII data';
COMMENT ON TABLE sessions IS 'Active user sessions for authentication';
COMMENT ON TABLE audit_logs IS 'Immutable audit trail for compliance';
COMMENT ON TABLE time_entries IS 'Clock in/out records for Time Keeping ';
COMMENT ON COLUMN time_entries.attestation_accepted IS 'Clock-out attestation outcome from kiosk flow (TRUE=accepted, FALSE=rejected, NULL=not captured)';
COMMENT ON TABLE sick_leaves IS 'Sick leave records for employees with duration and approvals';
COMMENT ON COLUMN sick_leaves.duration_hours IS 'Length of time booked as sick leave in hours';
COMMENT ON COLUMN sick_leaves.status IS 'Pending/approved/denied workflow state for each request';
COMMENT ON TABLE events IS 'Events requiring staffing and management';
COMMENT ON TABLE event_staff IS 'Staff assignments to events';
COMMENT ON TABLE payouts IS 'Payroll calculations and commission keeping';
COMMENT ON TABLE documents IS 'High-sensitivity PII documents with retention policies';
COMMENT ON TABLE vendor_invitations IS 'Event invitations sent to vendors';
COMMENT ON TABLE geofence_zones IS 'Geographic zones for location-based security';
COMMENT ON TABLE login_locations IS 'Login attempt keepingwith geolocation';
COMMENT ON TABLE form_audit_trail IS 'Comprehensive audit trail for I-9/W-4 forms';
COMMENT ON TABLE form_signatures IS 'Digital signatures with cryptographic binding';
COMMENT ON TABLE regions IS 'Geographic regions with PostGIS polygon support';
COMMENT ON TABLE state_rates IS 'State-specific wage rates and tax information';

-- =====================================================
-- End of Schema
-- =====================================================
