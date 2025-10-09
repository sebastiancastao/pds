# 🐛 Debug Guide: Temporary Password Redirect Issue

## Problem
Users with temporary passwords are being redirected to `/` (home) instead of `/register` (password change page).

## Debug Code Added
Comprehensive console logging has been added to `app/login/page.tsx` to track the entire authentication flow.

---

## 📋 How to Test with Debug Logs

### Step 1: Start Dev Server
```bash
npm run dev
```

### Step 2: Open Browser Console
- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+I`
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- Go to the **Console** tab

### Step 3: Login with Test User
1. Go to: http://localhost:3000/login
2. Enter credentials of user with temporary password
3. Click "Sign In"

### Step 4: Watch Console Output

You'll see detailed logs like this:

```
🔍 [DEBUG] Step 1: Fetching user data from public.users table...
🔍 [DEBUG] Email being checked: test@example.com
🔍 [DEBUG] User data query result: {
  found: true,
  error: null,
  userData: {
    id: "abc123...",
    email: "test@example.com",
    is_active: true,
    is_temporary_password: true,  ← CHECK THIS VALUE
    failed_attempts: 0
  }
}

🔍 [DEBUG] Step 2: Attempting Supabase authentication...
🔍 [DEBUG] Authentication result: {
  success: true,
  userId: "abc123...",
  email: "test@example.com"
}

═══════════════════════════════════════
🔍 [DEBUG] AUTHENTICATION SUCCESSFUL
═══════════════════════════════════════
User ID: abc123...
User Email: test@example.com
-----------------------------------
Initial userData (Step 1):
  - is_temporary_password: true     ← VALUE FROM INITIAL QUERY
  - Type: boolean
-----------------------------------
Current userData (Step 4):
  - is_temporary_password: true     ← VALUE FROM RE-FETCH
  - must_change_password: false
  - Type: boolean
-----------------------------------
Redirect Decision:
  - Checking: currentUserData?.is_temporary_password === true
  - Result: true                    ← THIS SHOULD BE TRUE
  - Will redirect to: /register     ← THIS IS WHERE IT GOES
═══════════════════════════════════════

🔍 [DEBUG] Step 7: Making redirect decision...
🔍 [DEBUG] Checking conditions:
  1. currentUserData exists? true
  2. is_temporary_password value: true
  3. Strict equality (=== true): true
  4. Loose equality (== true): true
  5. Truthy check: true

🔄 [DEBUG] ✅ REDIRECTING TO /register (temporary password detected)
🔄 [DEBUG] User must change their temporary password
```

---

## 🔍 What to Look For

### ✅ **Expected Behavior (Working Correctly)**

If temporary password redirect is working:
- Step 1 shows: `is_temporary_password: true`
- Step 4 shows: `is_temporary_password: true`
- Redirect Decision shows: `Result: true`
- Final message: "REDIRECTING TO /register"
- Browser redirects to `/register` page

### ❌ **Problem Indicators**

#### **Problem 1: is_temporary_password is FALSE in Database**
```
Initial userData (Step 1):
  - is_temporary_password: false    ← PROBLEM!
```
**Cause:** User was created but `is_temporary_password` flag was not set correctly.

**Fix:** Update user in database:
```sql
UPDATE users 
SET is_temporary_password = true 
WHERE email = 'test@example.com';
```

#### **Problem 2: is_temporary_password is NULL**
```
Initial userData (Step 1):
  - is_temporary_password: null     ← PROBLEM!
  - Type: object
```
**Cause:** Field not set during user creation.

**Fix:** Update user in database:
```sql
UPDATE users 
SET is_temporary_password = true 
WHERE email = 'test@example.com';
```

#### **Problem 3: Re-fetch Returns Different Value**
```
Initial userData (Step 1):
  - is_temporary_password: true     ← Good

Current userData (Step 4):
  - is_temporary_password: false    ← Changed!
```
**Cause:** Race condition - value changed between queries (unlikely but possible).

**Fix:** Check if any other process is modifying the user record.

#### **Problem 4: currentUserData is NULL**
```
Current userData (Step 4):
  - is_temporary_password: undefined ← PROBLEM!

