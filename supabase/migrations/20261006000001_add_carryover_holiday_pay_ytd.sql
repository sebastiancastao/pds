-- ADP pays Holiday as its own earnings line. Some employees have it in their
-- year-to-date totals, so the carryover baseline keeps it and the paystub
-- prints a Holiday Pay row (and counts it in Gross Pay YTD) when it is set.
alter table public.employee_ytd_carryover
  add column if not exists holiday_pay_ytd numeric(12, 2);
