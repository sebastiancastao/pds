# 🐛 Debug MFA Redirect Issue

## Issue
You say `mfa_enabled = TRUE` in the database, but you're still being redirected to `/mfa-setup` instead of `/verify-mfa`.

---

## Steps to Debug

### Step 1: Run the SQL Query

Open Supabase SQL Editor and run this query:

```sql
-- Check your actual database state
SELECT 
  u.email,
  u.is_temporary_password,
  p.mfa_enabled,
  p.mfa_secret IS NOT NULL as has_mfa_secret,
  p.backup_codes IS NOT NULL as has_backup_codes,
  CASE 
    WHEN u.is_temporary_password = true THEN 'Will redirect to /password'
    WHEN p.mfa_enabled = true THEN 'Will redirect to /verify-mfa'
    WHEN p.mfa_enabled = false OR p.mfa_enabled IS NULL THEN 'Will redirect to /mfa-setup'
  END as expected_behavior
FROM users u
LEFT JOIN profiles p ON u.id = p.user_id
WHERE u.email = 'sebastiancastao379@gmail.com';
```

**What to look for:**
- ✅ `mfa_enabled` should be `true` (not `false`, not `null`)
- ✅ `has_mfa_secret` should be `true`
- ✅ `has_backup_codes` should be `true`
- ✅ `expected_behavior` should say "Will redirect to /verify-mfa"

---

### Step 2: Check Browser Console Logs

1. **Open browser DevTools** (F12)
2. **Go to Console tab**
3. **Clear the console**
4. **Logout completely**
5. **Login again**
6. **Look for these debug messages:**

#### At Login Page:
```
🔍 [DEBUG] Checking if MFA is enabled...
🔍 [DEBUG] User ID: c14e61fc-8e0d-434e-aa31-68ac920950b6
🔍 [DEBUG] Profile query result: {
  profileData: { mfa_enabled: ??? },
  mfa_enabled: ???,
  mfa_enabled_type: "???",
  mfa_enabled_value: "???",
  profileError: ???,
  hasProfile: ???
}
```

**What you should see if MFA is enabled:**
```javascript
mfa_enabled: true           // ✅ Should be boolean true
mfa_enabled_type: "boolean" // ✅ Should be "boolean"
mfa_enabled_value: "true"   // ✅ Should be string "true"
hasProfile: true            // ✅ Should be true
profileError: null          // ✅ Should be null
```

**What causes redirect to /mfa-setup:**
```javascript
mfa_enabled: false          // ❌ Wrong!
// OR
mfa_enabled: null           // ❌ Wrong!
// OR
hasProfile: false           // ❌ No profile record!
// OR
profileError: { ... }       // ❌ Query failed!
```

---

### Step 3: Check MFA Setup Page (If You Still See It)

If you're redirected to `/mfa-setup`, check console for:

```
[DEBUG] MFA Setup - Checking if MFA already enabled...
[DEBUG] MFA Setup - User ID: c14e61fc-8e0d-434e-aa31-68ac920950b6
[DEBUG] MFA Setup - Profile check: {
  profileData: { mfa_enabled: ??? },
  mfaEnabled: ???,
  mfaEnabled_type: "???",
  mfaEnabled_value: "???",
  hasMfaSecret: ???,
  error: ???
}
```

**If MFA is truly enabled, you should see:**
```javascript
mfaEnabled: true              // ✅ Then redirects to /verify-mfa
```

**If you see this, it means MFA is NOT enabled:**
```javascript
mfaEnabled: false             // ❌ Still needs setup
// OR
mfaEnabled: null              // ❌ Still needs setup
```

---

## Possible Issues and Solutions

### Issue 1: Profile Record Doesn't Exist
**Symptoms:**
- `hasProfile: false`
- `profileError: "No rows found"`

**Solution:**
```sql
-- Check if profile exists
SELECT * FROM profiles WHERE user_id = (
  SELECT id FROM users WHERE email = 'sebastiancastao379@gmail.com'
);

-- If no results, create profile
INSERT INTO profiles (user_id, mfa_enabled)
VALUES (
  (SELECT id FROM users WHERE email = 'sebastiancastao379@gmail.com'),
  false
);
```

---

### Issue 2: mfa_enabled is NULL
**Symptoms:**
- `mfa_enabled: null`

**Solution:**
```sql
-- Set mfa_enabled to false to start fresh
UPDATE profiles
SET mfa_enabled = false
WHERE user_id = (
  SELECT id FROM users WHERE email = 'sebastiancastao379@gmail.com'
);
```

---

### Issue 3: RLS Policy Blocking Query
**Symptoms:**
- `profileError: "PGRST116"` or "No rows found"
- But SQL Editor shows record exists

**Check RLS Policies:**
```sql
-- Check current RLS policies
SELECT * FROM pg_policies WHERE tablename = 'profiles';

-- Temporarily disable RLS to test (NOT recommended for production)
-- ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
```

**Proper Solution:**
Ensure profiles table has a policy like:
```sql
CREATE POLICY "Users can read own profile"
ON profiles FOR SELECT
USING (auth.uid() = user_id);
```

---

### Issue 4: Type Mismatch
**Symptoms:**
- `mfa_enabled_type: "string"` instead of `"boolean"`

**Solution:**
```sql
-- Check column type
SELECT data_type FROM information_schema.columns
WHERE table_name = 'profiles' AND column_name = 'mfa_enabled';

-- Should be: boolean

-- If it's text/varchar, fix it:
ALTER TABLE profiles 
ALTER COLUMN mfa_enabled TYPE boolean 
USING mfa_enabled::boolean;
```

---

### Issue 5: Cached State
**Symptoms:**
- Database shows `true`
- Console logs show `false` or `null`

**Solution:**
1. **Hard refresh:** Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)
2. **Clear all site data:**
   - DevTools → Application → Clear storage → Clear site data
3. **Try incognito/private window**
4. **Check Supabase client cache** (usually not the issue)

---

## What to Do Next

1. **Run the SQL query** from Step 1 and **share the results**

2. **Check browser console** during login and **share the debug logs**

3. **Based on the output, we can identify:**
   - Is the database value actually `true`?
   - Is the query returning the correct value?
   - Is there an RLS issue?
   - Is there a type mismatch?

---

## Expected Correct Flow

```
1. Login with email + password
   ↓
2. Query: SELECT mfa_enabled FROM profiles WHERE user_id = ?
   ↓
3. Result: mfa_enabled = TRUE
   ↓
4. Login page: Redirects to /verify-mfa
   ↓
5. Verify-mfa page: Shows code entry form
   ↓
6. Enter code from authenticator app
   ↓
7. Success: Redirects to home page
```

---

## Quick Test Commands

```sql
-- 1. Check actual database value
SELECT mfa_enabled FROM profiles 
WHERE user_id = (SELECT id FROM users WHERE email = 'sebastiancastao379@gmail.com');

-- 2. Force set to true (if you're sure MFA is set up)
UPDATE profiles
SET mfa_enabled = true
WHERE user_id = (SELECT id FROM users WHERE email = 'sebastiancastao379@gmail.com');

-- 3. Verify it was set
SELECT mfa_enabled, mfa_secret IS NOT NULL as has_secret
FROM profiles 
WHERE user_id = (SELECT id FROM users WHERE email = 'sebastiancastao379@gmail.com');
```

---

**Please share the output from the SQL query and browser console logs so we can identify the exact issue!**











