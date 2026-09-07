-- =====================================================
-- ADD REJECT/DECLINE SUPPORT TO MEAL WAIVERS
-- =====================================================
-- Employees can now either WAIVE (voluntarily give up) or REJECT/DECLINE (keep taking)
-- their meal period on the meal-waiver-6hour / meal-waiver-10-12 onboarding forms.
-- The prior schema only supported the "waived" path (acknowledges_terms had to be true).

ALTER TABLE meal_waivers
  ADD COLUMN IF NOT EXISTS decision VARCHAR(20) NOT NULL DEFAULT 'waived'
    CHECK (decision IN ('waived', 'rejected'));

ALTER TABLE meal_waivers
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

COMMENT ON COLUMN meal_waivers.decision IS 'Employee decision: waived (voluntarily gave up the meal period) or rejected (declined the waiver and will take the full meal period)';
COMMENT ON COLUMN meal_waivers.rejection_reason IS 'Optional note the employee provided when declining/rejecting the waiver';

-- Existing rows all represent an accepted waiver, so the default of 'waived' backfills them
-- correctly without any further action.
