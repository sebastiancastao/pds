# 🔐 MFA Login Flow - Complete Guide

## Overview

Users with MFA enabled must verify their identity with a 6-digit code from their authenticator app (or a backup code) after entering their email and password.

---

## 📋 Complete Login Flow (Updated)

### **Scenario 1: New User with Temporary Password**
```
1. Login with temporary password
   ↓
2. /password (change password)
   ↓
3. /mfa-setup (set up MFA)
   ↓
4. /register (complete profile)
   ↓
5. / (home - full access)
```

### **Scenario 2: Existing User with MFA Enabled**
```
1. Login with email + password ✅
   ↓
2. /verify-mfa (enter MFA code) 🔐
   ↓
3. / (home - full access)
```

### **Scenario 3: Existing User WITHOUT MFA**
```
1. Login with email + password ✅
   ↓
2. / (home - full access)
   
Note: These users should set up MFA eventually!
```

---

## 🔄 Login Flow Decision Tree

```
                    ┌─────────────┐
                    │   LOGIN     │
                    │ Email+Pass  │
                    └──────┬──────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │ Authentication  │
                  │   Successful?   │
                  └────┬───────┬────┘
                       │       │
                      YES      NO → Show error
                       │
                       ▼
               ┌──────────────────┐
               │ Temporary        │
               │ Password?        │
               └────┬────────┬────┘
                    │        │
                   YES       NO
                    │        │
                    │        ▼
                    │   ┌──────────────┐
                    │   │ MFA Enabled? │
                    │   └───┬──────┬───┘
                    │       │      │
                    │      YES     NO
                    │       │      │
                    ▼       ▼      ▼
            ┌──────────┐ ┌────────┐ ┌──────┐
            │/password │ │/verify-│ │/     │
            │          │ │  mfa   │ │(home)│
            └──────────┘ └────────┘ └──────┘
```

---

## 🎯 MFA Verification Page (`/verify-mfa`)

### **Purpose:**
Verify user's identity using MFA code after successful password authentication.

### **Features:**

#### **1. TOTP Code Verification**
- User enters 6-digit code from authenticator app
- Codes change every 30 seconds
- 60-second window for verification (to account for clock drift)

#### **2. Backup Code Support**
- Toggle to "Use backup code instead"
- Enter 8-character alphanumeric code
- Each backup code works only once
- Automatically removed after use

#### **3. User Experience**
```
┌─────────────────────────────────┐
│  Two-Factor Authentication      │
│                                 │
│  Enter 6-digit code:            │
│     ┌───┬───┬───┬───┬───┬───┐ │
│     │ 1 │ 2 │ 3 │ 4 │ 5 │ 6 │ │
│     └───┴───┴───┴───┴───┴───┘ │
│                                 │
│  [Verify and Continue]          │
│                                 │
│  Use backup code instead →      │
└─────────────────────────────────┘
```

---

## 🛠️ Technical Implementation

### **Files Created:**

#### **1. `app/verify-mfa/page.tsx`**
**Frontend page for MFA verification during login**

Features:
- Session validation (must be authenticated)
- Toggle between TOTP code and backup code
- Real-time input validation
- Auto-format codes (numeric for TOTP, alphanumeric for backup)
- Responsive design with security information

#### **2. `app/api/auth/mfa/verify-login/route.ts`**
**Backend API for MFA verification**

Process:
1. Verify user's JWT token
2. Get MFA settings from database
3. Verify TOTP code OR backup code
4. If backup code used, remove it from array
5. Log audit event
6. Return success

Security:
- Rate limiting (inherited from API infrastructure)
- Hashed backup codes in database
- One-time use backup codes
- Full audit trail

#### **3. `app/login/page.tsx` (Modified)**
**Updated login flow to check for MFA**

Changes:
- After successful authentication, check if MFA enabled
- If yes, redirect to `/verify-mfa`
- If no, redirect to home
- Maintains existing temporary password check

---

## 🔐 Security Features

### **1. TOTP (Time-based One-Time Password)**
```javascript
// How it works:
SECRET + CURRENT_TIME → 6-digit code

// Example:
Time: 10:30:00 → Code: 123456
Time: 10:30:30 → Code: 789012  // Changes every 30s
Time: 10:31:00 → Code: 345678
```

### **2. Backup Codes**
```javascript
// Stored hashed in database
Database: "$2a$10$xhJ9..." (hashed)
User has: "A1B2C3D4" (plaintext)

// After use:
- Code is removed from database array
- Can't be used again
- User has 9 remaining codes
```

### **3. Audit Logging**
```javascript
Events logged:
- mfa_login_success (with method: totp/backup_code)
- mfa_login_failed (with reason)
- Includes: userId, IP, userAgent, timestamp
```

---

## 📊 Database Updates

### **During MFA Verification:**

**If TOTP code:**
```javascript
// No database changes needed
// Just verify code matches
```

**If Backup code:**
```sql
-- Remove used code from array
UPDATE profiles
SET backup_codes = array_remove(backup_codes, :used_code_hash)
WHERE user_id = :user_id;
```

---

