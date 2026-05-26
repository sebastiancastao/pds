-- Add tips_distribution_mode to events table
-- 'prorated': tips distributed proportionally by hours worked (default)
-- 'equal': tips split equally among eligible workers
ALTER TABLE events
ADD COLUMN IF NOT EXISTS tips_distribution_mode TEXT NOT NULL DEFAULT 'prorated'
  CHECK (tips_distribution_mode IN ('prorated', 'equal'));
