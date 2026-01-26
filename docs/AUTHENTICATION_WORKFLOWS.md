# 🔐 Authentication Workflows - Complete Guide

## Overview

The PDS Time keepingSystem has **two distinct authentication workflows** depending on whether a user has a temporary password or a permanent password.

## 🔑 Two Workflows

### Workflow 1: Temporary Password (New Users / Password Reset)
```
login → /password → /mfa-setup → /register → home (/)
```

**When:** First-time users or users with temporary passwords

**Steps:**
1. **Login** (`/login`) - User enters email and temporary password
2. **Password Change** (`/password`) - User MUST change temporary password to permanent one
3. **MFA Setup** (`/mfa-setup`) - User scans QR code and sets up authenticator app
4. **Registration** (`/register`) - User completes profile (onboarding)
5. **Home** (`/`) - User accesses main application

**Key Points:**
- User **MUST** change password before accessing any other features
- MFA is set up **AFTER** password change (not before)
- User cannot skip to `/verify-mfa` during this workflow
- `is_temporary_password` flag is `true` at start, becomes `false` after password change

---

### Workflow 2: Normal Password (Returning Users)
```
login → /verify-mfa → home (/)
```

**When:** Users with permanent passwords (already completed onboarding)

**Steps:**
1. **Login** (`/login`) - User enters email and permanent password
2. **MFA Verification** (`/verify-mfa`) - User enters 6-digit code from authenticator app
3. **Home** (`/`) - User accesses main application

**Key Points:**
- User has already set up MFA during onboarding
- User verifies their identity with TOTP code from authenticator app
- Backup codes can be used if authenticator is unavailable
- Session is marked as `mfa_verified` after successful verification

---

## 🛡️ Security Guards & Redirects

### Login Page (`/login`)

**Checks:**
1. Pre-login account status check (locked, inactive, temporary password status)
2. Authentication with Supabase
3. Failed login attempt keeping

**Redirects:**
- If `is_temporary_password === true` → `/password`
- If `is_temporary_password === false` → `/verify-mfa`

**Critical Code:**
```typescript
// CRITICAL: Check temporary password FIRST before any MFA checks
if (isTemporaryPassword === true) {
  sessionStorage.setItem('requires_password_change', 'true');
  sessionStorage.removeItem('mfa_checkpoint');
  sessionStorage.removeItem('mfa_verified');
  router.replace('/password');
  return;
}

// Only proceed to MFA if no temporary password
sessionStorage.setItem('mfa_checkpoint', 'true');
router.replace('/verify-mfa');
```

---

### Password Change Page (`/password`)

**Purpose:** Force users with temporary passwords to create permanent passwords

**Checks:**
1. User is authenticated
2. User has temporary password flag (optional - page works for all users)

**Actions:**
1. Validates new password strength
2. Updates password via Supabase Auth
3. Clears `is_temporary_password` and `must_change_password` flags
4. Clears `requires_password_change` session flag

**Redirects:**
- Always redirects to `/mfa-setup` after successful password change
- **Never** redirects to `/verify-mfa`

**Critical Code:**
```typescript
// Clear password change requirement flag
sessionStorage.removeItem('requires_password_change');

// Redirect to MFA setup after 2 seconds
setTimeout(() => {
  router.push('/mfa-setup');
}, 2000);
```

---

### MFA Setup Page (`/mfa-setup`)

**Purpose:** Let users set up MFA for the first time or re-set up MFA

**Checks:**
1. User is authenticated
2. Check if MFA is already fully enabled

**Actions:**
1. Generate MFA secret and QR code
2. User scans QR code with authenticator app
3. User verifies setup with 6-digit code
4. Generate and display backup codes

**Redirects:**
- If `mfa_enabled === true` → `/` (home) - MFA already set up
- Otherwise → Stay on page to set up MFA
- After completion → `/register` (onboarding)
- **NEVER** redirects to `/verify-mfa`

**Critical Code:**
```typescript
// CRITICAL: NEVER redirect to /verify-mfa from /mfa-setup
// This page is for SETTING UP MFA, not verifying it
if (profileData?.mfa_enabled === true) {
  router.push('/');
} else {
  generateMFASecret();
}
```

**Why No Redirect to /verify-mfa?**
- `/mfa-setup` is for **setting up** MFA (first time)
- `/verify-mfa` is for **verifying** MFA (returning users)
- These are two separate purposes in two different workflows
- Redirecting would break the temporary password workflow

---

### MFA Verification Page (`/verify-mfa`)

**Purpose:** Verify returning users' MFA codes during login

**Checks:**
1. User is authenticated
2. **CRITICAL:** User does NOT have temporary password

**Actions:**
1. User enters 6-digit TOTP code from authenticator app
2. Verify code with backend API
3. Set `mfa_verified` session flag
4. Allow access to application

**Redirects:**
- If user has `is_temporary_password === true` → `/password`
- If session not found → `/login`
- After successful verification → `/` (home)

