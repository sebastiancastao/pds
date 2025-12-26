-- =====================================================
-- RUN VENDOR ROSTER MIGRATION
-- =====================================================
-- This script creates the vendor_roster table
-- Run this in Supabase SQL Editor

-- Run migration 032
\i database/migrations/032_create_vendor_roster_table.sql

-- Verify the table was created
SELECT
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'vendor_roster'
ORDER BY ordinal_position;

-- Check RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename = 'vendor_roster';

-- Check policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'vendor_roster';
