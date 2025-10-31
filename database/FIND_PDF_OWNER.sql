-- Find who submitted the PDF
-- PDF was submitted by: c2b77e6d-6bc4-4b74-a88c-647a2b66448f

-- Check this user's email and profile
SELECT
    'User who submitted PDF' as info,
    au.id as user_id,
    au.email,
    p.id as profile_id,
    p.first_name,
    p.last_name,
    p.role,
    CASE
        WHEN p.id IS NULL THEN '⚠️ NO PROFILE EXISTS'
        ELSE '✅ Has Profile'
    END as profile_status
FROM auth.users au
LEFT JOIN profiles p ON p.user_id = au.id
WHERE au.id = 'c2b77e6d-6bc4-4b74-a88c-647a2b66448f';

-- Check the vendor shown in the UI
SELECT
    'Vendor shown in UI (no PDF)' as info,
    au.id as user_id,
    au.email,
    p.id as profile_id,
    p.first_name,
    p.last_name,
    p.role
FROM auth.users au
LEFT JOIN profiles p ON p.user_id = au.id
WHERE au.id = 'bc8dfb5c-aa63-465e-9724-fe6dcb6f968f';

-- Show all PDFs and who they belong to
SELECT
    'All Background Check PDFs' as info,
    bcp.user_id,
    bcp.created_at,
    au.email,
    p.first_name,
    p.last_name,
    p.role
FROM background_check_pdfs bcp
LEFT JOIN auth.users au ON au.id = bcp.user_id
LEFT JOIN profiles p ON p.user_id = bcp.user_id
ORDER BY bcp.created_at DESC;

-- Show all vendors (role='vendor') and their PDF status
SELECT
    'All Vendors and PDF Status' as info,
    p.user_id,
    au.email,
    p.first_name,
    p.last_name,
    CASE
        WHEN bcp.user_id IS NOT NULL THEN '✅ HAS PDF'
        ELSE '❌ NO PDF'
    END as pdf_status,
    bcp.created_at as pdf_submitted_at
FROM profiles p
JOIN auth.users au ON au.id = p.user_id
LEFT JOIN background_check_pdfs bcp ON bcp.user_id = p.user_id
WHERE p.role = 'vendor'
ORDER BY p.first_name;
