-- Migration 038: Create check-in codes system
-- Managers generate 6-digit codes, workers enter them to check in

-- Table for storing generated check-in codes
CREATE TABLE IF NOT EXISTS checkin_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT true,
  label TEXT
);

-- Table for tracking who checked in with which code
CREATE TABLE IF NOT EXISTS checkin_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code_id UUID REFERENCES checkin_codes(id),
  user_id UUID REFERENCES auth.users(id),
  checked_in_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast code lookup
CREATE INDEX IF NOT EXISTS idx_checkin_codes_code ON checkin_codes(code);
CREATE INDEX IF NOT EXISTS idx_checkin_codes_active ON checkin_codes(is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_checkin_logs_code_id ON checkin_logs(code_id);
CREATE INDEX IF NOT EXISTS idx_checkin_logs_user_id ON checkin_logs(user_id);

-- RLS policies
ALTER TABLE checkin_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkin_logs ENABLE ROW LEVEL SECURITY;

-- Managers/HR/Exec can manage codes
CREATE POLICY "managers_manage_codes" ON checkin_codes
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('manager', 'hr', 'exec')
    )
  );

-- Workers can read active codes (for verification)
CREATE POLICY "workers_read_active_codes" ON checkin_codes
  FOR SELECT USING (
    is_active = true AND expires_at > now()
  );

-- Anyone authenticated can insert their own check-in log
CREATE POLICY "users_insert_own_checkin" ON checkin_logs
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
  );

-- Managers can read all check-in logs
CREATE POLICY "managers_read_checkin_logs" ON checkin_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('manager', 'hr', 'exec')
    )
  );

-- Workers can read their own check-in logs
CREATE POLICY "workers_read_own_checkin" ON checkin_logs
  FOR SELECT USING (
    auth.uid() = user_id
  );
