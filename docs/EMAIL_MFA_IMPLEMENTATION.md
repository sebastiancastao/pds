# Email-Based MFA Implementation Guide

**Date:** October 10, 2024  
**Status:** ✅ Complete

---

## Overview

This implementation adds **email-based Multi-Factor Authentication (MFA)** to the PDS Time keeping System. Users receive 6-digit verification codes via email instead of using authenticator apps (TOTP).

### Key Features

- ✉️ **Email Verification Codes**: 6-digit codes sent via Resend
- ⏱️ **10-Minute Expiration**: Codes expire automatically for security
- 🔐 **Secure Storage**: Codes are hashed with bcrypt before database storage
- 📝 **Audit Logging**: All MFA events are logged for compliance
- 🎨 **Beautiful Email Templates**: Professional, branded verification emails
- 🔄 **Two Flows**: Separate flows for MFA setup and login verification

---

## System Architecture

### Email MFA Flow

#### **MFA Setup Flow** (New Users)
1. User completes initial onboarding
2. System redirects to `/mfa-setup`
3. User clicks "Send Verification Code"
4. System generates 6-digit code → hashes it → stores in DB
5. Email sent via Resend with the code
6. User enters code on setup page
7. System verifies code → enables MFA → generates backup codes
8. User redirected to complete profile

#### **MFA Login Flow** (Returning Users)
1. User enters email/password on login page
2. System checks temporary password → redirects to `/password` if needed
3. System checks MFA enabled → redirects to `/verify-mfa`
4. System automatically sends 6-digit code via email
5. User enters code on verification page
6. System verifies code → grants access
7. User redirected to home/dashboard

---

## Implementation Details

### 1. Library Functions

#### `lib/auth.ts` - Email MFA Utilities

Added three new functions:

```typescript
// Generate 6-digit numeric code
generateEmailMFACode(): string

// Hash code for secure storage
hashEmailMFACode(code: string): Promise<string>

// Verify code against stored hash
verifyEmailMFACode(code: string, hashedCode: string): Promise<boolean>
```

#### `lib/email.ts` - Email Sending

Added one new function:

```typescript
// Send MFA verification email
sendMFAVerificationEmail(
  email: string, 
  code: string, 
  purpose: 'setup' | 'login'
): Promise<EmailResult>
```

Features:
- Professional HTML email template
- Large, readable code display
- 10-minute expiration warning
- Security tips included
- Sent via Resend API

---

### 2. API Endpoints

Created 4 new API routes:

#### **MFA Setup Endpoints**

**`POST /api/auth/mfa/send-email-code`**
- Generates and sends verification code during MFA setup
- Stores hashed code in `users.mfa_setup_code`
- Sets 10-minute expiration in `users.mfa_setup_code_expires_at`

**`POST /api/auth/mfa/verify-email-code`**
- Verifies code during MFA setup
- Enables MFA in profile (`profiles.mfa_enabled = true`)
- Generates and returns backup codes
- Clears setup code from database

#### **MFA Login Endpoints**

**`POST /api/auth/mfa/send-login-code`**
- Generates and sends verification code during login
- Stores hashed code in `users.mfa_login_code`
- Sets 10-minute expiration in `users.mfa_login_code_expires_at`
- Only works if MFA is already enabled

**`POST /api/auth/mfa/verify-login-code`**
- Verifies code during login
- Logs successful MFA verification
- Clears login code from database
- Grants user access to system

---

### 3. Database Schema

#### Migration: `005_add_email_mfa_fields.sql`

Adds 4 new columns to `public.users`:

| Column | Type | Description |
|--------|------|-------------|
| `mfa_setup_code` | TEXT | Hashed code for MFA setup (bcrypt) |
| `mfa_setup_code_expires_at` | TIMESTAMPTZ | Code expiration (10 min) |
| `mfa_login_code` | TEXT | Hashed code for login verification |
| `mfa_login_code_expires_at` | TIMESTAMPTZ | Code expiration (10 min) |

**Indexes:**
- `idx_users_mfa_setup_code_expires` - Fast cleanup of expired codes
- `idx_users_mfa_login_code_expires` - Fast cleanup of expired codes

---

### 4. Frontend Pages

#### **Modified: `app/mfa-setup/page.tsx`**
- Now calls `/api/auth/mfa/send-email-code`
- Calls `/api/auth/mfa/verify-email-code`
- Two-step flow: Send Code → Verify Code
- Displays backup codes after successful setup

#### **Modified: `app/verify-mfa/page.tsx`**
- Now calls `/api/auth/mfa/send-login-code`
- Calls `/api/auth/mfa/verify-login-code`
- Automatically sends code on page load
- Includes resend functionality with countdown
- Checks for temporary password before allowing MFA

---

## Security Features

### Code Generation & Storage
- ✅ Cryptographically secure random 6-digit codes
- ✅ Codes hashed with bcrypt (salt rounds: 10) before storage
- ✅ Plain text codes NEVER stored in database
- ✅ Codes visible only in email (one-time viewing)

