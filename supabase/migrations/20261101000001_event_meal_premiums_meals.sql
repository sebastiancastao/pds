-- Meal Premium toggle now records WHICH meal(s) the premium is for (Meal 1, 2 or 3).
-- An exec picks the meals on the /event-dashboard Timesheet tab next to the toggle.
-- Each chosen meal pays one hour at the vendor's Rate in Effect, never below $28.50
-- (lib/meal-premium): the Payment tab, HR dashboard Payroll tab and paystub PDF all read it.
-- Rows written before this column existed default to Meal 1 (one hour, as before).

alter table public.event_meal_premiums
  add column if not exists meals smallint[] not null default '{1}';

alter table public.event_meal_premiums
  drop constraint if exists event_meal_premiums_meals_check;

alter table public.event_meal_premiums
  add constraint event_meal_premiums_meals_check
  check (cardinality(meals) between 1 and 3 and meals <@ array[1, 2, 3]::smallint[]);

comment on column public.event_meal_premiums.meals is
  'Meals the premium is for (1, 2, 3). Each pays one hour at the Rate in Effect (min $28.50).';

comment on table public.event_meal_premiums is
  'Vendors with the Meal Premium toggle on in the event Timesheet tab. Row present = on; meals = which meals; each meal pays one hour at the Rate in Effect (min $28.50).';
