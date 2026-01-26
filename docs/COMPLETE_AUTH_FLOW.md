# 🔐 Complete Authentication Flow with MFA

This document describes the complete authentication flow for the PDS Time keepingSystem, including temporary passwords, password changes, MFA setup, and MFA verification.

---

## Overview

The system enforces a secure authentication flow that ensures:
1. ✅ Users with temporary passwords must change them before accessing the system
2. ✅ All users must set up MFA (Multi-Factor Authentication) before accessing protected resources
3. ✅ Users with MFA enabled must verify their identity on every login
4. ✅ MFA verification persists only for the current session
5. ✅ All protected pages check for MFA verification before granting access

---

## Authentication Flow Diagram

```
┌─────────────┐
│   Login     │
│   (Email +  │
│  Password)  │
└──────┬──────┘
       │
       ▼
┌──────────────────┐
│ Check Temporary  │
│    Password?     │
└───┬──────────┬───┘
    │          │
    │ Yes      │ No
    │          │
    ▼          ▼
┌────────┐  ┌──────────┐
│ Change │  │ Check    │
│Password│  │ MFA      │
└───┬────┘  │ Enabled? │
    │       └─┬────┬───┘
    │         │    │
    │         │Yes │No
    │         │    │
    ▼         ▼    ▼
┌─────────┐ ┌────────┐ ┌─────────┐
│   MFA   │ │ Verify │ │   MFA   │
│  Setup  │ │  MFA   │ │  Setup  │
└────┬────┘ └───┬────┘ └────┬────┘
     │          │           │
     │          │           │
     ▼          ▼           │
┌─────────────────┐         │
│   Register      │◄────────┘
│   (Complete     │
│    Profile)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Home Page     │
│   (Protected)   │
└─────────────────┘
```

---

## Step-by-Step Flow

### 1️⃣ Login Page (`/login`)

**Purpose:** Authenticate user with email and password

**Logic:**
```typescript
1. User enters email and password
2. System calls Supabase auth.signInWithPassword()
3. If authentication fails → show error
4. If authentication succeeds → check user status:
   
   a. Check if is_temporary_password === true
      - If TRUE → Redirect to /password
      - If FALSE → Continue to step b
   
   b. Check if mfa_enabled === true
      - If TRUE → Redirect to /verify-mfa
      - If FALSE → Redirect to /mfa-setup
```

**Key Files:**
- `app/login/page.tsx` - Client-side login UI
- `app/api/auth/pre-login-check/route.ts` - Pre-authentication account checks

---

### 2️⃣ Change Password Page (`/password`)

**Purpose:** Force users with temporary passwords to set a new password

**Security Requirements:**
- User must be authenticated
- User must provide current password
- New password must meet strength requirements (12+ chars, mixed case, numbers, special chars)
- New password must be different from current password

**Logic:**
```typescript
1. User enters current password, new password, and confirms new password
2. Client validates password strength in real-time
3. On submit:
   a. Verify current password with Supabase auth
   b. Call /api/auth/change-password to update database flags
   c. Update password via supabase.auth.updateUser({ password })
   d. Redirect to /mfa-setup
```

**Database Updates:**
- `is_temporary_password` → `false`
- `must_change_password` → `false`
- `password_expires_at` → `null`
- `last_password_change` → `NOW()`

**Key Files:**
- `app/password/page.tsx` - Password change UI
- `app/api/auth/change-password/route.ts` - Server-side password update logic

---

### 3️⃣ MFA Setup Page (`/mfa-setup`)

**Purpose:** Set up Two-Factor Authentication (TOTP) for all users

**Security Requirements:**
- User must be authenticated
- User must have completed password change (if temporary password)
- QR code and secret must be generated securely
- TOTP code must be verified before enabling MFA
- Backup codes must be generated and hashed before storage

**3-Step Process:**