### Expiration & Cleanup
- ✅ 10-minute expiration enforced at API level
- ✅ Expired codes rejected automatically
- ✅ Codes cleared from DB after successful verification
- ✅ Separate codes for setup vs. login (no reuse)

### Audit Trail
- ✅ All code sends logged to `audit_logs`
- ✅ All verification attempts logged (success/failure)
- ✅ Includes IP address and user agent
- ✅ Failed attempts tracked with reason codes

### Email Security
- ✅ Emails sent over TLS 1.2+ (Resend)
- ✅ Clear expiration warning in email
- ✅ Security tips included in template
- ✅ Professional branding prevents phishing confusion

---

## Setup Instructions

### 1. Apply Database Migration

Run the migration in Supabase SQL Editor:

```bash
# Copy contents of database/migrations/005_add_email_mfa_fields.sql
# Paste into Supabase SQL Editor
# Click "Run"
```

Or use Supabase CLI:

```bash
supabase db push database/migrations/005_add_email_mfa_fields.sql
```

### 2. Verify Environment Variables

Ensure these are set in `.env.local`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Email (Resend)
RESEND_API_KEY=your_resend_api_key

# App URL (for email links)
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

### 3. Test the Flow

#### Test MFA Setup:
1. Create a new user (via `/signup` or admin invite)
2. Login with credentials
3. Should redirect to `/mfa-setup`
4. Click "Send Verification Code"
5. Check email for 6-digit code
6. Enter code and verify
7. Save backup codes

#### Test MFA Login:
1. Logout
2. Login with email/password
3. Should redirect to `/verify-mfa`
4. Code automatically sent to email
5. Enter code from email
6. Should grant access to dashboard

---

## Troubleshooting

### "An unexpected error occurred"

**Possible Causes:**
1. ❌ Database migration not applied
2. ❌ Missing environment variables
3. ❌ Resend API key invalid
4. ❌ Supabase service role key missing

**Fix:**
- Check browser console for detailed error
- Check server logs for API errors
- Verify all environment variables are set
- Run database migration

### Email Not Received

**Possible Causes:**
1. ❌ Resend API key invalid
2. ❌ Email in spam folder
3. ❌ Resend domain not verified
4. ❌ Email quota exceeded

**Fix:**
- Check Resend dashboard for send logs
- Verify API key is correct
- Check spam/junk folder
- Verify Resend domain is verified
- Check Resend account quota

### Code Expired

**Expected Behavior:**
- Codes expire after 10 minutes
- User must request new code

**Fix:**
- Click "Resend verification code" button
- Wait for countdown timer (60 seconds)
- New code will be sent

### Code Invalid

**Possible Causes:**
1. ❌ Code typo (wrong digits)
2. ❌ Code expired
3. ❌ Using old code (after requesting new one)

**Fix:**
- Double-check code in email
- Request new code if expired
- Use most recent code received

---

## API Reference

### Send Email Code (Setup)

```http
POST /api/auth/mfa/send-email-code
Authorization: Bearer {jwt_token}
```

**Response:**
```json
{
  "success": true,
  "message": "Verification code sent to your email",
  "expiresAt": "2024-10-10T12:10:00.000Z"
}
```

### Verify Email Code (Setup)

```http
POST /api/auth/mfa/verify-email-code
Authorization: Bearer {jwt_token}
Content-Type: application/json

{
  "code": "123456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "MFA enabled successfully",
  "backupCodes": ["A1B2C3D4", "E5F6G7H8", ...]
}
```

### Send Login Code

```http
POST /api/auth/mfa/send-login-code
Authorization: Bearer {jwt_token}
```

**Response:**
```json
{
  "success": true,
  "message": "Verification code sent to your email",
  "expiresAt": "2024-10-10T12:10:00.000Z"
}
```

### Verify Login Code

```http
POST /api/auth/mfa/verify-login-code
Authorization: Bearer {jwt_token}
Content-Type: application/json

{
  "code": "123456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "MFA verified successfully"
}
```

---

## Compliance & Standards

### FLSA Compliance
✅ Employee-driven authentication (not manager-driven)  
✅ Audit trail for all login attempts  
✅ MFA required for all users (SOC2 mandate)

### SOC2 Compliance
✅ Multi-factor authentication enforced  
✅ Email-based verification adds second factor  
✅ All events logged with timestamps  
✅ PII (email addresses) handled securely

### Data Retention
- Verification codes: **Deleted after use or 10 minutes**
- Audit logs: **Retained permanently** for compliance
- Backup codes: **Retained until used** (hashed)

---

## Future Enhancements

### Potential Improvements
1. 🔄 SMS fallback option
2. 📱 Push notification alternative
3. 🎨 Customizable email branding
4. 🌐 Multi-language email templates
5. 📊 MFA analytics dashboard

---

## Support

For issues or questions:
- Check server logs: `npm run dev` (console output)
- Check browser console: DevTools → Console
- Review audit logs: Supabase → `audit_logs` table
- Contact: support@pds.com

---

**Implementation Date:** October 10, 2024  
**Last Updated:** October 10, 2024  
**Status:** ✅ Production Ready

