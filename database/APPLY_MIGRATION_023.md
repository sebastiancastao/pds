# CRITICAL: Apply Migration 023 - Background Check Column

## This migration MUST be applied before the background check feature will work!

### Step 1: Check if column exists

Run this in Supabase SQL Editor:

```sql
-- Check if background_check_completed column exists
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'users'
AND column_name IN ('background_check_completed', 'background_check_completed_at');
```

**Expected result:** Should return 2 rows (one for each column)

If it returns 0 rows, proceed to Step 2.

---

### Step 2: Apply the migration

Copy and paste this SQL into your Supabase SQL Editor:

```sql
-- Migration 023: Add background_check_completed column to users table
-- This column tracks whether a user has completed the background check form during onboarding

-- Add the background_check_completed column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS background_check_completed BOOLEAN DEFAULT FALSE;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_users_background_check_completed ON users(background_check_completed);

-- Add completed_at timestamp for tracking when the background check was completed
ALTER TABLE users ADD COLUMN IF NOT EXISTS background_check_completed_at TIMESTAMP WITH TIME ZONE;

-- Comment on columns
COMMENT ON COLUMN users.background_check_completed IS 'Indicates whether the user has completed the background check waiver form';
COMMENT ON COLUMN users.background_check_completed_at IS 'Timestamp when the background check form was completed';
```

---

### Step 3: Verify the migration was applied

Run this query to verify:

```sql
-- Check all users and their background check status
SELECT
  id,
  email,
  is_temporary_password,
  background_check_completed,
  background_check_completed_at,
  created_at
FROM users
ORDER BY created_at DESC
LIMIT 10;
```

**Expected result:** All users should have `background_check_completed = false` by default

---

### Step 4: (Optional) Set existing users as completed

If you want to mark all existing users as having completed the background check (so only new users need to complete it), run:

```sql
-- Mark all existing users as having completed background check
UPDATE users
SET
  background_check_completed = true,
  background_check_completed_at = NOW()
WHERE created_at < NOW();
```

**NOTE:** Only run this if you want existing users to skip the background check form!

---

## Troubleshooting

### If user data returns NULL in console

Check if the user exists in the users table:

```sql
SELECT id, email, is_temporary_password, background_check_completed
FROM users
WHERE email = 'YOUR_USER_EMAIL_HERE';
```

If the user doesn't exist, they may need to be created via the signup API.

---

## After Migration

1. Restart your Next.js dev server
2. Clear browser cache and cookies
3. Try logging in again
4. Watch console for `[LOGIN DEBUG]` messages
5. You should see: `[LOGIN DEBUG] 🔄 Redirecting to /background-checks-form (HIGHEST PRIORITY)`
