# 🔧 MFA Setup Troubleshooting

## Issue: "I scanned the QR code but still being redirected to /mfa-setup"

### Why This Happens

The MFA setup process has **3 required steps**:

1. ✅ **Scan QR Code** - You did this
2. ❌ **Enter Verification Code** - You need to do this
3. ❌ **Save Backup Codes** - You need to do this

**Important:** Only after completing ALL 3 steps is `mfa_enabled` set to `true` in the database.

### The Problem

Every time you visit `/mfa-setup`, the system generates a **NEW** secret and QR code. This means:

- ❌ The QR code you scanned before is now **invalid**
- ❌ The entry in your authenticator app won't work anymore
- ❌ You need to scan the new QR code that's shown now

### The Solution

**Option 1: Complete the setup from scratch (Recommended)**

1. Go to `/mfa-setup` (you'll be redirected there automatically on login)
2. **Delete the old entry** from your authenticator app (Google Authenticator, Authy, etc.)
3. **Scan the NEW QR code** shown on the page
4. Click "Continue to Verification"
5. **Enter the 6-digit code** from your authenticator app
6. **Download or copy the 8 backup codes**
7. Click "Complete Setup"
8. ✅ Now `mfa_enabled = true` in the database

**Next login:** You'll be redirected to `/verify-mfa` instead of `/mfa-setup`

---

**Option 2: Use the existing entry in your authenticator app**

If you still have the entry from your previous scan and don't want to scan again:

1. Go to `/mfa-setup`
2. You'll see a new QR code - **IGNORE IT**
3. Note the **secret code** shown below the QR code
4. Compare it with the secret in your authenticator app
5. If they're **different**, you MUST scan the new QR code
6. If they're the **same** (unlikely), click "Continue to Verification"
7. Enter the code and complete steps 5-8 above

---

## How to Check Your MFA Status

Run this query in Supabase SQL Editor:

```sql
SELECT 
  u.email,
  p.mfa_enabled,
  p.mfa_secret IS NOT NULL as has_secret,
  CASE 
    WHEN p.mfa_enabled = true THEN 'MFA fully enabled - will go to /verify-mfa'
    WHEN p.mfa_secret IS NOT NULL AND p.mfa_enabled = false THEN 'Secret exists but not verified - complete /mfa-setup'
    ELSE 'No MFA setup - start at /mfa-setup'
  END as status
FROM users u
LEFT JOIN profiles p ON u.id = p.user_id
WHERE u.email = 'your-email@example.com'; -- Replace with your email
```

---

## Expected Flow After Fix

### First Time (Now):
```
Login → /mfa-setup → Complete all 3 steps → /register → /
```

### All Future Logins:
```
Login → /verify-mfa → Enter code → /
```

---

## Why MFA Setup Must Be Completed in One Go

The MFA setup generates a **new secret every time** you visit the page. This is by design because:

1. **Security:** Old secrets shouldn't persist if setup was abandoned
2. **Simplicity:** Avoids complex state management
3. **Clean slate:** Each attempt starts fresh

**Best Practice:** Complete all 3 steps without leaving the page.

---

## Quick Test After Setup

1. Complete the MFA setup (all 3 steps)
2. Logout completely
3. Login again with email + password
4. You should be redirected to `/verify-mfa` (NOT `/mfa-setup`)
5. Enter the 6-digit code from your authenticator app
6. You should reach the home page (`/`)

If you're redirected to `/mfa-setup` again, it means the setup didn't complete successfully.

---

## Database Fix (Last Resort)

If you've completed all steps but still having issues, check the database:

```sql
-- Check if mfa_enabled is true
SELECT mfa_enabled FROM profiles WHERE user_id = (
  SELECT id FROM users WHERE email = 'your-email@example.com'
);

-- If it returns false, the verification step failed
-- You need to go through /mfa-setup again and complete all 3 steps
```

**Do NOT manually set `mfa_enabled = true`** without completing the verification. This will break the MFA system because:
- You won't have valid backup codes
- The system won't have verified your authenticator app works
- You might get locked out

---

## Summary

**What you need to do NOW:**

1. Login to the system
2. You'll be redirected to `/mfa-setup`
3. **Delete the old PDS entry** from your authenticator app
4. **Scan the NEW QR code**
5. **Complete ALL 3 steps** without leaving
6. Next login will go to `/verify-mfa` ✅

The QR code you scanned before is now invalid. You need to scan the new one and complete the entire setup process.




