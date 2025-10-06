# 🔧 Fix: "relation already exists" Error

## The Problem
```
ERROR: 42P07: relation "users" already exists
```

This means you're trying to run the full `schema.sql` on a database that already has tables.

---

## ✅ Quick Fix - Run This Instead

You **DON'T** need to recreate all tables. You only need to **add the new temporary password fields**.

### **Use This Script:**

1. Open **Supabase Dashboard → SQL Editor**
2. Copy and paste: **`ADD_TEMPORARY_PASSWORD_FIELDS.sql`**
3. Click **Run**
4. Done! ✅

This script:
- ✅ Only adds the 4 new temporary password fields
- ✅ Preserves all existing data
- ✅ Safe to run multiple times
- ✅ Uses `IF NOT EXISTS` checks
- ✅ Shows you exactly what was added

---

## 📋 What Gets Added

The script adds these 4 fields to your existing `profiles` table:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `is_temporary_password` | BOOLEAN | `false` | Marks if password is temporary |
| `must_change_password` | BOOLEAN | `false` | Force password change on login |
| `password_expires_at` | TIMESTAMPTZ | `NULL` | When temporary password expires |
| `last_password_change` | TIMESTAMPTZ | `NULL` | Last password change timestamp |

---

## ✅ Verify It Worked

After running the script, verify with this query:

```sql
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'profiles'
AND column_name IN (
  'is_temporary_password',
  'must_change_password',
  'password_expires_at',
  'last_password_change'
);
```

**Expected Result:** You should see **4 rows**.

---

## 🎯 Next Steps

After adding the fields:

1. **Create your test user:**
   ```bash
   # Run in Supabase SQL Editor
   # database/create_test_user.sql
   ```

2. **Test login with temporary password:**
   - Email: sebastiancastao379@gmail.com
   - Password: Test123!@#
   - System will require password change on first login

---

## 📚 Alternative: Full Migration Script

If you want to add **ALL** new MFA and temporary password fields at once:

```bash
# Run in Supabase SQL Editor
# database/migrations/001_add_mfa_fields.sql
```

This adds:
- MFA authentication fields
- Temporary password fields
- Sessions table
- Password resets table

---

## ⚠️ DON'T Run These

**Don't run these scripts on an existing database:**
- ❌ `database/schema.sql` - Will try to recreate all tables
- ❌ Any script with `CREATE TABLE users` - Table already exists

**Only run these:**
- ✅ `ADD_TEMPORARY_PASSWORD_FIELDS.sql` - Just adds new fields
- ✅ `database/migrations/001_add_mfa_fields.sql` - Migration with checks

---

## 🔍 Troubleshooting

### Error: "column already exists"
✅ **Good news!** The column is already there. Script will skip it.

### Error: "permission denied"
❌ Make sure you're using Supabase SQL Editor (has admin permissions).

### Want to start completely fresh?
⚠️ **Only if you want to DELETE ALL DATA:**

```sql
-- WARNING: This deletes EVERYTHING
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;

-- Then run database/schema.sql
```

---

## ✅ Summary

**Problem:** Tried to run `schema.sql` on existing database  
**Solution:** Run `ADD_TEMPORARY_PASSWORD_FIELDS.sql` instead  
**Result:** Only adds new fields, keeps all data  

Run the script now! 🚀

