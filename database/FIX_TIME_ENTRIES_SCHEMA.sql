-- =====================================================
-- FIX TIME ENTRIES SCHEMA
-- RUN THIS IN SUPABASE SQL EDITOR
-- =====================================================
-- This migration fixes the time_entries schema to support:
-- 1. Event keeping(event_id column)
-- 2. Meal break keeping(meal_start, meal_end actions)
-- 3. Proper column names for event timesheet queries

-- ============================================================
-- STEP 1: Update clock_action enum to include meal actions
-- ============================================================

-- Add new enum values for meal keeping
ALTER TYPE clock_action ADD VALUE IF NOT EXISTS 'meal_start';
ALTER TYPE clock_action ADD VALUE IF NOT EXISTS 'meal_end';

-- ============================================================
-- STEP 2: Add event_id column to time_entries
-- ============================================================

-- Add event_id column to link time entries to specific events
ALTER TABLE public.time_entries
ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES public.events(id) ON DELETE SET NULL;

-- Add index for faster event-based queries
CREATE INDEX IF NOT EXISTS idx_time_entries_event_id ON public.time_entries(event_id);

-- Add comment for documentation
COMMENT ON COLUMN public.time_entries.event_id IS 'Links time entry to a specific event (optional)';

-- ============================================================
-- STEP 3: Verify all changes
-- ============================================================

-- Check time_entries columns
SELECT
  'time_entries' as table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'time_entries'
  AND column_name IN ('id', 'user_id', 'action', 'timestamp', 'event_id', 'division', 'notes')
ORDER BY column_name;

-- Check clock_action enum values
SELECT
  'clock_action enum values' as info,
  enumlabel as value
FROM pg_enum
WHERE enumtypid = 'clock_action'::regtype
ORDER BY enumlabel;

-- Success message
SELECT 'Time entries schema updated successfully!' as status;
