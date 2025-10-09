# 🔄 Updated MFA Flow - Based on mfa_secret

## Change Summary

**Previous Logic:** Check if `mfa_enabled = true` to redirect to `/verify-mfa`  
**New Logic:** Check if `mfa_secret` exists to redirect to `/verify-mfa`

**Why:** If a user has already scanned the QR code (has `mfa_secret`), they should go to `/verify-mfa` to enter their code, not back to `/mfa-setup` to scan again.

---

## New Flow Logic

### Decision Tree

```
User logs in
    ↓
Has temporary password?
    ├─ YES → /password
    └─ NO → Check MFA secret
             ↓
        Has mfa_secret?
             ├─ YES → /verify-mfa (enter code)
             └─ NO → /mfa-setup (scan QR)
```

---

## Detailed Flow

### Scenario 1: First Time User (No MFA Secret)

```
1. Login with email + password ✅
2. Check: mfa_secret = NULL
3. Redirect to /mfa-setup
4. Scan QR code
5. mfa_secret is saved to database
6. Enter verification code
7. Code verified → mfa_enabled = true
8. Save backup codes
9. Redirect to /register
```

**Next login:**
```
1. Login with email + password ✅
2. Check: mfa_secret = EXISTS
3. Redirect to /verify-mfa ✅
4. Enter code from authenticator app
5. Access granted
```

---

### Scenario 2: User Who Scanned QR But Didn't Complete

```
1. Login with email + password ✅
2. Check: mfa_secret = EXISTS (from previous scan)
3. Redirect to /verify-mfa ✅
4. Enter code from authenticator app
5. Code verified → mfa_enabled = true
6. Generate backup codes
7. Access granted
```

**Benefit:** User doesn't have to scan QR code again!

---

### Scenario 3: Returning User (MFA Fully Set Up)

```
1. Login with email + password ✅
2. Check: mfa_secret = EXISTS
3. Redirect to /verify-mfa ✅
4. Enter code from authenticator app
5. sessionStorage.mfa_verified = 'true'
6. Access granted for this session
```

---

## Database States

| State | mfa_secret | mfa_enabled | Redirects To | Meaning |
|-------|------------|-------------|--------------|---------|
| **New User** | `NULL` | `false` | `/mfa-setup` | Never scanned QR |
| **Partial Setup** | `EXISTS` | `false` | `/verify-mfa` | Scanned but not verified |
| **Fully Set Up** | `EXISTS` | `true` | `/verify-mfa` | Complete MFA |

---

## Code Changes

### 1. Login Page (`app/login/page.tsx`)

**Before:**
```typescript
if (profileData?.mfa_enabled === true) {
  router.push('/verify-mfa');
}
```

**After:**
```typescript
if (profileData?.mfa_secret) {
  router.push('/verify-mfa');
}
```

### 2. MFA Setup Page (`app/mfa-setup/page.tsx`)

**Before:**
```typescript
if (profileData?.mfa_enabled === true) {
  router.push('/verify-mfa');
}
```

**After:**
```typescript
if (profileData?.mfa_secret) {
  router.push('/verify-mfa');
}
```

### 3. Home Page (`app/page.tsx`)

**Before:**
```typescript
if (profileData?.mfa_enabled === true) {
  // Check session verification
}
```

**After:**
```typescript
if (profileData?.mfa_secret) {
  // Check session verification
} else {
  // No secret → redirect to setup
  router.push('/mfa-setup');
}
```

### 4. Verify MFA Page (`app/verify-mfa/page.tsx`)

**Before:**
```typescript
if (!profileData?.mfa_enabled) {
  router.push('/');
}
```

**After:**
```typescript
if (!profileData?.mfa_secret) {
  router.push('/mfa-setup');
}
```

---

## Benefits

### ✅ No Need to Re-scan QR Code
- If user scanned QR but didn't finish, they can continue
- Saves time and reduces friction
- Better user experience

### ✅ Handles Partial Setup
- User scanned QR but closed browser → Can continue
- User entered wrong code → Can try again without re-scanning
- User lost at "save backup codes" step → Can complete

### ✅ More Forgiving Flow
- Previous: Had to complete all 3 steps in one session
- Now: Can pause after scanning QR code

---

## Important Notes

### When mfa_secret is Created
The `mfa_secret` is saved to the database when:
1. User visits `/mfa-setup` for the first time
2. QR code is generated via `/api/auth/mfa/setup`
3. Secret is returned and can be stored

**Note:** In current implementation, secret is generated but might not be saved until verification. Check the API route to ensure secret is saved immediately.

### When mfa_enabled is Set
The `mfa_enabled` flag is set to `true` when:
1. User enters verification code at `/mfa-setup`
2. Code is verified via `/api/auth/mfa/verify`
3. Backup codes are generated
4. Flag is updated in database

---

## Migration Impact

### Existing Users

**Scenario A: Users with mfa_enabled = true**
- Have `mfa_secret`: ✅ Works perfectly
- No `mfa_secret`: ❌ Need to re-setup (rare)

**Scenario B: Users with partial setup**
- Have `mfa_secret` but `mfa_enabled = false`: ✅ Can now complete setup
- Previously would have to start over

### New Users
- Follow the normal flow
- No breaking changes

---

## Testing Checklist

- [ ] New user (no MFA) → Redirects to `/mfa-setup`
- [ ] User scans QR → Secret is saved to database
- [ ] User closes browser before completing → Next login goes to `/verify-mfa` not `/mfa-setup`
- [ ] User verifies code → `mfa_enabled` set to `true`
- [ ] User with complete MFA → Goes to `/verify-mfa` on login
- [ ] User enters correct code → Sets session flag and grants access
- [ ] Home page checks for `mfa_secret` → Redirects correctly

---

## Potential Issues

### Issue: mfa_secret Not Saved Immediately

If the secret is only stored in component state and not saved to database until verification, the flow won't work as intended.

**Check:** Look at `/api/auth/mfa/setup` route  
**Fix:** Ensure secret is saved to database when generated, not just when verified

### Issue: Multiple Secrets

If a new secret is generated each time `/mfa-setup` is visited, old secrets become invalid.

**Current Behavior:** New secret each time  
**Impact:** User must use the latest QR code

**Possible Enhancement:** Reuse existing secret if one exists

---

## Summary

**Key Change:** Base redirect logic on `mfa_secret` (exists/not) instead of `mfa_enabled` (true/false)

**Benefit:** More forgiving flow, users don't have to re-scan QR if they didn't complete setup

**Trade-off:** User might have multiple entries in authenticator app if they scan multiple times (because new secret is generated each time)

**Overall:** Better UX for users who get interrupted during MFA setup



