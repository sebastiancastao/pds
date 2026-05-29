ALTER TABLE helpdesk_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own helpdesk tickets" ON helpdesk_tickets;
CREATE POLICY "Users can view own helpdesk tickets"
  ON helpdesk_tickets FOR SELECT
  USING (created_by = auth.uid());

DROP POLICY IF EXISTS "Users can insert own helpdesk tickets" ON helpdesk_tickets;
CREATE POLICY "Users can insert own helpdesk tickets"
  ON helpdesk_tickets FOR INSERT
  WITH CHECK (created_by = auth.uid());

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