#### Step 1: Generate Secret & QR Code
```typescript
1. Client calls /api/auth/mfa/setup
2. Server generates TOTP secret using speakeasy
3. Server creates QR code with:
   - Service name: "PDS Time keeping"
   - User email
   - Secret key
4. Returns QR code (base64 image) and secret to client
5. User scans QR code with authenticator app (Google Authenticator, Authy, etc.)
```

#### Step 2: Verify TOTP Code
```typescript
1. User enters 6-digit code from authenticator app
2. Client calls /api/auth/mfa/verify
3. Server verifies code against secret using speakeasy
4. If valid:
   - Generate 8 backup codes
   - Hash backup codes with bcrypt
   - Store in database
   - Set mfa_enabled = true
   - Return backup codes to client
```

#### Step 3: Save Backup Codes
```typescript
1. Display 8 backup codes to user
2. User must download or copy codes
3. User confirms they saved the codes
4. Redirect to /register
```

**Backup Codes:**
- 8-character alphanumeric codes (e.g., `A1B2C3D4`)
- Hashed with bcrypt before storage
- One-time use only
- Must be stored securely by user

**Database Updates:**
- `profiles.mfa_enabled` → `true`
- `profiles.mfa_secret` → encrypted TOTP secret
- `profiles.backup_codes` → JSON array of hashed backup codes

**Key Files:**
- `app/mfa-setup/page.tsx` - MFA setup UI
- `app/api/auth/mfa/setup/route.ts` - Generate secret and QR code
- `app/api/auth/mfa/verify/route.ts` - Verify code and enable MFA
- `lib/auth.ts` - MFA utility functions

---

### 4️⃣ MFA Verification Page (`/verify-mfa`)

**Purpose:** Verify user identity on every login (for users with MFA enabled)

**Security Requirements:**
- User must be authenticated (email + password already verified)
- User must not have `mfa_verified` session flag
- TOTP code must be valid (time-window: ±1 period = ±30 seconds)
- Backup codes are one-time use only

**2 Verification Methods:**

#### Method 1: TOTP Code
```typescript
1. User enters 6-digit code from authenticator app
2. Client calls /api/auth/mfa/verify-login
3. Server verifies code against stored mfa_secret
4. If valid:
   - Set sessionStorage.mfa_verified = 'true'
   - Redirect to /
```

#### Method 2: Backup Code
```typescript
1. User clicks "Use backup code instead"
2. User enters 8-character backup code
3. Client calls /api/auth/mfa/verify-login with isBackupCode: true
4. Server:
   - Verifies code against hashed backup codes
   - Marks backup code as used
   - Removes used code from database
5. If valid:
   - Set sessionStorage.mfa_verified = 'true'
   - Redirect to /
```

**Session Management:**
- MFA verification is stored in `sessionStorage`
- Flag: `mfa_verified = 'true'`
- Cleared on logout or browser close
- Must be re-verified on every new login

**Key Files:**
- `app/verify-mfa/page.tsx` - MFA verification UI
- `app/api/auth/mfa/verify-login/route.ts` - Verify TOTP or backup code

---

### 5️⃣ Register Page (`/register`)

**Purpose:** Complete user profile with personal information

**Requirements:**
- User must be authenticated
- User must have changed temporary password (if applicable)
- User must have completed MFA setup

**Fields:**
- Full name
- Phone number
- Role (Worker, Room Manager, Finance, Exec)
- Division (PDS Vendor, CWT Trailers)
- State (for onboarding packet requirements)

**Key Files:**
- `app/register/page.tsx` - Profile completion UI

---

### 6️⃣ Home Page (`/`)

**Purpose:** Main dashboard (protected resource)

**Security Checks:**
```typescript
1. Check if user is authenticated
   - If NO → Show public home page with login button
   - If YES → Continue to step 2

2. Check if is_temporary_password === true
   - If YES → Redirect to /password
   - If NO → Continue to step 3

3. Check if mfa_enabled === true
   - If YES → Continue to step 4
   - If NO → Redirect to /mfa-setup

4. Check if sessionStorage.mfa_verified === 'true'
   - If YES → Show authenticated home page
   - If NO → Redirect to /verify-mfa
```

