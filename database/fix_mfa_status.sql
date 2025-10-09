-- Manual MFA Enable (USE ONLY IF MFA SETUP FAILED)
-- Run this ONLY if you've already scanned the QR code but verification failed

-- Step 1: Check current status
SELECT 
  u.email,
  p.mfa_enabled,
  p.mfa_secret IS NOT NULL as has_secret,
  p.backup_codes IS NOT NULL as has_backup_codes
FROM users u
LEFT JOIN profiles p ON u.id = p.user_id
WHERE u.email = 'your-email@example.com'; -- Replace with your email

-- Step 2: If you see has_secret = true but mfa_enabled = false, you need to complete verification
-- Go through the verification step at /mfa-setup to properly enable MFA

-- ⚠️ DO NOT RUN THIS UNLESS ABSOLUTELY NECESSARY ⚠️
-- This manually enables MFA without proper verification
-- Only use if the system is broken
/*
UPDATE profiles
SET mfa_enabled = true
WHERE user_id = (
  SELECT id FROM users WHERE email = 'your-email@example.com'
);
*/

