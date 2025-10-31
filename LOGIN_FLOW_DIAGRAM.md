# Login Flow Priority Diagram

## Overview
This document explains the exact flow when a user logs in, showing all priority checks and redirects.

---

## Priority Order (After Successful Login)

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER LOGS IN                              │
│                   (Email + Password Valid)                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│            PRIORITY 1: Check Background Check Status             │
│                                                                  │
│  Query: SELECT background_check_completed FROM users            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                    ┌─────────┴─────────┐
                    │                   │
        ┌───────────▼─────────┐   ┌────▼──────────┐
        │ background_check_   │   │ background_   │
        │ completed = FALSE   │   │ check_        │
        │                     │   │ completed =   │
        │                     │   │ TRUE          │
        └───────────┬─────────┘   └────┬──────────┘
                    │                   │
                    │                   ↓
                    │         ┌─────────────────────────────────────┐
                    │         │ PRIORITY 2: Check Temporary Password│
                    │         │                                      │
                    │         │ Query: SELECT is_temporary_password │
                    │         └─────────────────────────────────────┘
                    │                   ↓
                    │         ┌─────────┴─────────┐
                    │         │                   │
                    │   ┌─────▼──────┐   ┌───────▼────────┐
                    │   │ is_temp =  │   │ is_temp =      │
                    │   │ TRUE       │   │ FALSE          │
                    │   └─────┬──────┘   └───────┬────────┘
                    │         │                   │
                    ↓         ↓                   ↓
        ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
        │ REDIRECT TO  │  │ REDIRECT TO  │  │ REDIRECT TO  │
        │ /background- │  │ /password    │  │ /verify-mfa  │
        │ checks-form  │  │              │  │              │
        └──────────────┘  └──────────────┘  └──────────────┘
             │                  │                  │
             │                  │                  │
        Must complete      Must change       Must verify
        background         temporary         MFA code
        check form         password
```

---

## Detailed Flow Descriptions

### Scenario 1: New User (Never Completed Background Check)
```
User Login
  ↓
background_check_completed = false
  ↓
🔄 REDIRECT: /background-checks-form
  ↓
User completes PDF form + signature
  ↓
background_check_completed = true
  ↓
User logs in again
  ↓
Goes to Scenario 2 or 3
```

### Scenario 2: User with Completed Background Check + Temporary Password
```
User Login
  ↓
background_check_completed = true ✅
  ↓
is_temporary_password = true ⚠️
  ↓
🔄 REDIRECT: /password
  ↓
User changes password
  ↓
is_temporary_password = false
  ↓
Goes to Scenario 3
```

### Scenario 3: User with Completed Background Check + No Temporary Password
```
User Login
  ↓
background_check_completed = true ✅
  ↓
is_temporary_password = false ✅
  ↓
🔄 REDIRECT: /verify-mfa
  ↓
User enters MFA code
  ↓
MFA verified
  ↓
🔄 REDIRECT: /dashboard
```

---

## Priority Summary

| Priority | Check | If FALSE/NOT COMPLETED | If TRUE/COMPLETED |
|----------|-------|------------------------|-------------------|
| **1 (Highest)** | background_check_completed | → `/background-checks-form` | Continue to Priority 2 |
| **2** | is_temporary_password | Continue to Priority 3 | → `/password` |
| **3** | MFA verification | Setup MFA | → `/verify-mfa` |
| **Final** | All checks passed | N/A | → `/dashboard` |

---

## Console Debug Messages

When you log in, you'll see these messages in order:

### If Background Check NOT Completed:
```
[LOGIN DEBUG] ❌ Background check NOT completed (value: false)
[LOGIN DEBUG] 📋 Priority 1: Redirecting to /background-checks-form
[LOGIN DEBUG] → User must complete background check before password change or MFA
```

### If Background Check Completed + Has Temp Password:
```
[LOGIN DEBUG] ✅ Background check completed - moving to next check
[LOGIN DEBUG] ⚠️ User has temporary password
[LOGIN DEBUG] 🔑 Priority 2: Redirecting to /password
[LOGIN DEBUG] → Background check ✅ → Now changing password
```

### If Background Check Completed + No Temp Password:
```
[LOGIN DEBUG] ✅ Background check completed - moving to next check
[LOGIN DEBUG] ✅ No temporary password - continuing to MFA flow
[LOGIN DEBUG] → Background check ✅ → Password ✅ → Now MFA
```

---

## Important Notes

1. **Background check is ALWAYS checked first** - This is the highest priority
2. **Password change only happens AFTER background check is completed**
3. **MFA only happens AFTER both background check and password are complete**
4. **Once background_check_completed = true, user never sees that form again**

---

## Testing Different Scenarios

### Test Case 1: New User
```sql
-- Set user to need background check
UPDATE users
SET background_check_completed = false,
    is_temporary_password = true
WHERE email = 'test@example.com';
```
**Expected:** Redirect to `/background-checks-form` (ignores temp password)

### Test Case 2: Background Check Done, Need Password
```sql
-- Set user with completed background check but temp password
UPDATE users
SET background_check_completed = true,
    is_temporary_password = true
WHERE email = 'test@example.com';
```
**Expected:** Redirect to `/password`

### Test Case 3: Everything Complete
```sql
-- Set user fully set up
UPDATE users
SET background_check_completed = true,
    is_temporary_password = false
WHERE email = 'test@example.com';
```
**Expected:** Redirect to `/verify-mfa`
