-- Help Desk Tickets
CREATE TABLE IF NOT EXISTS help_desk_tickets (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject     TEXT        NOT NULL,
  category    TEXT        NOT NULL DEFAULT 'General',
  priority    TEXT        NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  description TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE help_desk_tickets ENABLE ROW LEVEL SECURITY;

-- Users can read/create their own tickets
CREATE POLICY "Users manage own tickets"
  ON help_desk_tickets FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Privileged roles can read all tickets
CREATE POLICY "Staff read all tickets"
  ON help_desk_tickets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
        AND role IN ('exec','hr','manager','supervisor','supervisor2','supervisor3','finance')
    )
  );
