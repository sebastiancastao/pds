-- Debug MFA Status - Run this to check your actual database state
-- Copy the results and share them if the issue persists

-- Check your specific user's MFA status
SELECT 
  u.id as user_id,
  u.email,
  u.is_temporary_password,
  u.must_change_password,
  p.id as profile_id,
  p.user_id as profile_user_id,
  p.mfa_enabled,
  p.mfa_secret IS NOT NULL as has_mfa_secret,
  p.backup_codes IS NOT NULL as has_backup_codes,
  LENGTH(p.mfa_secret) as secret_length,
  p.created_at as profile_created_at,
  p.updated_at as profile_updated_at,
  CASE 
    WHEN u.is_temporary_password = true THEN '1. Should redirect to /password'
    WHEN p.mfa_enabled = true THEN '2. Should redirect to /verify-mfa'
    WHEN p.mfa_enabled = false OR p.mfa_enabled IS NULL THEN '3. Should redirect to /mfa-setup'
  END as expected_redirect,
  CASE
    WHEN p.id IS NULL THEN '❌ NO PROFILE RECORD EXISTS'
    WHEN p.mfa_enabled IS NULL THEN '⚠️ mfa_enabled is NULL (should be true/false)'
    WHEN p.mfa_enabled = true AND p.mfa_secret IS NULL THEN '❌ INCONSISTENT: mfa_enabled=true but no secret'
    WHEN p.mfa_enabled = true AND p.backup_codes IS NULL THEN '❌ INCONSISTENT: mfa_enabled=true but no backup codes'
    WHEN p.mfa_enabled = true THEN '✅ MFA FULLY ENABLED'
    WHEN p.mfa_enabled = false THEN '⚠️ MFA NOT ENABLED YET'
    ELSE '❓ UNKNOWN STATE'
  END as status_check
FROM 
  users u
LEFT JOIN 
  profiles p ON u.id = p.user_id
WHERE 
  u.email = 'sebastiancastao379@gmail.com' -- Your email from the logs
ORDER BY 
  u.created_at DESC;

-- Check if there are multiple profile records (should only be 1)
SELECT 
  COUNT(*) as profile_count,
  user_id,
  STRING_AGG(id::text, ', ') as profile_ids
FROM 
  profiles
WHERE 
  user_id = (SELECT id FROM users WHERE email = 'sebastiancastao379@gmail.com')
GROUP BY 
  user_id;

-- Check RLS policies on profiles table
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM 
  pg_policies
WHERE 
  tablename = 'profiles';

