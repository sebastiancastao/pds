# Supabase Security Setup Guide
## SQL Injection Prevention & Secure Configuration

This guide explains how the PDS Time Tracking System implements secure Supabase connections following all `.cursorrules` security requirements.

---

## 🔒 Security Features Implemented

### 1. **SQL Injection Prevention**

#### ✅ Parameterized Queries (Built-in)
Supabase client **automatically** uses parameterized queries, preventing SQL injection:

```typescript
// ✅ SAFE - Automatically parameterized
const { data } = await supabase
  .from('users')
  .select('*')
  .eq('email', userEmail); // userEmail is safely escaped

// ❌ UNSAFE (Never do this with raw SQL)
// await supabase.rpc('raw_query', { 
//   sql: `SELECT * FROM users WHERE email = '${userEmail}'` 
// });
```

#### ✅ Input Validation
All user inputs are validated BEFORE database operations:

```typescript
// Validate UUID format
if (!isValidUUID(userId)) {
  throw new Error('Invalid user ID');
}

// Validate email format
if (!isValidEmail(email)) {
  throw new Error('Invalid email');
}

// Sanitize string inputs
const safeName = sanitizeInput(userName);
```

#### ✅ Row Level Security (RLS)
Database-level security that **cannot be bypassed** by SQL injection:

```sql
-- Only users can see their own data
CREATE POLICY "Users can view own profile"
ON profiles FOR SELECT
USING (auth.uid() = user_id);
```

---

## 🛡️ Security Layers

### Layer 1: Client-Side Validation (First Line of Defense)
```typescript
// app/register/page.tsx
const VALIDATION_PATTERNS = {
  email: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  name: /^[a-zA-Z\s'-]{2,50}$/,
};

if (!VALIDATION_PATTERNS.email.test(email)) {
  setError('Invalid email format');
  return;
}
```

### Layer 2: API Route Validation (Server-Side)
```typescript
// app/api/auth/register/route.ts
const validation = validateRegistrationData(body);
if (!validation.isValid) {
  return NextResponse.json(
    { error: 'Invalid input', details: validation.errors },
    { status: 400 }
  );
}
```

### Layer 3: Supabase Parameterized Queries
```typescript
// lib/supabase.ts
const { data } = await supabase
  .from('users')
  .insert({ email, role }) // All parameters safely escaped
  .select();
```

### Layer 4: Database Row Level Security (RLS)
```sql
-- database/rls_policies.sql
CREATE POLICY "Prevent unauthorized access"
ON users FOR ALL
USING (auth.uid() = id);
```

---

## 📁 File Structure

```
lib/
├── supabase.ts              # Secure Supabase client setup
├── database.types.ts        # TypeScript database types
├── api-security.ts          # SQL injection prevention utilities
├── auth.ts                  # Password hashing, MFA
├── encryption.ts            # AES-256 encryption for PII
└── audit.ts                 # Audit logging

app/api/
└── auth/
    └── register/
        └── route.ts         # Secure registration API example

database/
├── schema.sql              # PostgreSQL schema with encryption
└── rls_policies.sql        # Row Level Security policies
```

---

## 🔧 Setup Instructions

### 1. Install Dependencies
```bash
npm install @supabase/supabase-js @supabase/auth-helpers-nextjs bcryptjs crypto-js speakeasy qrcode zod
npm install -D @types/bcryptjs @types/crypto-js @types/speakeasy @types/qrcode
```

### 2. Configure Environment Variables
Create `.env.local`:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Encryption
ENCRYPTION_KEY=your-32-character-encryption-key

# Security
NODE_ENV=production
```

### 3. Deploy Database Schema
```bash
# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Deploy schema
supabase db push

# Deploy RLS policies
psql -h db.your-project.supabase.co -U postgres -d postgres -f database/schema.sql
psql -h db.your-project.supabase.co -U postgres -d postgres -f database/rls_policies.sql
```

### 4. Enable Database Extensions
In Supabase Dashboard → SQL Editor:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```

### 5. Generate TypeScript Types
```bash
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > lib/database.types.ts
```

---

## 🚨 SQL Injection Attack Scenarios & Prevention

### Scenario 1: Email Field Injection
**❌ Vulnerable Code (Never do this):**
```typescript
// DON'T: String concatenation with user input
const query = `SELECT * FROM users WHERE email = '${userEmail}'`;
```

**Attacker Input:**
```
' OR '1'='1' --
```

