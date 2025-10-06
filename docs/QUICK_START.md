# 🚀 Quick Start Guide

## ✅ What's Done

Your Supabase credentials are securely configured:

```
URL: https://bwvnvzlmqqcdemkpecjw.supabase.co
Anon Key: ✅ Configured
Login: ✅ Integrated
Security: ✅ Enabled
```

## ⚡ Next 3 Steps

### 1️⃣ Add Service Role Key (2 minutes)

1. Visit: https://supabase.com/dashboard/project/bwvnvzlmqqcdemkpecjw/settings/api
2. Copy the `service_role` key
3. Open `.env.local` in your project
4. Replace `your-service-role-key-here` with your key

### 2️⃣ Generate Encryption Key (1 minute)

Run in PowerShell:
```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

Copy the output to `.env.local`, replace `your-encryption-key-here`

### 3️⃣ Setup Database (5 minutes)

1. Go to: https://supabase.com/dashboard/project/bwvnvzlmqqcdemkpecjw/sql
2. Run these files in order:
   - `database/schema.sql` (creates tables)
   - `database/rls_policies.sql` (enables security)
   - `database/create_test_user.sql` (optional test user)

## 🎯 Test It

```bash
npm install
npm run dev
```

Visit: http://localhost:3000/login

Test with:
- Email: `test@pds.com`
- Password: `TestPassword123!`

## 📚 Full Documentation

- **Complete Setup**: See `SUPABASE_INTEGRATION_COMPLETE.md`
- **Step-by-Step**: See `ENV_SETUP_INSTRUCTIONS.md`

## ⚠️ Important

- `.env.local` is already in `.gitignore` (secure ✓)
- Never share your service role key
- Restart dev server after editing `.env.local`

That's it! 🎉