## 🎨 User Experience Flow

### **Step 1: Login with Email + Password**
```
User enters credentials → Authentication succeeds
```

### **Step 2: MFA Check**
```
System checks: profileData.mfa_enabled
- If true → Redirect to /verify-mfa
- If false → Redirect to home
```

### **Step 3: MFA Verification**
```
Option A - Regular Code:
1. Open authenticator app
2. View 6-digit code
3. Enter code in /verify-mfa
4. Click "Verify and Continue"
5. ✅ Access granted

Option B - Backup Code:
1. Click "Use backup code instead"
2. Enter 8-character code
3. Click "Verify and Continue"
4. ⚠️ Code removed from list
5. ✅ Access granted
```

---

## 🔄 API Flow Diagram

### **Login Flow:**
```
Client                   Server                   Database
  │                        │                        │
  │─ Email+Password ──────>│                        │
  │                        │─ Verify ──────────────>│
  │                        │<─ Success ─────────────│
  │                        │                        │
  │                        │─ Check MFA enabled ───>│
  │                        │<─ mfa_enabled=true ────│
  │                        │                        │
  │<─ Redirect to MFA ────│                        │
  │                        │                        │
  │─ /verify-mfa ─────────>│                        │
  │                        │                        │
  │─ POST /mfa/verify ────>│                        │
  │  (code: "123456")      │                        │
  │                        │─ Get MFA secret ──────>│
  │                        │<─ secret ──────────────│
  │                        │                        │
  │                        │ Verify TOTP            │
  │                        │ ✅ Valid               │
  │                        │                        │
  │                        │─ Log audit event ─────>│
  │<─ Success ─────────────│                        │
  │                        │                        │
  │─ Redirect to home ────>│                        │
  │                        │                        │
```

### **Backup Code Flow:**
```
Client                   Server                   Database
  │                        │                        │
  │─ POST /mfa/verify ────>│                        │
  │  (code: "A1B2C3D4")    │                        │
  │  (isBackupCode: true)  │                        │
  │                        │                        │
  │                        │─ Get backup codes ────>│
  │                        │<─ hashed array ────────│
  │                        │                        │
  │                        │ Hash input code        │
  │                        │ Compare with array     │
  │                        │ ✅ Found at index 3    │
  │                        │                        │
  │                        │─ Remove code[3] ──────>│
  │                        │<─ Updated ─────────────│
  │                        │                        │
  │                        │─ Log audit event ─────>│
  │<─ Success ─────────────│                        │
  │  (9 codes remaining)   │                        │
  │                        │                        │
```

---

## 🧪 Testing Checklist

### **Login Flow:**
- [ ] User with temporary password → `/password` (MFA check skipped)
- [ ] User with MFA enabled → `/verify-mfa`
- [ ] User without MFA → `/` (home)

### **MFA Verification:**
- [ ] Valid TOTP code works
- [ ] Invalid TOTP code rejected
- [ ] Expired TOTP code rejected (after 60s)
- [ ] Valid backup code works
- [ ] Invalid backup code rejected
- [ ] Used backup code doesn't work again
- [ ] Backup code removed from database after use
- [ ] Toggle between TOTP and backup code works

### **Edge Cases:**
- [ ] User session expires during MFA → redirect to login
- [ ] User without MFA can't access `/verify-mfa` → redirect to home
- [ ] User tries to skip MFA verification → stays on page
- [ ] All 10 backup codes used → error message

---

## 📞 User Support

### **Common Issues:**

**Issue: "I don't have my phone"**
```
Solution: Use backup code
1. Click "Use backup code instead"
2. Enter one of your saved backup codes
3. Verify and log in
```

**Issue: "Code doesn't work"**
```
Troubleshooting:
1. Check time on phone is correct (TOTP is time-based)
2. Try the next code (codes change every 30s)
3. Use backup code instead
4. Contact IT support if all else fails
```

**Issue: "Lost all backup codes"**
```
Solution: Contact IT support
- Admin can reset MFA
- User must set up MFA again
- New backup codes generated
```

---

## 🚀 Future Enhancements

Potential improvements:
- [ ] "Remember this device for 30 days" option
- [ ] SMS backup option (less secure, but convenient)
- [ ] Push notification approval (like Duo)
- [ ] Hardware key support (WebAuthn/FIDO2)
- [ ] Show backup codes remaining count
- [ ] Allow regenerating backup codes in settings

---

## ✅ Summary

**Complete Login Flow:**
```
Login → [Temp Password? → /password → /mfa-setup → /register]
     → [MFA Enabled? → /verify-mfa]
     → Home
```

**Key Features:**
✅ TOTP-based MFA verification  
✅ Backup code support  
✅ One-time use codes  
✅ Auto-removal of used codes  
✅ Full audit logging  
✅ Responsive UI  
✅ Security-first design  

**Security Benefits:**
🔐 Two-factor authentication required  
🔐 Time-based codes (expire every 30s)  
🔐 Backup codes for emergencies  
🔐 Hashed storage  
🔐 Complete audit trail  

**Status:** ✅ Implementation Complete & Ready for Testing




