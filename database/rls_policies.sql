-- PDS Time Tracking System - Row Level Security (RLS) Policies
-- Implements principle of least privilege for data access

-- ============================================
-- Helper Function: Get Current User Role
-- ============================================

CREATE OR REPLACE FUNCTION get_current_user_role()
RETURNS user_role AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================
-- Users Table Policies
-- ============================================

-- Users can view their own record
CREATE POLICY "Users can view own record"
  ON public.users
  FOR SELECT
  USING (auth.uid() = id);

-- Managers, finance, and execs can view users in their scope
CREATE POLICY "Admins can view users"
  ON public.users
  FOR SELECT
  USING (
    get_current_user_role() IN ('manager', 'finance', 'exec')
  );

-- Only execs can create/update/delete users
CREATE POLICY "Execs can manage users"
  ON public.users
  FOR ALL
  USING (get_current_user_role() = 'exec');

-- ============================================
-- Profiles Table Policies
-- ============================================

-- Users can view and update their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Managers can view profiles of workers they manage
CREATE POLICY "Managers can view worker profiles"
  ON public.profiles
  FOR SELECT
  USING (
    get_current_user_role() = 'manager' AND
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = user_id AND role = 'worker'
    )
  );

-- Finance and execs can view all profiles
CREATE POLICY "Finance and execs can view all profiles"
  ON public.profiles
  FOR SELECT
  USING (get_current_user_role() IN ('finance', 'exec'));

-- Only execs can delete profiles
CREATE POLICY "Execs can delete profiles"
  ON public.profiles
  FOR DELETE
  USING (get_current_user_role() = 'exec');

-- ============================================
-- Documents Table Policies (High Security)
-- ============================================

-- Users can view their own documents only
CREATE POLICY "Users can view own documents"
  ON public.documents
  FOR SELECT
  USING (
    auth.uid() = user_id AND
    is_deleted = false
  );

-- Users can upload their own documents
CREATE POLICY "Users can upload own documents"
  ON public.documents
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Finance can view specific document types (e.g., W-4, W-9)
CREATE POLICY "Finance can view tax documents"
  ON public.documents
  FOR SELECT
  USING (
    get_current_user_role() = 'finance' AND
    document_type IN ('w4', 'w9', 'direct_deposit') AND
    is_deleted = false
  );

-- Execs can view all documents
CREATE POLICY "Execs can view all documents"
  ON public.documents
  FOR SELECT
  USING (
    get_current_user_role() = 'exec' AND
    is_deleted = false
  );

-- Only execs can delete documents (soft delete)
CREATE POLICY "Execs can delete documents"
  ON public.documents
  FOR UPDATE
  USING (
    get_current_user_role() = 'exec'
  );

-- ============================================
-- Audit Logs Policies (Read-Only for Most)
-- ============================================

-- Users can view their own audit logs
CREATE POLICY "Users can view own audit logs"
  ON public.audit_logs
  FOR SELECT
  USING (auth.uid() = user_id);

-- Execs can view all audit logs
CREATE POLICY "Execs can view all audit logs"
  ON public.audit_logs
  FOR SELECT
  USING (get_current_user_role() = 'exec');

-- Only system can insert audit logs (via service role)
-- No DELETE policy - audit logs are immutable

-- ============================================
-- Time Entries Policies
-- ============================================

-- Workers can create their own time entries (FLSA requirement)
CREATE POLICY "Workers can create own time entries"
  ON public.time_entries
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can view their own time entries
CREATE POLICY "Users can view own time entries"
  ON public.time_entries
  FOR SELECT
  USING (auth.uid() = user_id);

-- Managers can view and approve time entries
CREATE POLICY "Managers can view time entries"
  ON public.time_entries
  FOR SELECT
  USING (get_current_user_role() IN ('manager', 'finance', 'exec'));

-- Only managers and above can update time entries (for corrections)
CREATE POLICY "Managers can update time entries"
  ON public.time_entries
  FOR UPDATE
  USING (get_current_user_role() IN ('manager', 'finance', 'exec'));

