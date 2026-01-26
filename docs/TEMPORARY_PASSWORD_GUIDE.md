# Temporary Password System - Implementation Guide

## Overview

The PDS Time Keeping System now supports temporary passwords for secure user onboarding and password resets. This feature ensures users change their passwords on first login and provides time-based password expiration.

---

## 🔒 New Database Fields

### Added to `profiles` table:

| Field | Type | Description |
|-------|------|-------------|
| `is_temporary_password` | BOOLEAN | Marks if the current password is temporary |
| `must_change_password` | BOOLEAN | Forces password change on next login |
| `password_expires_at` | TIMESTAMPTZ | When the temporary password expires |
| `last_password_change` | TIMESTAMPTZ | Tracks when password was last changed |

---

## 🚀 Use Cases

### 1. **Admin Creates User Account**
```sql
-- Admin creates a new employee with temporary password
INSERT INTO profiles (
  user_id,
  password_hash,
  is_temporary_password,
  must_change_password,
  password_expires_at,
  ...
) VALUES (
  user_id,
  hash('TempPass123!'),
  true, -- Temporary password
  true, -- Must change on first login
  NOW() + INTERVAL '24 hours', -- Expires in 24 hours
  ...
);
```

### 2. **Password Reset Flow**
```sql
-- User requests password reset
UPDATE profiles
SET 
  password_hash = hash('ResetPass456!'),
  is_temporary_password = true,
  must_change_password = true,
  password_expires_at = NOW() + INTERVAL '1 hour',
  last_password_change = NOW()
WHERE user_id = 'user-uuid';
```

### 3. **New Employee Onboarding**
```sql
-- HR creates account with temporary credentials
-- Employee receives email with temporary password
-- On first login, forced to change password
```

---

## 🔐 Security Benefits

### ✅ Enhanced Security
- Prevents long-term use of admin-generated passwords
- Enforces password changes after resets
- Time-based expiration reduces attack window
- Tracks password change history for compliance

### ✅ Compliance Requirements
- **SOC2**: Enforces password change after admin access
- **FLSA**: Ensures employee-controlled credentials
- **IRS/DOL**: Audit trail for password changes
- **PII Protection**: Prevents stale credential exposure

---

## 📝 Implementation Logic

### Login Flow with Temporary Password Check

```typescript
// app/api/auth/login/route.ts
async function handleLogin(email: string, password: string) {
  // 1. Verify credentials
  const user = await getUserByEmail(email);
  const isValidPassword = await verifyPassword(password, user.profile.password_hash);
  
  if (!isValidPassword) {
    return { error: 'Invalid credentials' };
  }
  
  // 2. Check if password is expired
  if (user.profile.password_expires_at && 
      new Date(user.profile.password_expires_at) < new Date()) {
    return { 
      error: 'Password expired',
      action: 'require_password_reset'
    };
  }
  
  // 3. Check if password change required
  if (user.profile.must_change_password) {
    return {
      success: true,
      action: 'require_password_change',
      message: 'You must change your password before continuing'
    };
  }
  
  // 4. Normal login
  return { success: true, user };
}
```

### Password Change Flow

```typescript
// app/api/auth/change-password/route.ts
async function changePassword(userId: string, newPassword: string) {
  // 1. Validate new password strength
  const validation = validatePassword(newPassword);
  if (!validation.isValid) {
    return { error: 'Password does not meet requirements' };
  }
  
  // 2. Hash new password
  const passwordHash = await hashPassword(newPassword);
  
  // 3. Update profile
  await supabase
    .from('profiles')
    .update({
      password_hash: passwordHash,
      is_temporary_password: false, // No longer temporary
      must_change_password: false, // Requirement fulfilled
      password_expires_at: null, // No expiration
      last_password_change: new Date().toISOString(),
    })
    .eq('user_id', userId);
    
  return { success: true };
}
```

---

## 🎯 Example: Create User with Temporary Password

### SQL Script

```sql
-- Create user with 24-hour temporary password
DO $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Create user
  INSERT INTO users (email, role, division)
  VALUES ('newemployee@pds.com', 'worker', 'vendor')
  RETURNING id INTO v_user_id;
  
  -- Create profile with temporary password
  INSERT INTO profiles (
    user_id,
    first_name,
    last_name,
    password_hash,
    is_temporary_password,
    must_change_password,
    password_expires_at,
    last_password_change
  ) VALUES (
    v_user_id,
    'John',
    'Doe',
    crypt('WelcomePDS2024!', gen_salt('bf', 12)), -- Temporary password
    true, -- Mark as temporary
    true, -- Force change on first login
    NOW() + INTERVAL '24 hours', -- Expires in 24 hours
    NOW()
  );
END $$;
```

### API Endpoint (Future Implementation)

```typescript
// app/api/admin/create-user/route.ts
export async function POST(request: NextRequest) {
  const { email, firstName, lastName, role, division } = await request.json();
  
  // Generate secure temporary password
  const tempPassword = generateSecurePassword(); // e.g., "Temp#2024-Abc123"
  const passwordHash = await hashPassword(tempPassword);
  
  // Create user
  const { data: user } = await supabase
    .from('users')
    .insert({ email, role, division })
    .select()
    .single();
  
  // Create profile with temporary password
  await supabase
    .from('profiles')
    .insert({
      user_id: user.id,
      first_name: encrypt(firstName),
      last_name: encrypt(lastName),
      password_hash: passwordHash,
      is_temporary_password: true,
      must_change_password: true,
      password_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      last_password_change: new Date(),
    });
  
  // Send welcome email with temporary password
  await sendWelcomeEmail(email, tempPassword);
  
  return NextResponse.json({ success: true, email });
}
```

