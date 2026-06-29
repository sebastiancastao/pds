CREATE SEQUENCE IF NOT EXISTS helpdesk_ticket_number_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

ALTER TABLE helpdesk_tickets
  ALTER COLUMN ticket_number SET DEFAULT ('HD-' || LPAD(nextval('helpdesk_ticket_number_seq')::text, 6, '0'));

WITH existing_numbers AS (
  SELECT
    MAX(NULLIF(regexp_replace(ticket_number, '\D', '', 'g'), '')::bigint) AS max_number,
    COUNT(*) AS total_rows
  FROM helpdesk_tickets
)
SELECT setval(
  'helpdesk_ticket_number_seq',
  COALESCE((SELECT max_number FROM existing_numbers), 1),
  COALESCE((SELECT total_rows > 0 FROM existing_numbers), false)
);
