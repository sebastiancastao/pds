-- Check if this specific user has submitted a PDF
-- User ID from logs: bc8dfb5c-aa63-465e-9724-fe6dcb6f968f

-- Check in background_check_pdfs table
SELECT
    'background_check_pdfs' as table_name,
    user_id,
    created_at,
    CASE WHEN signature IS NOT NULL THEN 'Has Signature' ELSE 'No Signature' END as signature_status,
    signature_type
FROM background_check_pdfs
WHERE user_id = 'bc8dfb5c-aa63-465e-9724-fe6dcb6f968f';

-- Check if ANY PDFs exist in the table
SELECT
    'All PDFs in database' as check_type,
    COUNT(*) as total_pdfs
FROM background_check_pdfs;

-- Show all PDFs that exist
SELECT
    'All PDF user_ids' as check_type,
    user_id,
    created_at
FROM background_check_pdfs
ORDER BY created_at DESC;

-- Check the profile
SELECT
    'Profile check' as check_type,
    id as profile_id,
    user_id,
    first_name,
    last_name,
    role
FROM profiles
WHERE user_id = 'bc8dfb5c-aa63-465e-9724-fe6dcb6f968f';

-- Check if user completed the form in the users table
SELECT
    'Users table check' as check_type,
    id,
    background_check_completed,
    background_check_completed_at
FROM users
WHERE id = 'bc8dfb5c-aa63-465e-9724-fe6dcb6f968f';
