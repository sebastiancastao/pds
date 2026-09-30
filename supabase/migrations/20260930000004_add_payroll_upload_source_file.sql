-- An upload can now combine several payroll files (e.g. the accounting
-- workbook plus a separate reimbursements file), so each line records the
-- file it came from next to its sheet and row.

alter table public.payroll_period_upload_rows
  add column if not exists source_file text;

comment on column public.payroll_period_upload_rows.source_file is
  'File name the line was read from (null for lines added by hand). payroll_period_uploads.file_name lists every file in the upload.';
