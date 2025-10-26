# 🔐 TOTP MFA Implementation - Primary with Email Fallback

## Overview

The PDS Time Tracking System now uses **TOTP (Time-based One-Time Password)** via authenticator apps as the primary MFA method, with **email verification codes** as a fallback option and **backup codes** for emergency access.

## Architecture

### Primary MFA Method: TOTP
- **Technology**: RFC 6238 TOTP standard
- **Implementation**: 6-digit codes that change every 30 seconds
- **Apps**: Google Authenticator, Authy, Microsoft Authenticator, etc.
- **Security**: Works offline, maximum security

### Fallback Methods
1. **Email Verification**: 6-digit codes sent to user's email (10-minute expiration)
2. **Backup Codes**: 10 single-use 8-character alphanumeric codes

## User Experience

### New User Onboarding Flow

```
1. Login with temporary password
2. Change password (/password)
3. Setup TOTP MFA (/mfa-setup)
   - Scan QR code with authenticator app
   - Verify with 6-digit code
   - Receive 10 backup codes
4. Complete profile (/register)
5. Access application (/)
```

### Daily Login Flow

```
1. Login with email + password
2. MFA Verification (/verify-mfa)
   - Choose method:
     • Primary: Enter 6-digit TOTP code
     • Fallback: Click "Email" → enter email code
     • Emergency: Enter 8-character backup code
3. Access application (/)
```

## Technical Implementation

### Frontend Components

#### `/mfa-setup` Page
- **Purpose**: Initial TOTP setup for new users
- **Features**:
  - QR code generation and display
  - Manual secret key display
  - 6-digit code verification
  - Backup codes display
  - Auto-redirect after success

#### `/verify-mfa` Page
- **Purpose**: Multi-method MFA verification during login
- **Features**:
  - Method selection (TOTP/Email/Backup)
  - Dynamic input validation
  - Email code sending
  - Appropriate error handling

### Backend APIs

#### Setup APIs
- **`/api/auth/mfa/setup`**: Generates TOTP secret and QR code
- **`/api/auth/mfa/verify`**: Verifies TOTP code during setup

#### Login APIs
- **`/api/auth/mfa/verify-login`**: Handles TOTP and backup code verification
- **`/api/auth/mfa/send-login-code`**: Sends email verification code
- **`/api/auth/mfa/verify-login-code`**: Verifies email code during login

### Database Schema

#### `profiles` Table
```sql
mfa_secret      TEXT        -- TOTP secret (base32 encoded)
mfa_enabled     BOOLEAN     -- Overall MFA status
backup_codes    TEXT[]      -- Array of 10 backup codes (hashed)
```

#### `users` Table
```sql
mfa_login_code              TEXT    -- Temporary email verification code
mfa_login_code_expires_at   TIMESTAMP -- Email code expiration
```

### Security Features

#### TOTP Security
- **Secret Generation**: Cryptographically secure random base32 strings
- **Time Window**: 30-second code validity with 1-step tolerance
- **QR Code**: Contains issuer, account name, and secret

#### Backup Code Security
- **Generation**: Cryptographically secure random strings
- **Format**: 8-character alphanumeric (A-Z, 0-9)
- **Storage**: Bcrypt hashed in database
- **Usage**: Single-use, automatically removed after use

#### Email Fallback Security
- **Code Format**: 6-digit numeric codes
- **Expiration**: 10 minutes
- **Rate Limiting**: Built into email sending system
- **Storage**: Bcrypt hashed in database

## Migration Strategy

### For Existing Users
- Users with existing email MFA will be prompted to set up TOTP
- Email MFA remains available as fallback option
- No data loss during transition

### For New Users
- TOTP setup is mandatory during onboarding
- Email fallback is automatically available
- Backup codes are generated during setup

## Benefits

### Security
- **Maximum Protection**: TOTP is industry standard for high-security applications
- **Offline Capability**: Works without internet connection
- **Time-Based**: Codes expire automatically
- **No SMS Dependency**: Reduces SIM swapping risks

### User Experience
- **Multiple Options**: Users can choose their preferred method
- **Fallback Support**: Email codes when authenticator app unavailable
- **Emergency Access**: Backup codes for lost devices
- **Familiar Interface**: Standard QR code scanning process

### Compliance
- **SOC2 Ready**: Meets enterprise security requirements
- **FLSA Compliant**: Maintains employee-driven time tracking
- **Audit Trail**: All MFA events are logged
- **PII Protection**: Secure handling of authentication data

## Error Handling

### Common Scenarios
1. **Lost Device**: Use backup codes or email fallback
2. **Wrong Time**: Authenticator app time sync issues
3. **No Internet**: TOTP codes work offline
4. **Email Issues**: Backup codes available

### Recovery Options
1. **Generate New Backup Codes**: Admin function
2. **Reset MFA**: Admin function with proper verification
3. **Email Fallback**: Always available for existing users

## Monitoring and Auditing

### Audit Events
- `mfa_setup_initiated`: TOTP setup started
- `mfa_setup_completed`: TOTP setup completed
- `mfa_login_success`: Successful MFA verification
- `mfa_login_failed`: Failed MFA attempts
- `backup_code_used`: Backup code consumed

### Metrics Tracked
- MFA method usage (TOTP vs Email vs Backup)
- Setup completion rates
- Failed verification attempts
- Backup code usage patterns

## Future Enhancements

### Planned Features
1. **WebAuthn Support**: Hardware security keys
2. **Push Notifications**: Mobile app-based approval
3. **Risk-Based Authentication**: Context-aware MFA requirements
4. **Admin Dashboard**: MFA management interface

### Security Improvements
1. **Device Registration**: Track trusted devices
2. **Geofencing**: Location-based MFA requirements
3. **Behavioral Analytics**: Detect suspicious patterns
4. **Compliance Reporting**: Automated audit reports

---

## Quick Reference

### For Developers
- **Setup Flow**: `/mfa-setup` → QR code → TOTP verification
- **Login Flow**: `/verify-mfa` → Method selection → Verification
- **APIs**: Use `/verify-login` for TOTP, `/verify-login-code` for email
- **Database**: Check `mfa_secret` for TOTP setup status

### For Users
- **Primary Method**: Use authenticator app (Google Authenticator, Authy)
- **Fallback Method**: Click "Email" button for email codes
- **Emergency Access**: Use 8-character backup codes
- **Support**: Contact admin for MFA issues

### For Administrators
- **Monitoring**: Check audit logs for MFA events
- **Recovery**: Generate new backup codes for users
- **Reset**: Disable MFA and force re-setup if needed
- **Compliance**: Export audit logs for regulatory requirements
