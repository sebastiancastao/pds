# 🔧 Fix: 404 Error on Send Credentials Endpoint

## Problem
You're seeing `POST /api/auth/send-credentials 404` errors when trying to send user credentials.

## Root Cause
The application is **missing the `.env.local` file** which contains critical environment variables needed for:
- Supabase database connection
- Resend email API
- Application configuration

Without these variables, API routes fail silently or return 404 errors.

---

## ✅ **SOLUTION: Create .env.local File**

### Step 1: Create the File

Create a new file named `.env.local` in your project root:

```
C:\Users\sebas\OneDrive\Escritorio\PDS\.env.local
```

### Step 2: Add Environment Variables

Copy and paste this content into `.env.local`:

```env
# ============================================
# Supabase Configuration
# ============================================
# Get these from: https://app.supabase.com/project/YOUR_PROJECT/settings/api

NEXT_PUBLIC_SUPABASE_URL=https://bwvnvzlmqqcdemkpecjw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# ============================================
# Resend Email API
# ============================================
# Get your API key from: https://resend.com/api-keys
# Free tier: 100 emails/day, 3,000/month
RESEND_API_KEY=re_your_api_key_here

# ============================================
# Application Configuration
# ============================================
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=PDS Time Tracking System

# ============================================
# MFA/TOTP Configuration
# ============================================
TOTP_ISSUER=PDS Time Tracking
TOTP_WINDOW=1
```

### Step 3: Fill in Your Actual Values

#### **Get Supabase Keys:**
1. Go to: https://app.supabase.com/project/bwvnvzlmqqcdemkpecjw/settings/api
2. Copy **Project URL** → Replace `NEXT_PUBLIC_SUPABASE_URL`
3. Copy **anon public** key → Replace `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Copy **service_role** key → Replace `SUPABASE_SERVICE_ROLE_KEY`

⚠️ **CRITICAL:** Never commit `service_role` key to git!

#### **Get Resend API Key:**
1. Go to: https://resend.com/api-keys
2. Create a new API key (or use existing)
3. Copy the key → Replace `RESEND_API_KEY`

**Free Tier Limits:**
- 100 emails per day
- 3,000 emails per month
- Perfect for testing!

### Step 4: Restart Your Dev Server

After creating `.env.local`:

```bash
# Stop the current server (Ctrl+C)

# Restart it
npm run dev
```

---

## 🧪 **Test the Fix**

### Test 1: Check Environment Variables Loaded

Visit your app and open browser console:

```javascript
console.log('Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL)
// Should show: https://bwvnvzlmqqcdemkpecjw.supabase.co
```

### Test 2: Create a Test User

1. Go to: http://localhost:3000/signup
2. Fill in user details:
   - First Name: Test
   - Last Name: User
   - Email: test@example.com
   - Role: Worker
   - Division: Vendor

3. Click "Create User"
4. You should see the generated password (like `3ythHu#BE#2@yhL4`)
5. Click "📧 Send Credentials" button

### Expected Result:
- ✅ No 404 error
- ✅ Email sent successfully via Resend
- ✅ User receives email with temporary password

---

## 🐛 **Troubleshooting**

### Still Getting 404?

**Check 1: Server Running?**
```bash
# Make sure dev server is running
npm run dev
```

**Check 2: File Location Correct?**
```
.env.local must be in project root, NOT in subfolders:
✅ C:\Users\sebas\OneDrive\Escritorio\PDS\.env.local
❌ C:\Users\sebas\OneDrive\Escritorio\PDS\app\.env.local
```

**Check 3: Environment Variables Loading?**

Create a test API route to verify:

```typescript
// app/api/test-env/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasSupabaseAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    hasResendKey: !!process.env.RESEND_API_KEY,
  });
}
```

Visit: http://localhost:3000/api/test-env

Should show:
```json
{
  "hasSupabaseUrl": true,
  "hasSupabaseAnonKey": true,
  "hasServiceRoleKey": true,
  "hasResendKey": true
}
```

### Email Not Sending?

**Check 1: Resend API Key Valid?**
```bash
# Test your Resend API key
curl https://api.resend.com/emails \
  -H "Authorization: Bearer re_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "onboarding@resend.dev",
    "to": "your-email@example.com",
    "subject": "Test Email",
    "html": "<p>Test from PDS</p>"
  }'
```

**Check 2: Check Terminal Output**

When you click "Send Credentials", check your terminal for:
```
✅ Email sent successfully via Resend!
   To: test@example.com
   Message ID: abc123...
```

Or errors:
```
❌ Resend error: Invalid API key
❌ Resend error: Rate limit exceeded
```

**Check 3: Verify Resend Dashboard**

Go to: https://resend.com/emails

You should see your sent emails in the logs.

---

## 📋 **Complete Workflow After Fix**

1. **Create User** (via /signup page)
   - Generates secure temporary password
   - Stores hashed password in database
   - Sets `is_temporary_password = true`

2. **Send Credentials** (click button)
   - POST to `/api/auth/send-credentials`
   - Sends email via Resend
   - User receives temporary password

3. **User Logs In** (via /login page)
   - Enters email + temporary password
   - Supabase authenticates
   - Detects `is_temporary_password = true`
   - Redirects to `/register` to set new password

4. **User Sets New Password** (via /register page)
   - Must meet password requirements (12+ chars, etc.)
   - Updates password hash
   - Sets `is_temporary_password = false`
   - Next login → normal dashboard

---

## 🔐 **Security Notes**

### Never Share These Keys:
- ❌ `SUPABASE_SERVICE_ROLE_KEY` - Bypasses all security!
- ❌ `RESEND_API_KEY` - Could be used to spam emails

### Safe to Share:
- ✅ `NEXT_PUBLIC_SUPABASE_URL` - Public by design
- ✅ `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Protected by RLS
- ✅ `NEXT_PUBLIC_APP_URL` - Just a URL

### Git Safety:
```bash
# .gitignore already contains:
.env.local
.env*.local

# This prevents accidental commits of secrets
```

---

## 📚 **Related Documentation**

- [Environment Setup Instructions](./ENV_SETUP_INSTRUCTIONS.md)
- [Email API Recommendations](./EMAIL_API_RECOMMENDATIONS.md)
- [Temporary Password Guide](./TEMPORARY_PASSWORD_GUIDE.md)
- [Resend Integration Complete](./RESEND_INTEGRATION_COMPLETE.md)

---

## ✅ **Quick Checklist**

- [ ] Created `.env.local` in project root
- [ ] Added Supabase URL and keys
- [ ] Added Resend API key
- [ ] Restarted dev server
- [ ] Tested user creation
- [ ] Successfully sent credentials email
- [ ] Verified email received

---

**Need Help?**

If you're still experiencing issues after following this guide, check:
1. Terminal output for specific error messages
2. Browser console for client-side errors
3. Resend dashboard for email delivery status
4. Supabase logs for database errors