---

## ⏰ Password Expiration Handling

### Check for Expired Passwords (Cron Job)

```sql
-- Find users with expired temporary passwords
SELECT 
  u.email,
  p.password_expires_at,
  u.id
FROM users u
JOIN profiles p ON u.id = p.user_id
WHERE p.is_temporary_password = true
  AND p.password_expires_at < NOW()
  AND u.is_active = true;
```

### Auto-Lock Expired Accounts

```sql
-- Lock accounts with expired temporary passwords
UPDATE users
SET is_active = false
WHERE id IN (
  SELECT u.id
  FROM users u
  JOIN profiles p ON u.id = p.user_id
  WHERE p.is_temporary_password = true
    AND p.password_expires_at < NOW()
    AND u.is_active = true
);

-- Send notification email to users
```

---

## 📊 Audit Logging

### Track Password Changes

```typescript
// After successful password change
await logAuditEvent({
  userId: user.id,
  action: 'password.changed',
  resourceType: 'profile',
  resourceId: user.id,
  metadata: {
    was_temporary: oldProfile.is_temporary_password,
    days_since_last_change: daysSince(oldProfile.last_password_change),
  },
});
```

### Track Expired Password Login Attempts

```typescript
// When user tries to login with expired password
await logAuditEvent({
  userId: user.id,
  action: 'login.failed.password_expired',
  resourceType: 'auth',
  resourceId: user.id,
  metadata: {
    expired_at: user.profile.password_expires_at,
    hours_expired: hoursExpired,
  },
});
```

---

## 🔧 Deployment Steps

### 1. Update Database Schema

**Option A: New Database**
```bash
# Run full schema
# In Supabase SQL Editor: database/schema.sql
```

**Option B: Existing Database**
```bash
# Run migration
# In Supabase SQL Editor: database/migrations/001_add_mfa_fields.sql
```

### 2. Verify Fields Were Added

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'profiles'
AND column_name IN (
  'is_temporary_password',
  'must_change_password',
  'password_expires_at',
  'last_password_change'
);
```

Expected output: 4 rows

### 3. Test Temporary Password Creation

```bash
# Run test user script
# In Supabase SQL Editor: database/create_test_user.sql
```

### 4. Verify Test User

```sql
SELECT 
  u.email,
  p.is_temporary_password,
  p.must_change_password,
  p.password_expires_at,
  p.last_password_change
FROM users u
JOIN profiles p ON u.id = p.user_id
WHERE u.email = 'sebastiancastao379@gmail.com';
```

Expected:
- `is_temporary_password`: `true`
- `must_change_password`: `true`
- `password_expires_at`: 24 hours from now
- `last_password_change`: current timestamp

---

## 🎨 UI/UX Considerations

### Login Page Flow

```typescript
// Detect temporary password on login
if (loginResponse.action === 'require_password_change') {
  // Redirect to forced password change page
  router.push('/auth/change-password?forced=true');
}

if (loginResponse.error === 'Password expired') {
  // Show password reset flow
  router.push('/auth/reset-password');
}
```

### Password Change Modal

```tsx
// components/ForcePasswordChange.tsx
<Modal isOpen={mustChangePassword} closable={false}>
  <h2>Password Change Required</h2>
  <p>You must change your temporary password before continuing.</p>
  
  <PasswordChangeForm
    onSuccess={() => {
      // Continue to dashboard
      router.push('/dashboard');
    }}
  />
</Modal>
```

### Expiration Warning

```tsx
// Show warning if password expires soon
{passwordExpiresIn < 2 && (
  <Alert type="warning">
    Your temporary password expires in {passwordExpiresIn} hours.
    Please change it now to avoid being locked out.
  </Alert>
)}
```

---

## 📋 Best Practices

### ✅ DO
- ✅ Set expiration to 24-72 hours for onboarding
- ✅ Set expiration to 1 hour for password resets
- ✅ Send email notification with temporary password
- ✅ Log all password changes for audit trail
- ✅ Require strong passwords even for temporary ones
- ✅ Lock accounts after password expiration

### ❌ DON'T
- ❌ Allow weak temporary passwords
- ❌ Set expiration longer than 7 days
- ❌ Allow users to keep temporary passwords
- ❌ Skip logging password changes
- ❌ Forget to update `last_password_change`

---

## 🧪 Testing Checklist

- [ ] Create user with temporary password
- [ ] Verify login with temporary password works
- [ ] Verify forced password change flow
- [ ] Test password expiration (set to 1 minute for testing)
- [ ] Test login with expired temporary password
- [ ] Verify audit logs are created
- [ ] Test password change updates all flags correctly
- [ ] Test account locking on expiration

---

## 📞 Support

For questions about temporary passwords:
- See `database/create_test_user.sql` for examples
- Check audit logs for password change events
- Review `database/DATABASE_SETUP_GUIDE.md` for troubleshooting

---

## ✅ Summary

**Temporary password fields added:**
- `is_temporary_password` - Flag for temporary passwords
- `must_change_password` - Force change on next login
- `password_expires_at` - Expiration timestamp
- `last_password_change` - Change history keeping

**Use cases:**
- Admin-created accounts
- Password resets
- New employee onboarding
- Security-forced password changes

**Security benefits:**
- Enforces password changes
- Time-based expiration
- Audit trail compliance
- Prevents stale credentials

