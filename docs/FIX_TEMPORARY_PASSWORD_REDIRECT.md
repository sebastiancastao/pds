# 🔄 Fix: Temporary Password Redirect Issue

## Problem
User with `is_temporary_password = true` was being redirected to `/` instead of `/register` after login.

## Root Cause Analysis

### Console Log Evidence
```
Pre-login check: isTemporaryPassword: true ✅
Step 4 re-fetch: is_temporary_password: undefined ❌ (RLS blocked query)
Redirect decision: Uses undefined value → redirects to / ❌
```

### Why It Failed
1. **Pre-login check** correctly retrieved `isTemporaryPassword: true` (via service role, bypassing RLS)
2. **After authentication**, Step 4 tried to re-fetch user data from `public.users`
3. **RLS still blocked the query** even though user was authenticated (session not yet propagated to client)
4. **Redirect logic** used `currentUserData?.is_temporary_password` (which was `undefined`) instead of the pre-login data

## Solution

### Use Pre-Login Data as Primary Source
The pre-login check already has the correct `isTemporaryPassword` value. We don't need to re-query!

### Updated Redirect Logic
```typescript
// ✅ NEW: Use pre-login data (most reliable)
const isTemporaryPassword = preLoginData?.isTemporaryPassword 
  ?? currentUserData?.is_temporary_password 
  ?? false;

if (isTemporaryPassword === true) {
  router.push('/register'); // ✅ Redirect to password change
} else {
  router.push('/'); // Normal login
}
```

### Previous (Broken) Logic
```typescript
// ❌ OLD: Only used post-auth query (which failed due to RLS)
if (currentUserData?.is_temporary_password === true) {
  router.push('/register');
} else {
  router.push('/');
}
```

## Changes Made

### File: `app/login/page.tsx`

**Line 209:** Added variable for audit logging
```typescript
const tempPasswordStatus = preLoginData?.isTemporaryPassword 
  ?? currentUserData?.is_temporary_password 
  ?? false;
```

**Line 225:** Added variable for redirect decision
```typescript
const isTemporaryPassword = preLoginData?.isTemporaryPassword 
  ?? currentUserData?.is_temporary_password 
  ?? false;
```

**Line 233-240:** Updated redirect logic
```typescript
if (isTemporaryPassword === true) {
  console.log('🔄 REDIRECTING TO /register (temporary password detected)');
  router.push('/register');
} else {
  console.log('🔄 REDIRECTING TO / (normal login)');
  router.push('/');
}
```

## Testing

### Test Case: User with Temporary Password

**Setup:**
```sql
UPDATE public.users 
SET is_temporary_password = true, must_change_password = true 
WHERE email = 'test@example.com';
```

**Expected Behavior:**
1. Login with temporary password
2. Authentication succeeds
3. Console shows: `isTemporaryPassword: true`
4. **Redirects to `/register`** ✅
5. User is prompted to change password

**Actual Result:**
✅ Works as expected!

### Test Case: User with Permanent Password

**Setup:**
```sql
UPDATE public.users 
SET is_temporary_password = false, must_change_password = false 
WHERE email = 'test@example.com';
```

**Expected Behavior:**
1. Login with permanent password
2. Authentication succeeds
3. Console shows: `isTemporaryPassword: false`
4. **Redirects to `/`** ✅
5. User accesses dashboard

**Actual Result:**
✅ Works as expected!

## Why This Approach is Better

### ✅ Advantages
1. **Uses already-fetched data** - No redundant queries
2. **Bypasses RLS timing issues** - Pre-login check uses service role
3. **Fallback mechanism** - Still works if post-auth query succeeds
4. **Performance** - One less database query
5. **Reliability** - Not dependent on session propagation timing

### 🔒 Security Maintained
- Pre-login check already validates user exists
- Only returns minimal account status data
- Rate limited and audited
- Temporary password status is not sensitive (user will know they have one)

## Related Issues

### Why Post-Auth Query Still Fails
Even after successful authentication, the client-side Supabase query to `public.users` can fail because:

1. **Session not yet stored in client** - Takes a few milliseconds to propagate
2. **RLS policy checks `auth.uid()`** - May not be available immediately
3. **Race condition** - Query happens before session is fully established

### Future Improvement (Optional)
Add a small delay before post-auth query:
```typescript
// Wait for session to propagate
await new Promise(resolve => setTimeout(resolve, 100));

const { data: currentUserData } = await supabase
  .from('users')
  .select('is_temporary_password')
  .eq('id', authData.user.id)
  .single();
```

But this is **not necessary** since we already have the data from pre-login check!

## Summary

✅ **Problem:** Redirect logic used undefined value from failed post-auth query  
✅ **Solution:** Use reliable pre-login data with fallback chain  
✅ **Result:** Temporary password users now correctly redirect to `/register`  
✅ **Security:** No impact - all checks maintained  
✅ **Performance:** Actually improved (one less query needed)

---

**Status:** ✅ Fixed  
**Date:** October 6, 2025  
**Files Modified:** `app/login/page.tsx`

