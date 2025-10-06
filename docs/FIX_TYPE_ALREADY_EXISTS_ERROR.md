# 🔧 Fix: "type already exists" Error

## The Problem
```
ERROR: 42710: type "user_role" already exists
```

This means you already have enum types in your database and the script is trying to create them again.

---

## ✅ Quick Fix (Choose One Option)

### **Option 1: Use Migration Script (RECOMMENDED - Preserves Data)**

This is the safest option if you have existing data.

1. Go to **Supabase Dashboard → SQL Editor**
2. Copy and paste the contents of: `database/migrations/001_add_mfa_fields.sql`
3. Click **Run**
4. Done! ✅

**What this does:**
- Adds new MFA authentication fields
- Preserves all existing data
- Safe to run multiple times
- Uses `IF NOT EXISTS` checks

---

### **Option 2: Use Updated Schema (For Fresh Start)**

Use this if you want to start completely fresh (⚠️ **DELETES ALL DATA**).

1. The `database/schema.sql` file has been updated with:
   ```sql
   DROP TYPE IF EXISTS user_role CASCADE;
   DROP TYPE IF EXISTS division_type CASCADE;
   -- etc...
   ```

2. Go to **Supabase Dashboard → SQL Editor**
3. Copy and paste the contents of: `database/schema.sql`
4. Click **Run**
5. Done! ✅

**⚠️ WARNING:** This will drop all tables and recreate them (all data will be lost).

---

## 📊 Verify It Worked

After running either option, verify with this query:

```sql
-- Check if new MFA columns exist
SELECT 
  column_name,
  data_type
FROM information_schema.columns 
WHERE table_name = 'profiles' 
AND column_name IN ('password_hash', 'mfa_secret', 'mfa_enabled', 'backup_codes');
```

**Expected Result:** You should see 4 rows showing the new columns.

---

## 🎯 What Changed

The database now has these new fields for MFA authentication:

### In `users` table:
- `failed_login_attempts` - Track failed login attempts
- `account_locked_until` - Account lockout timestamp

### In `profiles` table:
- `password_hash` - Bcrypt hashed password
- `mfa_secret` - TOTP secret for MFA
- `mfa_enabled` - MFA enabled flag
- `backup_codes` - Array of hashed backup codes

### New tables:
- `sessions` - User session management
- `password_resets` - Password reset tokens

---

## 📚 More Information

See `database/DATABASE_SETUP_GUIDE.md` for comprehensive setup instructions.

---

## Still Getting Errors?

### Error: "column already exists"
✅ **Good news!** The column is already there. This is actually success - the migration already ran.

### Error: "relation already exists"
✅ **Good news!** The table is already there. Use the migration script instead of the full schema.

### Error: "permission denied"
❌ Make sure you're using the Supabase SQL Editor (has full permissions) or check your RLS policies.

