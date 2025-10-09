# Fix: Home Page Redirecting to MFA-Setup

## Issue Summary
When users tried to access the home page (`/`), they were being redirected to `/mfa-setup` instead of being allowed to view the page.

---

## Root Cause

The home page (`app/page.tsx`) had legacy logic that checked if users had an MFA secret set up. If no MFA secret was found, it redirected users to `/mfa-setup`:

```typescript
// OLD CODE (lines 44-75)
const { data: profileDataArray } = await supabase
  .from('profiles')
  .select('mfa_secret')
  .eq('user_id', user.id)
  .order('created_at', { ascending: false })
  .limit(1);

const profileData = profileDataArray?.[0] || null;

if (profileData?.mfa_secret) {
  // Check if verified in session
  const mfaVerified = sessionStorage.getItem('mfa_verified');
  if (!mfaVerified) {
    router.push('/verify-mfa');
    return;
  }
} else {
  // ❌ PROBLEM: Always redirects to /mfa-setup
  console.log('[DEBUG] Home - No MFA secret, redirecting to /mfa-setup');
  router.push('/mfa-setup');
  return;
}
```

**The Issue:**
- The home page queried the database for MFA secrets
- If no secret found → redirect to `/mfa-setup`
- This prevented authenticated users from accessing the home page
- Inconsistent with the new auth flow (login → verify-mfa)

---

## Fix Applied

### Simplified Home Page Logic

**File:** `app/page.tsx`

#### Before:
```typescript
// Complex logic checking for MFA secret in database
const { data: profileDataArray } = await supabase
  .from('profiles')
  .select('mfa_secret')
  .eq('user_id', user.id)
  .order('created_at', { ascending: false })
  .limit(1);

const profileData = profileDataArray?.[0] || null;

if (profileData?.mfa_secret) {
  const mfaVerified = sessionStorage.getItem('mfa_verified');
  if (!mfaVerified) {
    router.push('/verify-mfa');
    return;
  }
} else {
  router.push('/mfa-setup');  // ❌ Unwanted redirect
  return;
}
```

#### After:
```typescript
// Simple session-based check
const mfaVerified = sessionStorage.getItem('mfa_verified');
console.log('[DEBUG] Home - MFA verified in session:', mfaVerified);

if (!mfaVerified) {
  console.log('[DEBUG] Home - MFA not verified for this session, redirecting to /verify-mfa');
  router.push('/verify-mfa');
  return;
}

// If mfaVerified = 'true', show home page ✅
```

**Changes:**
1. ✅ Removed database query for MFA secret
2. ✅ Removed redirect to `/mfa-setup`
3. ✅ Simplified to only check session storage
4. ✅ Only redirects to `/verify-mfa` if MFA not verified in session

---

## Updated Authentication Flow

### Complete Flow After All Fixes:

```
┌─────────────────┐
│   User Login    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Authenticate   │
└────────┬────────┘
         │
         ▼
   ┌─────────────┐
   │ Temp Pass?  │
   └──┬──────┬───┘
      │      │
     Yes    No
      │      │
      ▼      ▼
 ┌────────┐ ┌───────────┐
 │/password│ │/verify-mfa│
 └────────┘ └─────┬─────┘
                  │
                  ▼
            ┌──────────────┐
            │ Verify MFA   │
            │ code/token   │
            └──────┬───────┘
                   │
                   ▼ (set mfa_verified = true in sessionStorage)
              ┌────────┐
              │   /    │ ← Home page
              │  Home  │
              └────────┘
```

### Home Page Access Rules:

1. **Not authenticated** → Show public home page
2. **Has temporary password** → Redirect to `/password`
3. **MFA not verified in session** → Redirect to `/verify-mfa`
4. **MFA verified in session** → Show authenticated home page ✅

---

## Benefits

### 1. **Consistent Flow**
- No more redirects to `/mfa-setup` from home page
- Matches the login flow (login → verify-mfa → home)
- Predictable user experience

### 2. **Simplified Logic**
- Removed database query (faster)
- No more checking for MFA secrets
- Single source of truth: `sessionStorage.getItem('mfa_verified')`

### 3. **Better Performance**
- One less database query on every home page load
- Faster page rendering
- Reduced database load

### 4. **Session-Based Security**
- MFA verification required for each session
- Session expires = must verify MFA again
- Secure by default

---

## Session Storage Management

### When is `mfa_verified` set?

**Location:** `app/verify-mfa/page.tsx` (line 96)

```typescript
// After successful MFA verification
if (response.ok && !data.error) {
  console.log('[DEBUG] MFA verified successfully, setting session flag');
  sessionStorage.setItem('mfa_verified', 'true');
  router.push('/');  // Redirect to home
}
```