**Authenticated Home Page:**
- Welcome message with user email
- Quick links to divisions (PDS Vendor, CWT Trailers)
- Quick actions (Complete Profile, Security Settings)
- Logout button (clears `mfa_verified` flag)

**Key Files:**
- `app/page.tsx` - Home page with authentication checks

---

## Session Storage Management

### MFA Verification Flag

**Key:** `mfa_verified`  
**Value:** `'true'` | `null`  
**Scope:** `sessionStorage` (cleared on browser close)

**Set When:**
- ✅ User successfully verifies MFA code at `/verify-mfa`

**Checked When:**
- ✅ User accesses home page (`/`)
- ✅ User accesses any protected resource

**Cleared When:**
- ✅ User logs out
- ✅ Browser session ends (tab/window closed)

**Code Example:**
```typescript
// Set flag after MFA verification
sessionStorage.setItem('mfa_verified', 'true');

// Check flag on protected pages
const mfaVerified = sessionStorage.getItem('mfa_verified');
if (!mfaVerified) {
  router.push('/verify-mfa');
}

// Clear flag on logout
sessionStorage.removeItem('mfa_verified');
```

---

## Security Features

### 1. Temporary Password Management
- ✅ Temporary passwords expire after set period
- ✅ Users cannot access system until password is changed
- ✅ Password change requires current password verification
- ✅ New passwords must meet strength requirements

### 2. MFA Enforcement
- ✅ All users must enable MFA
- ✅ MFA setup required before accessing protected resources
- ✅ TOTP-based (Time-based One-Time Password)
- ✅ Compatible with Google Authenticator, Authy, Microsoft Authenticator

### 3. Backup Codes
- ✅ 8 backup codes generated during MFA setup
- ✅ One-time use only
- ✅ Hashed with bcrypt before storage
- ✅ Removed from database after use

### 4. Session-Based MFA Verification
- ✅ MFA verification required on every login
- ✅ Verification persists only for current session
- ✅ Cleared on logout or browser close
- ✅ Cannot bypass by direct URL access

### 5. Protected Pages
- ✅ All pages check authentication and MFA status
- ✅ Automatic redirects to appropriate onboarding step
- ✅ No access to protected resources until fully authenticated

---

## API Endpoints

### Authentication
- `POST /api/auth/pre-login-check` - Pre-login account checks
- `POST /api/auth/update-login-attempts` - Update failed login attempts
- `POST /api/auth/change-password` - Change user password

### MFA
- `POST /api/auth/mfa/setup` - Generate MFA secret and QR code
- `POST /api/auth/mfa/verify` - Verify TOTP code and enable MFA
- `POST /api/auth/mfa/verify-login` - Verify TOTP or backup code during login

---

## Database Schema

### `users` Table
```sql
- id: UUID (primary key)
- email: TEXT
- is_temporary_password: BOOLEAN
- must_change_password: BOOLEAN
- password_expires_at: TIMESTAMP
- last_password_change: TIMESTAMP
```

### `profiles` Table
```sql
- id: UUID (primary key, foreign key to users.id)
- user_id: UUID (foreign key to auth.users.id)
- mfa_enabled: BOOLEAN
- mfa_secret: TEXT (encrypted)
- backup_codes: JSONB (array of hashed codes)
```

---

## User Experience Flow Examples

### Example 1: First-Time User with Temporary Password
```
1. Admin creates account with temporary password
2. User receives email with temporary password
3. User logs in at /login
4. System detects temporary password → Redirects to /password
5. User changes password → Redirects to /mfa-setup
6. User scans QR code and verifies → Redirects to /register
7. User completes profile → Redirects to /
8. User can now access the system
```

