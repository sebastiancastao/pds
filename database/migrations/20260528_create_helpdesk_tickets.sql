CREATE SEQUENCE IF NOT EXISTS helpdesk_ticket_number_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

CREATE TABLE IF NOT EXISTS helpdesk_tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_number TEXT NOT NULL UNIQUE DEFAULT ('HD-' || LPAD(nextval('helpdesk_ticket_number_seq')::text, 6, '0')),
  ticket_date DATE NOT NULL,
  urgency TEXT NOT NULL CHECK (urgency IN ('low', 'medium', 'high', 'critical')),
  description TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_helpdesk_tickets_created_by
  ON helpdesk_tickets(created_by);

CREATE INDEX IF NOT EXISTS idx_helpdesk_tickets_ticket_date
  ON helpdesk_tickets(ticket_date DESC);

CREATE INDEX IF NOT EXISTS idx_helpdesk_tickets_created_at
  ON helpdesk_tickets(created_at DESC);

ALTER TABLE helpdesk_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Privileged users can manage helpdesk tickets" ON helpdesk_tickets;
CREATE POLICY "Privileged users can manage helpdesk tickets"
  ON helpdesk_tickets FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('exec', 'admin', 'hr', 'hr_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('exec', 'admin', 'hr', 'hr_admin')
    )
  );

CREATE OR REPLACE FUNCTION update_helpdesk_tickets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_helpdesk_tickets_timestamp ON helpdesk_tickets;
CREATE TRIGGER update_helpdesk_tickets_timestamp
  BEFORE UPDATE ON helpdesk_tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_helpdesk_tickets_updated_at();

COMMENT ON TABLE helpdesk_tickets IS 'HR helpdesk tickets created from the employees page.';
