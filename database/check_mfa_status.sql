-- Check MFA Status for a User
-- Run this query to check if MFA is enabled for a specific user

-- Replace 'user@example.com' with the actual email
SELECT 
  u.id,
  u.email,
  u.is_temporary_password,
  p.mfa_enabled,
  p.mfa_secret IS NOT NULL as has_mfa_secret,
  p.backup_codes IS NOT NULL as has_backup_codes,
  CASE 
    WHEN u.is_temporary_password = true THEN 'Must change password first'
    WHEN p.mfa_enabled = true THEN 'MFA enabled - will go to /verify-mfa'
    WHEN p.mfa_enabled = false OR p.mfa_enabled IS NULL THEN 'MFA not set up - will go to /mfa-setup'
  END as expected_redirect
FROM 
  users u
LEFT JOIN 
  profiles p ON u.id = p.user_id
WHERE 
  u.email = 'user@example.com'; -- Replace with your email

-- To check all users:
-- SELECT 
--   u.id,
--   u.email,
--   u.is_temporary_password,
--   p.mfa_enabled
-- FROM users u
-- LEFT JOIN profiles p ON u.id = p.user_id
-- ORDER BY u.created_at DESC;




