# Apply Email MFA Database Migration

**Quick Start Guide** - 2 minutes to complete

---

## Step 1: Copy the Migration SQL

Open this file: `database/migrations/005_add_email_mfa_fields.sql`

Copy ALL the contents (Ctrl+A, Ctrl+C)

---

## Step 2: Open Supabase SQL Editor

1. Go to your Supabase project: https://supabase.com/dashboard
2. Click on your **PDS Time Tracking** project
3. Click **SQL Editor** in the left sidebar
4. Click **+ New Query**

---

## Step 3: Run the Migration

1. Paste the SQL into the editor
2. Click **Run** (or press Ctrl+Enter)
3. Wait for success message

**Expected Output:**
```
Email MFA fields added successfully
✓ mfa_setup_code
✓ mfa_setup_code_expires_at
✓ mfa_login_code
✓ mfa_login_code_expires_at
```

---

## Step 4: Verify the Migration

Run this verification query:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name IN (
    'mfa_setup_code',
    'mfa_setup_code_expires_at',
    'mfa_login_code',
    'mfa_login_code_expires_at'
  );
```

**Expected Result:** 4 rows showing the new columns

---

## Step 5: Test the System

1. **Stop your dev server** (if running): Ctrl+C
2. **Restart dev server**: `npm run dev`
3. **Test MFA Setup:**
   - Go to: http://localhost:3000/mfa-setup
   - Click "Send Verification Code"
   - Check your email for the code
   - Enter code and verify
4. **Test MFA Login:**
   - Logout
   - Login again
   - Should redirect to `/verify-mfa`
   - Check email for code
   - Enter code to complete login

---

## Troubleshooting

### Error: "column already exists"
**Solution:** Migration was already applied. Safe to ignore.

### Error: "permission denied"
**Solution:** You need **Owner** or **Admin** access to the Supabase project.

### Error: "syntax error"
**Solution:** Make sure you copied the ENTIRE file contents.

### No email received
**Check:**
1. ✅ `RESEND_API_KEY` set in `.env.local`
2. ✅ Resend API key is valid
3. ✅ Check spam folder
4. ✅ Check Resend dashboard for send logs

---

## Environment Variables Required

Make sure these are in your `.env.local`:

```bash
# Supabase (Required)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Email (Required for MFA emails)
RESEND_API_KEY=re_your_resend_api_key

# App URL (Optional, defaults to localhost)
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Migration Complete ✅

Email-based MFA is now active!

**What changed:**
- ✉️ Users receive 6-digit codes via email
- 🔐 Codes are hashed and stored securely
- ⏱️ Codes expire after 10 minutes
- 📝 All events logged for compliance

**Next Steps:**
- Test the MFA setup flow
- Test the MFA login flow
- Verify emails are being sent
- Check audit logs in Supabase

---

**Need Help?**  
See: `docs/EMAIL_MFA_IMPLEMENTATION.md` for full documentation