**Critical Code:**
```typescript
// CRITICAL: Check if user has temporary password BEFORE allowing MFA verification
const { data: userData } = await supabase
  .from('users')
  .select('is_temporary_password, must_change_password')
  .eq('id', session.user.id)
  .single();

if (userData?.is_temporary_password || userData?.must_change_password) {
  console.log('[DEBUG] ❌ User has temporary password - redirecting to /password');
  router.replace('/password');
  return;
}

// Set MFA checkpoint flag - user has reached MFA verification
sessionStorage.setItem('mfa_checkpoint', 'true');
```

---

### Home Page (`/`)

**Checks:**
1. User is authenticated
2. **Temporary password check FIRST**
3. MFA verification check

**Redirects:**
- If not authenticated → Show public home page
- If `is_temporary_password === true` → `/password`
- If `mfa_verified` is not set in session → `/verify-mfa`
- Otherwise → Show authenticated home page

**Critical Code:**
```typescript
// Check if user has temporary password FIRST
const { data: userData } = await supabase
  .from('users')
  .select('is_temporary_password, must_change_password')
  .eq('id', user.id)
  .single();

if (userData?.is_temporary_password || userData?.must_change_password) {
  router.push('/password');
  return;
}

// Then check MFA verification
const mfaVerified = sessionStorage.getItem('mfa_verified');
if (!mfaVerified) {
  sessionStorage.setItem('mfa_checkpoint', 'true');
  router.push('/verify-mfa');
  return;
}
```

---

## 📊 Database Flags

| Flag | Type | Purpose | When Set |
|------|------|---------|----------|
| `is_temporary_password` | boolean | Indicates user has temporary password | Set when admin creates user with temp password |
| `must_change_password` | boolean | Force password change (optional) | Set manually by admin |
| `mfa_enabled` | boolean | User has completed MFA setup | Set after user verifies MFA setup |
| `mfa_secret` | string (encrypted) | User's MFA secret key | Set during MFA setup |
| `password_expires_at` | timestamp | When temporary password expires | Set when temp password created |

---

## 🗂️ Session Storage Flags

| Flag | Purpose | Set By | Cleared By |
|------|---------|---------|------------|
| `requires_password_change` | User needs to change temporary password | Login page | Password page |
| `mfa_checkpoint` | User is in MFA verification process | verify-mfa page, home page | Login redirect, password change |
| `mfa_verified` | User has completed MFA for this session | verify-mfa API | Logout, password change |

---

## 🔒 Security Principles

### 1. Temporary Password Takes Priority
- **Always** check for temporary password FIRST
- User MUST change temporary password before any other action
- No MFA verification until password is permanent

### 2. Clear Separation of Setup vs Verification
- `/mfa-setup` = Setting up MFA for first time
- `/verify-mfa` = Verifying MFA for returning users
- These should NEVER redirect to each other

### 3. Session Flags Prevent Bypassing
- `mfa_checkpoint` prevents navigating away from MFA verification
- `requires_password_change` prevents accessing app with temporary password
- Flags are cleared after successful completion

### 4. Guards on All Entry Points
- Login page enforces correct workflow
- Home page redirects if checks fail
- verify-mfa page blocks users with temporary passwords
- mfa-setup page allows setup but doesn't force verification

---

## 🐛 Common Issues & Solutions

### Issue: User redirected to /verify-mfa after changing password
**Cause:** `/mfa-setup` was checking for `mfa_secret` and redirecting to `/verify-mfa`

**Solution:** ✅ FIXED - `/mfa-setup` now only redirects if `mfa_enabled === true`

### Issue: User can bypass password change
**Cause:** No guard on `/verify-mfa` or home page

**Solution:** ✅ FIXED - Added temporary password checks on all entry points

### Issue: Redirect loops
**Cause:** Session flags not cleared properly or conflicting redirects

**Solution:** ✅ FIXED - Clear all relevant flags during password change

---

## 📝 Testing Checklist

### Temporary Password Workflow
- [ ] User logs in with temp password → goes to `/password` ✅
- [ ] User changes password → goes to `/mfa-setup` ✅
- [ ] User completes MFA setup → goes to `/register` ✅
- [ ] User completes registration → goes to home `/` ✅
- [ ] User cannot access `/verify-mfa` during this flow ✅

### Normal Password Workflow
- [ ] User logs in with normal password → goes to `/verify-mfa` ✅
- [ ] User enters MFA code → goes to home `/` ✅
- [ ] User can use backup code if needed ✅
- [ ] User cannot bypass MFA verification ✅

### Edge Cases
- [ ] Direct URL access to `/verify-mfa` with temp password → redirected to `/password` ✅
- [ ] Direct URL access to home with temp password → redirected to `/password` ✅
- [ ] User with MFA already enabled visits `/mfa-setup` → redirected to home ✅
- [ ] Session expired during flow → redirected to login ✅

---

## 🚀 Deployment

**Status:** ✅ Deployed to Vercel
**Commit:** `9e47cf1` - Fix: Remove /verify-mfa redirect from /mfa-setup page
**URL:** https://pds-murex.vercel.app

---

## 📞 Support

If you encounter issues with authentication flows:
1. Check browser console for `[DEBUG]` logs
2. Verify database flags are set correctly
3. Clear browser cache and session storage
4. Review this document for correct workflow

---

**Last Updated:** October 9, 2025  
**Document Version:** 2.0  
**Status:** ✅ Workflows Fixed and Documented