🔍 [DEBUG] Re-fetch result: {
  success: false,
  error: { code: "PGRST116" },      ← User not found
}
```
**Cause:** User exists in `auth.users` but not in `public.users` (data sync issue).

**Fix:** Verify user exists in both tables:
```sql
-- Check auth.users (via Supabase Dashboard)
-- Check public.users
SELECT id, email, is_temporary_password 
FROM users 
WHERE email = 'test@example.com';
```

#### **Problem 5: Type Mismatch**
```
Initial userData (Step 1):
  - is_temporary_password: "true"   ← STRING instead of BOOLEAN
  - Type: string
```
**Cause:** Column defined as TEXT instead of BOOLEAN.

**Fix:** Check schema and convert:
```sql
-- Check column type
\d users;

-- If wrong type, fix it:
ALTER TABLE users 
ALTER COLUMN is_temporary_password 
TYPE BOOLEAN 
USING is_temporary_password::boolean;
```

#### **Problem 6: Redirect Decision Fails**
```
Redirect Decision:
  - Checking: currentUserData?.is_temporary_password === true
  - Result: false                   ← Even though value is true?
```
**Cause:** Possible type coercion issue or object structure problem.

**Fix:** Check the exact value and type in console.

---

## 🔧 Quick Fixes

### Fix 1: Manually Set Temporary Password Flag

If you have a user that's stuck, run this SQL in Supabase:

```sql
-- Find the user
SELECT id, email, is_temporary_password 
FROM users 
WHERE email = 'your-email@example.com';

-- Update the flag
UPDATE users 
SET is_temporary_password = true,
    must_change_password = true
WHERE email = 'your-email@example.com';

-- Verify the change
SELECT id, email, is_temporary_password, must_change_password
FROM users 
WHERE email = 'your-email@example.com';
```

### Fix 2: Check User Creation Flow

Verify that when users are created via `/signup`, the flag is set correctly:

```typescript
// In app/api/auth/signup/route.ts
const { data: newUser, error: userError } = await supabase
  .from('users')
  .insert({
    email: email,
    role: role,
    division: division,
    is_active: true,
    is_temporary_password: true,  ← MUST BE SET
    must_change_password: true,   ← MUST BE SET
  })
```

### Fix 3: Verify Database Schema

Check that the column exists and has the correct type:

```sql
-- Check schema
SELECT 
  column_name, 
  data_type, 
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'users' 
  AND column_name IN ('is_temporary_password', 'must_change_password');
```

Expected result:
```
column_name           | data_type | column_default | is_nullable
----------------------|-----------|----------------|------------
is_temporary_password | boolean   | false          | NO
must_change_password  | boolean   | false          | NO
```

---

## 📊 Test Checklist

- [ ] Dev server running
- [ ] Browser console open
- [ ] Test user has `is_temporary_password = true` in database
- [ ] Login attempt shows all debug logs
- [ ] Step 1 shows correct flag value
- [ ] Step 4 re-fetch succeeds
- [ ] Redirect decision is correct
- [ ] User is redirected to `/register`

---

## 🎯 Common Root Causes

1. **Database Flag Not Set** - Most common! User created without setting the flag.
2. **Wrong Data Type** - Column is TEXT instead of BOOLEAN.
3. **RLS Policy Blocking** - Row Level Security prevents reading the field.
4. **User in auth.users but not public.users** - Data sync issue.
5. **Redirect Intercepted** - Middleware or other code interfering with router.push().

---

## 📞 Next Steps

After running login with debug logs:

1. **Copy ALL console logs** and review them
2. **Check the specific values** at each step
3. **Identify which step** shows the incorrect value
4. **Apply the appropriate fix** from this guide
5. **Test again** to verify fix

---

## 🔗 Related Files

- `app/login/page.tsx` - Login flow with debug logs
- `app/signup/page.tsx` - User creation
- `app/api/auth/signup/route.ts` - User creation API
- `database/schema.sql` - Database schema
- `lib/supabase.ts` - Supabase client

---

**Once you identify the issue from the logs, remove the debug statements or comment them out for production!**




