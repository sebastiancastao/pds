ALTER TABLE helpdesk_tickets
  ADD COLUMN IF NOT EXISTS description TEXT;

UPDATE helpdesk_tickets
SET description = ''
WHERE description IS NULL;

ALTER TABLE helpdesk_tickets
  ALTER COLUMN description SET NOT NULL;
