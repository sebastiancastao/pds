-- HR's final payroll workbooks (e.g. "Payroll 10.2 to Accounting final.xlsx")
-- have a sick leave sheet, "Bonus" columns, and split the payroll across
-- several sheets (one per region or event). The Upload Payroll panel now
-- combines sheets, so each line records the sheet it came from, and sick
-- leave pay and bonus get their own columns instead of landing in "extra".

alter table public.payroll_period_upload_rows
  add column if not exists sick_pay numeric,
  add column if not exists bonus numeric,
  add column if not exists source_sheet text;

comment on column public.payroll_period_upload_rows.source_sheet is
  'Sheet of the uploaded workbook the line came from (null for lines added by hand).';
