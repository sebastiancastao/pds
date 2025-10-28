-- Run Form Compliance Migrations
-- Execute these migrations to enable I-9 and W-4 compliance features
-- Date: 2025-10-28

-- Migration 021: Form Audit Trail
\i 'migrations/021_create_form_audit_trail_table.sql'

-- Migration 022: Form Signatures
\i 'migrations/022_create_form_signatures_table.sql'

-- Verify tables were created
SELECT
    'form_audit_trail' as table_name,
    EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'form_audit_trail'
    ) as exists;

SELECT
    'form_signatures' as table_name,
    EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'form_signatures'
    ) as exists;

-- Show table structures
\d public.form_audit_trail
\d public.form_signatures

SELECT 'Compliance migrations completed successfully!' as status;