### Example 2: Returning User with MFA Enabled
```
1. User logs in at /login with email + password
2. System detects MFA enabled → Redirects to /verify-mfa
3. User enters TOTP code from authenticator app
4. System verifies code → Sets mfa_verified flag → Redirects to /
5. User can access the system (until browser session ends)
```

### Example 3: User Without MFA Enabled (Returning)
```
1. User logs in at /login with email + password
2. System detects MFA NOT enabled → Redirects to /mfa-setup
3. User must set up MFA before accessing the system
4. After setup → Redirects to /register
5. After profile completion → Redirects to /
6. User can now access the system
```

### Example 4: User Lost Authenticator Device
```
1. User logs in at /login with email + password
2. System detects MFA enabled → Redirects to /verify-mfa
3. User clicks "Use backup code instead"
4. User enters one of their saved backup codes
5. System verifies and marks backup code as used
6. User is granted access for this session
7. User should set up new authenticator device ASAP
```

---

## Testing Checklist

### ✅ Password Change Flow
- [ ] User with temporary password cannot access home page
- [ ] User cannot change password without providing current password
- [ ] New password must meet strength requirements
- [ ] User is redirected to /mfa-setup after password change
- [ ] Database flags are updated correctly

### ✅ MFA Setup Flow
- [ ] QR code is generated correctly
- [ ] User can scan QR code with authenticator app
- [ ] Invalid TOTP code is rejected
- [ ] Valid TOTP code enables MFA
- [ ] 8 backup codes are generated and displayed
- [ ] User cannot proceed without confirming backup codes are saved
- [ ] User is redirected to /register after MFA setup

### ✅ MFA Verification Flow
- [ ] User with MFA enabled is redirected to /verify-mfa on login
- [ ] Valid TOTP code grants access
- [ ] Invalid TOTP code is rejected
- [ ] Valid backup code grants access
- [ ] Backup code is marked as used and cannot be reused
- [ ] User is redirected to / after successful verification
- [ ] mfa_verified flag is set in sessionStorage

### ✅ Protected Pages
- [ ] Home page redirects to /password if temporary password
- [ ] Home page redirects to /mfa-setup if MFA not enabled
- [ ] Home page redirects to /verify-mfa if MFA not verified
- [ ] Home page shows authenticated content after all checks pass
- [ ] Logout clears mfa_verified flag

### ✅ Session Management
- [ ] mfa_verified flag persists across page navigation (same session)
- [ ] mfa_verified flag is cleared on logout
- [ ] mfa_verified flag is cleared on browser close
- [ ] User must re-verify MFA on new login

---

## Troubleshooting

### Issue: User stuck in redirect loop
**Cause:** Database flags not updated correctly  
**Solution:** Check `is_temporary_password`, `must_change_password`, and `mfa_enabled` flags

### Issue: MFA code always rejected
**Cause:** Time synchronization issue  
**Solution:** Ensure server and authenticator app have correct time

### Issue: Session lost after password change
**Cause:** Password update invalidated session  
**Solution:** Use `supabase.auth.updateUser()` on client-side to maintain session

### Issue: User can access home page without MFA verification
**Cause:** Protected page not checking mfa_verified flag  
**Solution:** Add MFA verification check in page's useEffect

---

## Compliance & Security Standards

This authentication flow meets the following compliance standards:

✅ **FLSA (Fair Labor Standards Act)**
- Employee-driven authentication (not manager-driven)

✅ **SOC2 Compliance**
- Multi-factor authentication enforced
- Password strength requirements
- Session management
- Audit logging

✅ **PII Protection**
- All authentication data encrypted in transit (TLS)
- Sensitive data encrypted at rest (AES-256)
- MFA secrets stored encrypted
- Backup codes hashed with bcrypt

✅ **IRS/DOL Audit Requirements**
- Immutable audit trail
- All authentication events logged
- Failed login attempt keeping

---

## References

- [TOTP RFC 6238](https://tools.ietf.org/html/rfc6238)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)
- [speakeasy Library Documentation](https://github.com/speakeasyjs/speakeasy)











