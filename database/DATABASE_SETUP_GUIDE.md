# Database Setup Guide - PDS Time keepingSystem

## Error Resolution: "type already exists"

If you encounter errors like `ERROR: 42710: type "user_role" already exists`, you have two options:

---

## Option 1: Fresh Database (Recommended for Development)

Use this if you're starting fresh or don't have existing data to preserve.

### Steps:

1. **In Supabase Dashboard → SQL Editor:**
   ```sql
   -- This will run the full schema with DROP TYPE IF EXISTS
   -- Safe to run multiple times
   ```

2. **Run:** `database/schema.sql`
   - This file now includes `DROP TYPE IF EXISTS` statements
   - Will recreate all types and tables from scratch
   - ⚠️ **WARNING:** This will delete all existing data!

---

## Option 2: Migration Script (Recommended for Existing Data)

Use this if you already have data in your database and want to preserve it.

### Steps:

1. **In Supabase Dashboard → SQL Editor:**
   ```sql
   -- Run the migration script
   ```

2. **Run:** `database/migrations/001_add_mfa_fields.sql`
   - Adds new MFA authentication fields
   - Preserves existing data
   - Safe to run multiple times (checks if columns exist)
   - Removes old PIN/QR authentication fields

---

## What Each File Does

### `database/schema.sql`
- **Purpose:** Full database schema from scratch
- **Use When:** 
  - Setting up a new database
  - Resetting development database
  - Initial production deployment
- **Warning:** Drops and recreates all types (will cascade delete dependent tables)

### `database/migrations/001_add_mfa_fields.sql`
- **Purpose:** Update existing database with new MFA fields
- **Use When:**
  - You have existing data
  - Upgrading from old authentication system
  - Production database updates
- **Safety:** Uses `IF NOT EXISTS` checks, preserves data

### `database/rls_policies.sql`
- **Purpose:** Row Level Security policies
- **Use When:** After running schema or migrations
- **Safety:** Always safe to run

---

## Step-by-Step Setup

### For New Database (No existing data):

```bash
# 1. Go to Supabase Dashboard → SQL Editor

# 2. Run schema.sql
# Copy and paste contents of database/schema.sql

# 3. Run RLS policies
# Copy and paste contents of database/rls_policies.sql

# 4. Verify
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public';
```

### For Existing Database (Preserve data):

```bash
# 1. Go to Supabase Dashboard → SQL Editor

# 2. Run migration script
# Copy and paste contents of database/migrations/001_add_mfa_fields.sql

# 3. Update RLS policies (if needed)
# Copy and paste contents of database/rls_policies.sql

# 4. Verify new columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'profiles' 
AND column_name IN ('password_hash', 'mfa_secret', 'mfa_enabled', 'backup_codes');
```

---

## Troubleshooting

### Error: "type user_role already exists"

**Solution:** Use the migration script instead of the full schema.

```sql
-- Option A: Run migration (preserves data)
-- Run: database/migrations/001_add_mfa_fields.sql

-- Option B: Force recreate (loses data)
DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS division_type CASCADE;
DROP TYPE IF EXISTS document_type CASCADE;
DROP TYPE IF EXISTS onboarding_status CASCADE;
DROP TYPE IF EXISTS clock_action CASCADE;
-- Then run schema.sql
```

### Error: "column already exists"

**Solution:** The migration script handles this automatically. If you see this error, the column is already there (which is good!).

### Error: "relation already exists"

**Solution:** Table already exists. Use migration script instead of full schema.

---

## Verification Queries

### Check if tables exist:
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
```

### Check if new MFA columns exist:
```sql
SELECT 
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name IN ('users', 'profiles') 
AND column_name IN (
  'password_hash', 
  'mfa_secret', 
  'mfa_enabled', 
  'backup_codes',
  'failed_login_attempts',
  'account_locked_until'
)
ORDER BY table_name, column_name;
```

### Check if types exist:
```sql
SELECT typname 
FROM pg_type 
WHERE typname IN (
  'user_role', 
  'division_type', 
  'document_type', 
  'onboarding_status', 
  'clock_action'
);
```

### Count records in tables:
```sql
SELECT 
  (SELECT COUNT(*) FROM users) as users_count,
  (SELECT COUNT(*) FROM profiles) as profiles_count,
  (SELECT COUNT(*) FROM audit_logs) as audit_logs_count,
  (SELECT COUNT(*) FROM documents) as documents_count;
```

---

## Migration Checklist

- [ ] Backup existing database (if in production)
- [ ] Run migration script in test environment first
- [ ] Verify new columns exist
- [ ] Verify existing data is intact
- [ ] Update RLS policies
- [ ] Test authentication with new MFA fields
- [ ] Update application code to use new fields
- [ ] Monitor for errors in production

---

## Rollback (Emergency)

If something goes wrong, you can rollback the migration:

```sql
-- Rollback 001_add_mfa_fields.sql
DROP TABLE IF EXISTS public.password_resets CASCADE;
DROP TABLE IF EXISTS public.sessions CASCADE;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS password_hash;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS mfa_secret;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS mfa_enabled;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS backup_codes;
ALTER TABLE public.users DROP COLUMN IF EXISTS failed_login_attempts;
ALTER TABLE public.users DROP COLUMN IF EXISTS account_locked_until;
```

---

## Production Deployment

### Before Deployment:
1. ✅ Test migration in development
2. ✅ Test migration in staging
3. ✅ Backup production database
4. ✅ Schedule maintenance window
5. ✅ Notify users of downtime

### During Deployment:
1. Put application in maintenance mode
2. Backup database
3. Run migration script
4. Verify new columns
5. Update application code
6. Run smoke tests
7. Exit maintenance mode

### After Deployment:
1. Monitor error logs
2. Check audit logs
3. Verify MFA setup works
4. Test login flows
5. Monitor performance

---

## Next Steps

After database setup:

1. **Generate TypeScript types:**
   ```bash
   npx supabase gen types typescript --project-id YOUR_PROJECT_ID > lib/database.types.ts
   ```

2. **Configure environment variables:**
   - Copy `.env.example` to `.env.local`
   - Add your Supabase credentials

3. **Test the connection:**
   ```bash
   npm run dev
   # Test registration endpoint
   ```

4. **Enable RLS on all tables** in Supabase Dashboard

5. **Set up monitoring** for failed authentication attempts

---

## Support

For issues with database setup:
1. Check Supabase logs in Dashboard → Logs
2. Review error messages carefully
3. Use verification queries above
4. Check that all environment variables are set

Common issues:
- Type already exists → Use migration script
- Column already exists → Already migrated (verify with query)
- Permission denied → Check RLS policies
- Connection error → Verify environment variables



