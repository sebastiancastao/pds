ALTER TABLE helpdesk_tickets
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed'));

CREATE INDEX IF NOT EXISTS idx_helpdesk_tickets_status
  ON helpdesk_tickets(status);