### When is `mfa_verified` cleared?

**Location:** `app/page.tsx` (line 82)

```typescript
const handleLogout = async () => {
  sessionStorage.removeItem('mfa_verified');  // Clear on logout
  await supabase.auth.signOut();
  router.push('/login');
};
```

**Also cleared automatically:**
- When user closes the browser (sessionStorage is session-only)
- When user opens the app in a new tab (separate sessionStorage)
- When session expires

---

## Testing Checklist

### Test Case 1: Direct Access to Home Page (Not Authenticated)
1. ✅ Open browser
2. ✅ Navigate to `/`
3. ✅ Should show **public home page** with "Secure Login" button
4. ✅ Should NOT redirect

### Test Case 2: Access Home Page After Login (MFA Not Verified)
1. ✅ Log in successfully
2. ✅ Should redirect to `/verify-mfa`
3. ✅ Navigate directly to `/` (without verifying MFA)
4. ✅ Should redirect back to `/verify-mfa`

### Test Case 3: Access Home Page After MFA Verification
1. ✅ Log in successfully
2. ✅ Verify MFA on `/verify-mfa` page
3. ✅ Should redirect to `/` automatically
4. ✅ Should show **authenticated home page** with user email
5. ✅ Should NOT redirect to `/mfa-setup`

### Test Case 4: Access Home Page with Temporary Password
1. ✅ Log in with temporary password
2. ✅ Should redirect to `/password`
3. ✅ Navigate directly to `/`
4. ✅ Should redirect back to `/password`

### Test Case 5: Session Expiry
1. ✅ Log in and verify MFA
2. ✅ Access home page (should work)
3. ✅ Close browser and reopen
4. ✅ Navigate to `/`
5. ✅ Should redirect to `/verify-mfa` (session expired)

---

## Browser Console Output (Expected)

### Authenticated User with MFA Verified:
```
[DEBUG] Home - Checking authentication and MFA status...
[DEBUG] Home - User authenticated: c14e61fc-8e0d-434e-aa31-68ac920950b6
[DEBUG] Home - MFA verified in session: true
[DEBUG] Home - All checks passed, showing authenticated home page
```

### Authenticated User without MFA Verified:
```
[DEBUG] Home - Checking authentication and MFA status...
[DEBUG] Home - User authenticated: c14e61fc-8e0d-434e-aa31-68ac920950b6
[DEBUG] Home - MFA verified in session: null
[DEBUG] Home - MFA not verified for this session, redirecting to /verify-mfa
```

### Non-Authenticated User:
```
[DEBUG] Home - Checking authentication and MFA status...
[DEBUG] Home - No user found, showing public home page
```

---

## Code Changes Summary

### Removed:
- ❌ Database query to check for MFA secret
- ❌ Conditional logic checking if MFA secret exists
- ❌ Redirect to `/mfa-setup`
- ❌ Complex branching logic

### Kept:
- ✅ Check for temporary password
- ✅ Session storage check for MFA verification
- ✅ Redirect to `/verify-mfa` if not verified
- ✅ Authenticated vs public home page distinction

### Lines Changed:
- **Before:** Lines 44-75 (32 lines of complex logic)
- **After:** Lines 44-52 (8 lines of simple logic)
- **Net Reduction:** 24 lines removed

---

## Related Documentation

- See `docs/REMOVE_MFA_SETUP_REDIRECT.md` - Removed MFA setup redirects from login flow
- See `docs/FIX_VERIFY_MFA_SESSION_ISSUE.md` - Fixed session persistence issue
- See `docs/MFA_PROFILE_RETRIEVAL_FIX.md` - Fixed profile retrieval issues
- See `docs/COMPLETE_AUTH_FLOW.md` - Complete authentication flow documentation

---

## Summary

### Problem:
- Home page redirected to `/mfa-setup` when no MFA secret found
- Prevented users from accessing home page
- Inconsistent with login flow

### Solution:
- Removed MFA secret checking logic
- Removed redirect to `/mfa-setup`
- Use session-based `mfa_verified` flag only
- Redirect to `/verify-mfa` if not verified, otherwise show home page

### Result:
- ✅ Users can access home page after MFA verification
- ✅ No unwanted redirects to `/mfa-setup`
- ✅ Consistent auth flow: login → verify-mfa → home
- ✅ Simpler, faster code

---

**Status:** ✅ Fixed and tested
**Date:** October 7, 2025
**Impact:** Home page no longer redirects to `/mfa-setup`

