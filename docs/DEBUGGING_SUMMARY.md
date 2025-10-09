# 🔍 Debugging Summary - MFA Redirect Issue

## What I Added

I've added comprehensive debugging to help identify why you're being redirected to `/mfa-setup` instead of `/verify-mfa` even though you say `mfa_enabled = TRUE` in the database.

---

## Files Modified

### 1. `app/login/page.tsx`
Added detailed console logging to show:
- User ID
- Raw profile data from database
- Exact value of `mfa_enabled`
- Type of `mfa_enabled` (should be `boolean`)
- JSON stringified value
- Any errors from the database query

### 2. `app/mfa-setup/page.tsx`
Added detailed console logging to show:
- User ID
- Raw profile data
- MFA enabled status
- Whether MFA secret exists
- Any database errors
- Clear indication of redirect decision

### 3. `database/debug_mfa_status.sql`
SQL queries to check your actual database state

### 4. `docs/DEBUG_MFA_REDIRECT.md`
Comprehensive debugging guide with all possible issues and solutions

---

## What To Do Now

### Step 1: Check Your Database

Run this query in Supabase SQL Editor:

```sql
SELECT 
  u.email,
  p.mfa_enabled,
  p.mfa_secret IS NOT NULL as has_secret,
  p.backup_codes IS NOT NULL as has_codes
FROM users u
LEFT JOIN profiles p ON u.id = p.user_id
WHERE u.email = 'sebastiancastao379@gmail.com';
```

**Expected if MFA is enabled:**
- `mfa_enabled`: `true` (boolean, not string)
- `has_secret`: `true`
- `has_codes`: `true`

---

### Step 2: Test the Login Flow

1. **Open browser DevTools** (Press F12)
2. **Go to Console tab**
3. **Clear the console**
4. **Logout completely**
5. **Login again** with your email and password
6. **Watch the console output**

---

### Step 3: Share the Debug Output

Look for these messages in the console:

#### From Login Page:
```
🔍 [DEBUG] Checking if MFA is enabled...
🔍 [DEBUG] User ID: c14e61fc-8e0d-434e-aa31-68ac920950b6
🔍 [DEBUG] Profile query result: {
  profileData: { ... },
  mfa_enabled: ???,          ← IMPORTANT: What value is this?
  mfa_enabled_type: "???",   ← IMPORTANT: Should be "boolean"
  mfa_enabled_value: "???",  ← IMPORTANT: Should be "true"
  profileError: ???,         ← IMPORTANT: Should be null
  hasProfile: ???            ← IMPORTANT: Should be true
}
```

#### Expected Values if MFA is Enabled:
```javascript
mfa_enabled: true
mfa_enabled_type: "boolean"
mfa_enabled_value: "true"
profileError: null
hasProfile: true
```

#### If Still Redirected to /mfa-setup:
```
[DEBUG] MFA Setup - Checking if MFA already enabled...
[DEBUG] MFA Setup - User ID: c14e61fc-8e0d-434e-aa31-68ac920950b6
[DEBUG] MFA Setup - Profile check: {
  profileData: { ... },
  mfaEnabled: ???,          ← What is this?
  mfaEnabled_type: "???",
  mfaEnabled_value: "???",
  hasMfaSecret: ???,
  error: ???
}
```

---

## Possible Issues

### Issue A: mfa_enabled is actually FALSE or NULL
**Symptoms:** Console shows `mfa_enabled: false` or `mfa_enabled: null`  
**Solution:** Complete the MFA setup properly (all 3 steps)

### Issue B: Profile record doesn't exist
**Symptoms:** Console shows `hasProfile: false` or `profileError: "No rows found"`  
**Solution:** Create profile record manually or through registration

### Issue C: RLS Policy blocking the query
**Symptoms:** Console shows `profileError: "PGRST116"` but SQL Editor shows record exists  
**Solution:** Check RLS policies on profiles table

### Issue D: Type mismatch
**Symptoms:** Console shows `mfa_enabled_type: "string"` instead of `"boolean"`  
**Solution:** Fix database column type

### Issue E: Cached old data
**Symptoms:** Database shows `true`, console shows `false`  
**Solution:** Hard refresh (Ctrl+Shift+R) or try incognito

---

## Quick Verification

Run these commands in Supabase SQL Editor:

```sql
-- 1. Check if profile exists
SELECT COUNT(*) FROM profiles 
WHERE user_id = (SELECT id FROM users WHERE email = 'sebastiancastao379@gmail.com');
-- Should return: 1

-- 2. Check actual mfa_enabled value
SELECT mfa_enabled, pg_typeof(mfa_enabled) as type
FROM profiles
WHERE user_id = (SELECT id FROM users WHERE email = 'sebastiancastao379@gmail.com');
-- Should return: true, boolean

-- 3. Check if MFA is fully set up
SELECT 
  mfa_enabled,
  mfa_secret IS NOT NULL as has_secret,
  backup_codes IS NOT NULL as has_codes
FROM profiles
WHERE user_id = (SELECT id FROM users WHERE email = 'sebastiancastao379@gmail.com');
-- All three should be: true, true, true
```

---

## Next Steps

**Please share:**
1. The SQL query results from Step 1
2. The console debug output from Step 2
3. Any error messages you see

With this information, I can identify the exact issue and provide a specific fix!

---

## If You Need to Force-Enable MFA

⚠️ **Only do this if you're SURE MFA is properly set up** (you have the authenticator app entry)

```sql
-- Force enable MFA (DANGER: Only if you have authenticator app set up!)
UPDATE profiles
SET mfa_enabled = true
WHERE user_id = (SELECT id FROM users WHERE email = 'sebastiancastao379@gmail.com')
AND mfa_secret IS NOT NULL
AND backup_codes IS NOT NULL;

-- Verify it worked
SELECT mfa_enabled FROM profiles
WHERE user_id = (SELECT id FROM users WHERE email = 'sebastiancastao379@gmail.com');
```

**Important:** Only run this if:
- ✅ You have an entry in your authenticator app
- ✅ The secret in your authenticator matches the database
- ✅ You have backup codes saved somewhere

Otherwise, you'll lock yourself out!



