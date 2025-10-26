# 🔧 Fix: Duplicate Profiles Causing MFA Redirect Issue

## Issue Identified ✅

Your console logs show this error:
```
error: "Cannot coerce the result to a single JSON object"
```

**This means:** You have **MULTIPLE profile records** with the same `user_id` in the database.

**Why this breaks:** The code uses `.single()` which expects exactly ONE result. When it finds multiple records, it fails and returns `null`, making the system think you have no profile.

---

## Step-by-Step Fix

### Step 1: Check How Many Profiles You Have

Run this in Supabase SQL Editor:

```sql
SELECT 
  id,
  user_id,
  mfa_enabled,
  mfa_secret IS NOT NULL as has_secret,
  created_at
FROM profiles
WHERE user_id = 'c14e61fc-8e0d-434e-aa31-68ac920950b6'
ORDER BY created_at DESC;
```

**Expected Result:** You'll see **2 or more rows** (that's the problem!)

---

### Step 2: Identify Which Profile to Keep

Look at the results from Step 1:

**Scenario A: One has MFA setup, others don't**
- Keep the one with `mfa_enabled = true` and `has_secret = true`

**Scenario B: Multiple have MFA setup**
- Keep the newest one (latest `created_at`)

**Scenario C: None have MFA setup**
- Keep the newest one

---

### Step 3: Delete Duplicate Profiles

**Option 1: Keep the NEWEST profile** (Recommended if no MFA is set up yet)

```sql
-- Delete all except the newest
DELETE FROM profiles
WHERE user_id = 'c14e61fc-8e0d-434e-aa31-68ac920950b6'
AND id NOT IN (
  SELECT id FROM profiles
  WHERE user_id = 'c14e61fc-8e0d-434e-aa31-68ac920950b6'
  ORDER BY created_at DESC
  LIMIT 1
);
```

**Option 2: Keep the one with MFA enabled** (If one has MFA set up)

```sql
-- Delete all except the one with MFA
DELETE FROM profiles
WHERE user_id = 'c14e61fc-8e0d-434e-aa31-68ac920950b6'
AND id NOT IN (
  SELECT id FROM profiles
  WHERE user_id = 'c14e61fc-8e0d-434e-aa31-68ac920950b6'
  AND mfa_enabled = true
  ORDER BY created_at DESC
  LIMIT 1
);
```

---

### Step 4: Verify Only One Profile Remains

```sql
SELECT COUNT(*) as profile_count
FROM profiles
WHERE user_id = 'c14e61fc-8e0d-434e-aa31-68ac920950b6';
```

**Expected:** `profile_count: 1`

---

### Step 5: Check the Remaining Profile

```sql
SELECT 
  user_id,
  mfa_enabled,
  mfa_secret IS NOT NULL as has_secret,
  backup_codes IS NOT NULL as has_codes
FROM profiles
WHERE user_id = 'c14e61fc-8e0d-434e-aa31-68ac920950b6';
```

**If `mfa_enabled = true`:**
- ✅ You're done! Try logging in again → should redirect to `/verify-mfa`

**If `mfa_enabled = false` or `null`:**
- You need to complete MFA setup
- Login will redirect to `/mfa-setup` (this is correct behavior)
- Complete all 3 steps to enable MFA

---

### Step 6: Prevent Duplicates in the Future

```sql
-- Add unique constraint
ALTER TABLE profiles 
ADD CONSTRAINT profiles_user_id_unique UNIQUE (user_id);
```

This ensures you can never have duplicate profiles again!

---

## After Fixing

### Test the Flow:

1. **Logout completely**
2. **Login again**
3. **Expected behavior:**

If `mfa_enabled = true`:
```
Login → /verify-mfa → Enter code → Home page ✅
```

If `mfa_enabled = false`:
```
Login → /mfa-setup → Complete 3 steps → /register → Home page ✅
```

---

## Why Did This Happen?

Possible causes:
1. Multiple registrations for the same user
2. Race condition during profile creation
3. Manual database inserts
4. Migration script ran multiple times

The unique constraint in Step 6 prevents this from happening again.

---

## Quick Fix (If You're Sure MFA is Not Set Up)

If you just want to start fresh:

```sql
-- Delete ALL profiles for this user
DELETE FROM profiles
WHERE user_id = 'c14e61fc-8e0d-434e-aa31-68ac920950b6';

-- Create ONE new profile
INSERT INTO profiles (user_id, mfa_enabled)
VALUES ('c14e61fc-8e0d-434e-aa31-68ac920950b6', false);

-- Add unique constraint to prevent duplicates
ALTER TABLE profiles 
ADD CONSTRAINT profiles_user_id_unique UNIQUE (user_id);
```

Then login and complete MFA setup from scratch.

---

## Summary

1. ✅ **Issue Found:** Multiple profile records
2. ✅ **Error:** "Cannot coerce the result to a single JSON object"
3. ✅ **Fix:** Delete duplicates, keep one profile
4. ✅ **Prevention:** Add unique constraint
5. ✅ **Next:** Login and complete MFA setup

After running the fix, the system will work correctly! 🎉











