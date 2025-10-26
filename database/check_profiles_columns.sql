-- Check actual columns in profiles table

SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profiles'
ORDER BY ordinal_position;

-- Also check if there are any generated/computed columns
SELECT
    attname AS column_name,
    atttypid::regtype AS data_type,
    attgenerated AS generated
FROM pg_attribute
WHERE attrelid = 'public.profiles'::regclass
  AND attnum > 0
  AND NOT attisdropped
ORDER BY attnum;