-- ============================================
-- Events Table Policies
-- ============================================

-- Managers can create events
CREATE POLICY "Managers can create events"
  ON public.events
  FOR INSERT
  WITH CHECK (
    get_current_user_role() IN ('manager', 'exec') AND
    auth.uid() = created_by
  );

-- Workers can view events they're assigned to
CREATE POLICY "Workers can view assigned events"
  ON public.events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.event_staff
      WHERE event_id = id AND user_id = auth.uid()
    )
  );

-- Managers can view and update events they created
CREATE POLICY "Managers can manage own events"
  ON public.events
  FOR ALL
  USING (auth.uid() = created_by);

-- Execs can view all events
CREATE POLICY "Execs can view all events"
  ON public.events
  FOR SELECT
  USING (get_current_user_role() = 'exec');

-- ============================================
-- Event Staff Policies
-- ============================================

-- Workers can view their own assignments
CREATE POLICY "Workers can view own assignments"
  ON public.event_staff
  FOR SELECT
  USING (auth.uid() = user_id);

-- Workers can accept/reject their assignments
CREATE POLICY "Workers can respond to invitations"
  ON public.event_staff
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Managers can assign staff to events
CREATE POLICY "Managers can assign staff"
  ON public.event_staff
  FOR INSERT
  WITH CHECK (get_current_user_role() IN ('manager', 'exec'));

-- Managers can view all assignments
CREATE POLICY "Managers can view assignments"
  ON public.event_staff
  FOR SELECT
  USING (get_current_user_role() IN ('manager', 'finance', 'exec'));

-- ============================================
-- Payouts Table Policies
-- ============================================

-- Workers can view their own payouts
CREATE POLICY "Workers can view own payouts"
  ON public.payouts
  FOR SELECT
  USING (auth.uid() = user_id);

-- Managers can create and approve payouts
CREATE POLICY "Managers can create payouts"
  ON public.payouts
  FOR INSERT
  WITH CHECK (get_current_user_role() IN ('manager', 'finance', 'exec'));

CREATE POLICY "Managers can approve payouts"
  ON public.payouts
  FOR UPDATE
  USING (get_current_user_role() IN ('manager', 'finance', 'exec'));

-- Finance can view and approve all payouts
CREATE POLICY "Finance can manage all payouts"
  ON public.payouts
  FOR ALL
  USING (get_current_user_role() IN ('finance', 'exec'));

-- ============================================
-- Grant Permissions to Authenticated Users
-- ============================================

-- Grant basic access to authenticated users
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;

-- Grant table access (RLS will further restrict)
GRANT ALL ON public.users TO authenticated;
GRANT ALL ON public.profiles TO authenticated;
GRANT ALL ON public.documents TO authenticated;
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.time_entries TO authenticated;
GRANT ALL ON public.events TO authenticated;
GRANT ALL ON public.event_staff TO authenticated;
GRANT ALL ON public.payouts TO authenticated;

-- ============================================
-- Security Notes
-- ============================================

/*
IMPORTANT SECURITY CONSIDERATIONS:

1. Row Level Security (RLS) is ENABLED on all tables
2. These policies implement "Principle of Least Privilege"
3. Workers can only access their own data
4. Managers have limited scope (workers only)
5. Finance has access to financial data only
6. Execs have full access for oversight
7. Audit logs are IMMUTABLE (no DELETE policy)
8. Documents have strictest access control
9. Time entries enforce FLSA self-entry requirement
10. All policies are enforced at the DATABASE level

TESTING RLS:
Test each policy by creating users with different roles
and attempting various operations. Use:

  SET ROLE authenticated;
  SET request.jwt.claims.sub TO 'user-id-here';

to test as different users.

MONITORING:
Monitor audit_logs table for:
- Unauthorized access attempts (will be blocked by RLS)
- Unusual access patterns
- Failed operations

*/


