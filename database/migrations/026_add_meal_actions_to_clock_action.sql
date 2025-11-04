-- Extend enum clock_action with meal-related values
DO $$
BEGIN
  BEGIN
    ALTER TYPE clock_action ADD VALUE IF NOT EXISTS 'meal_start';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER TYPE clock_action ADD VALUE IF NOT EXISTS 'meal_end';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END $$;


