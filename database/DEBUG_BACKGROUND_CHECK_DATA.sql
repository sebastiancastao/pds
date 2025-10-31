-- ==========================================
-- DIAGNOSTIC QUERY: Background Check PDFs
-- ==========================================
-- This query will show us:
-- 1. Which users have submitted background check PDFs
-- 2. Their profile information
-- 3. Whether they have vendor_background_checks records

-- Step 1: Check what's in background_check_pdfs table
SELECT
    'PDFs in background_check_pdfs table' as check_type,
    COUNT(*) as total_count
FROM background_check_pdfs;

-- Step 2: Show actual PDF submissions with user details
SELECT
    'PDF Submissions with User Info' as check_type,
    bcp.user_id,
    bcp.created_at as pdf_submitted_at,
    au.email,
    p.id as profile_id,
    p.first_name,
    p.last_name,
    p.role,
    vbc.id as vendor_background_check_id,
    vbc.background_check_completed
FROM background_check_pdfs bcp
LEFT JOIN auth.users au ON au.id = bcp.user_id
LEFT JOIN profiles p ON p.user_id = bcp.user_id
LEFT JOIN vendor_background_checks vbc ON vbc.profile_id = p.id
ORDER BY bcp.created_at DESC;

-- Step 3: Check for vendors WITHOUT PDF submissions
SELECT
    'Vendors WITHOUT PDF submissions' as check_type,
    p.id as profile_id,
    p.user_id,
    au.email,
    p.first_name,
    p.last_name,
    CASE
        WHEN bcp.user_id IS NULL THEN 'NO PDF'
        ELSE 'HAS PDF'
    END as pdf_status
FROM profiles p
LEFT JOIN auth.users au ON au.id = p.user_id
LEFT JOIN background_check_pdfs bcp ON bcp.user_id = p.user_id
WHERE p.role = 'vendor'
ORDER BY p.first_name;

-- Step 4: Check vendor_background_checks table
SELECT
    'vendor_background_checks records' as check_type,
    vbc.id,
    vbc.profile_id,
    p.user_id,
    p.first_name,
    p.last_name,
    vbc.background_check_completed,
    vbc.completed_date
FROM vendor_background_checks vbc
JOIN profiles p ON p.id = vbc.profile_id
ORDER BY vbc.completed_date DESC;

-- Step 5: Check if there are any orphaned records (user_id mismatch)
SELECT
    'Orphaned PDF records (no matching profile)' as check_type,
    bcp.user_id,
    bcp.created_at,
    CASE
        WHEN p.id IS NULL THEN 'NO PROFILE FOUND'
        ELSE 'PROFILE EXISTS'
    END as status
FROM background_check_pdfs bcp
LEFT JOIN profiles p ON p.user_id = bcp.user_id
WHERE p.id IS NULL;
