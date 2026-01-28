# 🔐 Authentication Changes - MFA for All Users

## Overview

The PDS Time Keeping System authentication requirements have been updated to use **email/password with Multi-Factor Authentication (MFA) for ALL users**, replacing the previous tiered system.

---

## 📋 What Changed

### ❌ OLD Authentication System

| Role | Authentication Method |
|------|----------------------|
| Workers | PIN (6 digits) or QR Code |
| Managers | Email + Password + 2FA |
| Finance | Email + Password + 2FA |
| Execs | Email + Password + 2FA |

### ✅ NEW Authentication System

| Role | Authentication Method |
|------|----------------------|
| **ALL Users** | **Email + Password + MFA** |

**Key Changes:**
- Removed PIN authentication for workers
- Removed QR code authentication
- **MFA is now MANDATORY for all users** (Workers, Managers, Finance, Execs)
- Consistent authentication experience across all roles
- Enhanced security for all user types

---

## 🎯 New Authentication Requirements

### 1. Email/Password Requirements

**Email:**
- Valid email format
- Unique per user
- Case-insensitive

**Password:**
- **Minimum 12 characters**
- Must contain:
  - At least 1 uppercase letter (A-Z)
  - At least 1 lowercase letter (a-z)
  - At least 1 number (0-9)
  - At least 1 special character (!@#$%^&*)
- Cannot be commonly used passwords
- Cannot contain user's email or name

### 2. Multi-Factor Authentication (MFA)

**Type:** TOTP (Time-based One-Time Password)

**Setup Process:**
1. User registers with email/password
2. System generates MFA secret
3. User scans QR code with authenticator app (Google Authenticator, Authy, etc.)
4. User enters 6-digit code to verify
5. System provides backup codes (10 codes)
6. MFA is activated

**Login Process:**
1. User enters email/password
2. If correct, system prompts for MFA code
3. User enters 6-digit code from authenticator app
4. If correct, user is logged in
5. Session is created with automatic timeout

### 3. Security Features

**Account Lockout:**
- 5 failed login attempts = account locked for 30 minutes
- Admin can manually unlock accounts
- Lockout events are logged in audit trail

**Session Management:**
- Idle timeout: 15 minutes
- Maximum session duration: 8 hours
- Automatic logout on timeout
- "Remember this device" option (30 days)

**Backup Codes:**
- 10 single-use backup codes provided during MFA setup
- Can be used if authenticator app is unavailable
- New codes can be generated (invalidates old codes)
- Must be stored securely by user

**Password Reset:**
- Email verification required
- Temporary link valid for 1 hour
- MFA re-setup required after password reset
- Old password cannot be reused

---

## 🔄 Migration Path

### For Existing Workers (if any)

If you have existing workers using PIN/QR code:

1. **Communication Phase (Week 1)**
   - Email all workers about authentication changes
   - Provide setup instructions
   - Schedule training sessions

2. **Transition Phase (Week 2-3)**
   - Workers register new accounts with email/password
   - Set up MFA with authenticator app
   - Test new login process
   - Keep old system running in parallel

3. **Cutover Phase (Week 4)**
   - Disable PIN/QR code authentication
   - All users now use email/password + MFA
   - Provide support for users having issues

---

## 📱 Supported Authenticator Apps

Users can use any TOTP-compatible authenticator app:

1. **Google Authenticator** (iOS, Android)
2. **Microsoft Authenticator** (iOS, Android)
3. **Authy** (iOS, Android, Desktop)
4. **1Password** (iOS, Android, Desktop)
5. **LastPass Authenticator** (iOS, Android)
6. **Duo Mobile** (iOS, Android)

---

## 🛠️ Implementation Changes Needed

### 1. Update Login Page

**Current State:**
- Role selection (Worker vs. Manager)
- PIN pad for workers
- QR code scanner for workers
- Email/password for managers

**New State:**
- Single login form for all users
- Email input
- Password input
- "Login" button → redirects to MFA verification
- "Forgot Password?" link
- "First time? Register here" link

### 2. Create MFA Setup Flow

**New Pages Needed:**
- `/setup-mfa` - QR code display and verification
- `/verify-mfa` - Enter 6-digit code during login
- `/backup-codes` - Display and download backup codes
- `/reset-mfa` - Reset MFA if device lost

### 3. Update Registration Page

**Changes:**
- Add password field (with strength indicator)
- Add password confirmation field
- Add "Setup MFA" step after successful registration
- Display backup codes before completing registration

### 4. Update Database Schema

**Add to `users` table:**
```sql
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS mfa_secret TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS backup_codes TEXT[]; -- Array of hashed codes
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
```

**Remove from `profiles` table:**
```sql
ALTER TABLE public.profiles DROP COLUMN IF EXISTS pin_hash;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS pin_salt;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS qr_code_data;
```

### 5. Update Authentication Library

**File: `lib/auth.ts`**

Remove:
- `generatePIN()`
- `hashPIN()`
- `verifyPIN()`
- `generateQRCodeData()`
- `generateQRCodeImage()`

Keep/Enhance:
- `generate2FASecret()` → rename to `generateMFASecret()`
- `generate2FAQRCode()` → rename to `generateMFAQRCode()`
- `verify2FAToken()` → rename to `verifyMFAToken()`

Add:
- `validatePassword(password: string)` - Check password strength
- `hashPassword(password: string)` - Hash password with bcrypt
- `verifyPassword(password: string, hash: string)` - Verify password
- `generateBackupCodes()` - Generate 10 backup codes
- `verifyBackupCode(code: string, hashedCodes: string[])` - Verify backup code
- `lockAccount(userId: string)` - Lock account after failed attempts
- `isAccountLocked(userId: string)` - Check if account is locked

### 6. Update Audit Logging

**Add new audit actions:**
- `MFA_SETUP_INITIATED`
- `MFA_SETUP_COMPLETED`
- `MFA_VERIFIED_SUCCESS`
- `MFA_VERIFIED_FAILED`
- `BACKUP_CODE_USED`
- `BACKUP_CODES_REGENERATED`
- `ACCOUNT_LOCKED`
- `ACCOUNT_UNLOCKED`
- `PASSWORD_CHANGED`
- `PASSWORD_RESET_REQUESTED`
- `PASSWORD_RESET_COMPLETED`

---

## 🔒 Security Benefits

### Why MFA for All Users?

1. **Enhanced Security**
   - Even if password is compromised, attacker needs access to user's device
   - Protects against phishing attacks
   - Reduces risk of credential stuffing

2. **Compliance**
   - Meets SOC2 requirements for strong authentication
   - Aligns with NIST 800-63B guidelines
   - Satisfies cyber insurance requirements

3. **Consistency**
   - Same authentication experience for all users
   - Easier to train and support
   - Simpler codebase

4. **Audit Trail**
   - Better keepingof who accessed what
   - MFA events are logged
   - Easier to detect unauthorized access

---

## 📊 Updated Validation Patterns

### Password Regex

```typescript
// Minimum 12 characters, at least 1 uppercase, 1 lowercase, 1 number, 1 special char
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_+\-=\[\]{};':"\\|,.<>\/])[A-Za-z\d@$!%*?&#^()_+\-=\[\]{};':"\\|,.<>\/]{12,}$/;

// Password strength checker
function checkPasswordStrength(password: string): 'weak' | 'medium' | 'strong' {
  let strength = 0;
  
  if (password.length >= 12) strength++;
  if (password.length >= 16) strength++;
  if (/[a-z]/.test(password)) strength++;
  if (/[A-Z]/.test(password)) strength++;
  if (/\d/.test(password)) strength++;
  if (/[@$!%*?&#^()_+\-=\[\]{};':"\\|,.<>\/]/.test(password)) strength++;
  if (password.length >= 20) strength++;
  
  if (strength <= 3) return 'weak';
  if (strength <= 5) return 'medium';
  return 'strong';
}
```

### MFA Code Regex

```typescript
// 6-digit TOTP code
const MFA_CODE_PATTERN = /^\d{6}$/;
```

### Backup Code Regex

```typescript
// 8-character alphanumeric codes (e.g., A1B2C3D4)
const BACKUP_CODE_PATTERN = /^[A-Z0-9]{8}$/;
```

---

## 🧪 Testing Checklist

### Authentication Flow
- [ ] User can register with email/password
- [ ] Password validation works correctly
- [ ] MFA setup displays QR code
- [ ] Authenticator app can scan QR code
- [ ] 6-digit code verification works
- [ ] Backup codes are generated and displayed
- [ ] User can login with email/password
- [ ] MFA verification is required on login
- [ ] Backup codes work as alternative to MFA
- [ ] Session timeout works (15 min idle, 8 hr max)
- [ ] "Remember this device" option works

### Security Features
- [ ] Password strength indicator works
- [ ] Weak passwords are rejected
- [ ] Account locks after 5 failed attempts
- [ ] Locked account shows appropriate message
- [ ] Admin can unlock accounts
- [ ] Password reset flow works
- [ ] MFA reset flow works
- [ ] All auth events are logged in audit trail

### Edge Cases
- [ ] What if user loses authenticator device?
- [ ] What if user loses backup codes?
- [ ] What if user's email changes?
- [ ] What if multiple failed MFA attempts?
- [ ] What if session expires during active use?

---

## 📚 User Documentation Needed

### For End Users
1. **"Setting Up Your Account"** guide
   - How to register
   - How to set up MFA
   - How to save backup codes

2. **"Logging In"** guide
   - How to login with email/password + MFA
   - Troubleshooting common issues

3. **"Lost Authenticator Device"** guide
   - How to use backup codes
   - How to reset MFA (contact admin)

4. **"Password Best Practices"** guide
   - Creating strong passwords
   - When to change password
   - What to do if compromised

### For Administrators
1. **"Managing User Accounts"** guide
   - How to unlock accounts
   - How to reset MFA for users
   - How to view login history

2. **"Security Monitoring"** guide
   - What to look for in audit logs
   - How to respond to suspicious activity
   - When to contact support

---

## 🚀 Implementation Timeline

### Phase 1: Backend Updates (Week 1)
- Update database schema
- Update authentication library
- Create MFA setup API endpoints
- Create MFA verification API endpoints
- Update audit logging

### Phase 2: Frontend Updates (Week 2)
- Update login page (single form for all users)
- Create MFA setup page
- Create MFA verification page
- Create backup codes page
- Update registration flow

### Phase 3: Testing (Week 3)
- Unit tests for authentication functions
- Integration tests for login flow
- Security testing (penetration testing)
- User acceptance testing

### Phase 4: Documentation & Training (Week 4)
- Write user guides
- Write admin guides
- Create training materials
- Record video tutorials

### Phase 5: Deployment (Week 5)
- Deploy to staging
- User training sessions
- Deploy to production
- Monitor for issues

---

## 📞 Support & Resources

### For Users Having Issues

**Can't set up MFA?**
- Ensure authenticator app is installed
- Check device time is correct (TOTP requires accurate time)
- Try different authenticator app
- Contact IT support

**Lost authenticator device?**
- Use backup codes to login
- Contact admin to reset MFA
- Set up new device

**Forgot password?**
- Use "Forgot Password?" link
- Check email for reset link
- Complete password reset
- Re-setup MFA if required

### Contact Information
- **IT Support:** support@pds.com
- **Security Issues:** security@pds.com
- **Emergency Access:** Call (555) 123-4567

---

## ✅ Compliance Confirmation

This new authentication system meets:

- ✅ **SOC2** - Strong authentication required
- ✅ **NIST 800-63B** - Multi-factor authentication guidelines
- ✅ **PCI DSS** - If handling payment info
- ✅ **HIPAA** - If handling health info (future consideration)
- ✅ **Cyber Insurance** - Requirements for coverage

---

**Updated:** September 30, 2025  
**Version:** 2.0  
**Status:** Authentication System Redesigned - Implementation Required
