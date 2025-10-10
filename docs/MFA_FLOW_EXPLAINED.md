# 🔐 MFA Flow - Step by Step Explanation

## The Two Different MFA Pages

### 1. `/mfa-setup` (First Time Only)
**Purpose:** Set up MFA for the first time  
**When:** User has `mfa_enabled = false` or `null`  
**What happens:**
- Generate QR code
- User scans with authenticator app
- User verifies by entering code
- System saves MFA secret and enables MFA
- User gets 8 backup codes

**Result:** `mfa_enabled` → `true` in database

---

### 2. `/verify-mfa` (Every Login After Setup)
**Purpose:** Verify identity on each login  
**When:** User has `mfa_enabled = true`  
**What happens:**
- User enters code from authenticator app
- System verifies code
- Sets session flag `mfa_verified = true`
- Grants access to home page

**Result:** User can access protected resources for this session

---

## Complete Flow for Normal Password Users

### First Login (MFA Not Set Up):
```
1. Enter email + password at /login
2. ✅ Authentication succeeds
3. System checks: mfa_enabled = FALSE
4. ➡️ Redirect to /mfa-setup
5. User scans QR code with Google Authenticator/Authy
6. User enters verification code
7. System sets mfa_enabled = TRUE
8. User saves 8 backup codes
9. ➡️ Redirect to /register (complete profile)
10. ➡️ Redirect to / (home page)
```

### All Future Logins (MFA Already Set Up):
```
1. Enter email + password at /login
2. ✅ Authentication succeeds
3. System checks: mfa_enabled = TRUE
4. ➡️ Redirect to /verify-mfa
5. User enters code from authenticator app
6. ✅ Code verified
7. sessionStorage.mfa_verified = 'true'
8. ➡️ Redirect to / (home page)
```

---

## Why You're Being Redirected to /mfa-setup

**If you're seeing `/mfa-setup` after login, it means:**

✅ Your authentication (email + password) succeeded  
❌ Your account doesn't have MFA set up yet (`mfa_enabled = false`)  
➡️ You need to complete MFA setup first

**After you complete the setup:**
- Database will have `mfa_enabled = true`
- Next login will go to `/verify-mfa` instead
- You'll enter the code from your authenticator app
- Then you'll get access to the system

---

## To Check Your Account Status

Run this SQL query in Supabase:

```sql
SELECT 
  u.email,
  u.is_temporary_password,
  p.mfa_enabled,
  CASE 
    WHEN u.is_temporary_password = true THEN 'Will redirect to /password'
    WHEN p.mfa_enabled = true THEN 'Will redirect to /verify-mfa'
    WHEN p.mfa_enabled = false OR p.mfa_enabled IS NULL THEN 'Will redirect to /mfa-setup'
  END as expected_behavior
FROM users u
LEFT JOIN profiles p ON u.id = p.user_id
WHERE u.email = 'your-email@example.com';
```

---

## Testing Steps

### Test 1: First Time MFA Setup
1. Login with normal password
2. Should redirect to `/mfa-setup`
3. Scan QR code with Google Authenticator
4. Enter code and save backup codes
5. Complete profile registration
6. Should reach home page

### Test 2: Subsequent Logins
1. Logout completely
2. Login with same credentials
3. Should redirect to `/verify-mfa` (NOT `/mfa-setup`)
4. Enter code from authenticator app
5. Should reach home page

---

## Authenticator Apps You Can Use

- Google Authenticator (iOS/Android)
- Microsoft Authenticator (iOS/Android)
- Authy (iOS/Android/Desktop)
- 1Password (with TOTP support)
- LastPass Authenticator

All of these generate 6-digit codes that change every 30 seconds.

---

## Summary

| Page | Purpose | When Shown |
|------|---------|------------|
| `/mfa-setup` | Set up MFA for first time | `mfa_enabled = false` |
| `/verify-mfa` | Verify MFA on each login | `mfa_enabled = true` |

**Both pages already exist in your codebase!**

The system automatically decides which page to show based on your account's MFA status.