**Result:** Returns all users (data breach)

**✅ Secure Code (Always do this):**
```typescript
// DO: Parameterized query
const { data } = await supabase
  .from('users')
  .select('*')
  .eq('email', userEmail); // Safely parameterized
```

### Scenario 2: UUID Injection
**❌ Vulnerable:**
```typescript
const userId = request.query.id; // No validation
await supabase.from('users').delete().eq('id', userId);
```

**Attacker Input:**
```
123e4567-e89b-12d3-a456-426614174000' OR '1'='1
```

**✅ Secure:**
```typescript
import { isValidUUID } from '@/lib/supabase';

const userId = request.query.id;
if (!isValidUUID(userId)) {
  throw new Error('Invalid user ID');
}
await supabase.from('users').delete().eq('id', userId);
```

### Scenario 3: Search Query Injection
**❌ Vulnerable:**
```typescript
const search = request.query.q;
// Using raw SQL or unvalidated text search
```

**✅ Secure:**
```typescript
import { sanitizeInput } from '@/lib/supabase';

const search = sanitizeInput(request.query.q);
const { data } = await supabase
  .from('users')
  .select('*')
  .ilike('email', `%${search}%`); // Supabase handles escaping
```

---

## 🧪 Testing SQL Injection Prevention

### Test Case 1: Email Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com'\'' OR '\''1'\''='\''1",
    "password": "test"
  }'

# Expected: 400 Bad Request (Invalid email format)
```

### Test Case 2: UUID Validation
```bash
curl -X GET "http://localhost:3000/api/users/123' OR '1'='1"

# Expected: 400 Bad Request (Invalid UUID format)
```

### Test Case 3: Search Query
```bash
curl -X GET "http://localhost:3000/api/users/search?q=admin'; DROP TABLE users;--"

# Expected: Safe search with sanitized input (no SQL executed)
```

---

## 📊 Security Monitoring

### Audit Logs
All database operations are logged:

```typescript
await logAuditEvent({
  userId: user.id,
  action: 'user.update',
  resourceType: 'user',
  resourceId: user.id,
  ipAddress: clientIP,
  userAgent: userAgent,
  metadata: { fields: ['email', 'role'] },
});
```

### Rate Limiting
Prevent brute force attacks:

```typescript
if (isRateLimited(`login:${clientIP}`, 5, 15 * 60 * 1000)) {
  return NextResponse.json(
    { error: 'Too many login attempts' },
    { status: 429 }
  );
}
```

### Failed Login Tracking
```sql
-- database/schema.sql
CREATE TABLE users (
  ...
  failed_login_attempts INTEGER DEFAULT 0,
  account_locked_until TIMESTAMPTZ,
  ...
);
```

---

## ✅ Security Checklist

- [x] **Parameterized Queries**: All Supabase queries use parameterization
- [x] **Input Validation**: All user inputs validated with Regex
- [x] **UUID Validation**: All IDs validated before database operations
- [x] **Email Validation**: Email format checked before queries
- [x] **String Sanitization**: SQL injection patterns removed
- [x] **Row Level Security**: RLS policies enforced at database level
- [x] **Rate Limiting**: Brute force attack prevention
- [x] **Audit Logging**: All security events logged
- [x] **PII Encryption**: AES-256 encryption for sensitive data
- [x] **Password Hashing**: Bcrypt with 12 salt rounds
- [x] **MFA Support**: TOTP-based multi-factor authentication
- [x] **Account Lockout**: After 5 failed login attempts
- [x] **Session Management**: Secure token storage with auto-refresh
- [x] **Error Handling**: Generic error messages (no info leakage)

---

## 🚀 Next Steps

1. **Deploy to Production**
   ```bash
   npm run build
   vercel deploy --prod
   ```

2. **Configure Supabase Production**
   - Enable RLS on all tables
   - Set up database backups
   - Configure email templates
   - Enable audit logging

3. **Security Testing**
   - Penetration testing
   - SQL injection tests
   - Rate limit tests
   - Authentication tests

4. **Monitoring**
   - Set up Sentry for error tracking
   - Configure Supabase logs
   - Monitor audit logs for suspicious activity

---

## 📞 Support

For security issues, contact: security@pds.com

**Never commit sensitive data to Git:**
- ❌ `.env.local`
- ❌ Service role keys
- ❌ Encryption keys
- ❌ Password hashes
- ❌ MFA secrets

