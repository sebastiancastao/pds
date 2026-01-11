-- Migration: Add RLS Policies for form_signatures table
-- Purpose: Allow authenticated users to insert and view their own signatures while maintaining security
-- Date: 2026-01-11

-- Drop existing policies if they exist (for clean migration)
DROP POLICY IF EXISTS "Users can view their own signatures" ON public.form_signatures;
DROP POLICY IF EXISTS "Admins can view all signatures" ON public.form_signatures;
DROP POLICY IF EXISTS "Users can insert their own signatures" ON public.form_signatures;
DROP POLICY IF EXISTS "Service can insert signatures" ON public.form_signatures;

-- Ensure RLS is enabled
ALTER TABLE public.form_signatures ENABLE ROW LEVEL SECURITY;

-- Policy 1: Users can view their own signatures
CREATE POLICY "Users can view their own signatures"
    ON public.form_signatures
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy 2: Managers, Finance, and Execs can view all signatures
CREATE POLICY "Privileged users can view all signatures"
    ON public.form_signatures
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid()
            AND role IN ('manager', 'finance', 'exec')
        )
    );

-- Policy 3: Users can insert their own signatures
CREATE POLICY "Users can insert their own signatures"
    ON public.form_signatures
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy 4: Allow service role full access (for API operations)
CREATE POLICY "Service role can manage signatures"
    ON public.form_signatures
    FOR ALL
    USING (auth.role() = 'service_role');

-- Policy 5: No one can update signatures (immutable for compliance)
-- Signatures should be permanent records, no update policy needed

-- Policy 6: No one can delete signatures (permanent for compliance)
-- No delete policy to ensure signatures remain for audit trail

-- Grant necessary permissions
GRANT SELECT ON public.form_signatures TO authenticated;
GRANT INSERT ON public.form_signatures TO authenticated;
GRANT SELECT, INSERT ON public.form_signatures TO service_role;

-- Verify policies exist
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'form_signatures'
ORDER BY policyname;

-- Verify RLS is enabled
SELECT
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables
WHERE tablename = 'form_signatures';

-- Comments for documentation
COMMENT ON POLICY "Users can view their own signatures" ON public.form_signatures IS
    'Employees can view signatures they have created';

COMMENT ON POLICY "Privileged users can view all signatures" ON public.form_signatures IS
    'Managers, finance, and executives can view all employee signatures for HR purposes';

COMMENT ON POLICY "Users can insert their own signatures" ON public.form_signatures IS
    'Employees can create signatures for their own forms only';

COMMENT ON POLICY "Service role can manage signatures" ON public.form_signatures IS
    'Service role has full access for API operations and maintenance';

-- Success message
DO $$
BEGIN
    RAISE NOTICE '✅ Form signatures RLS policies created successfully';
    RAISE NOTICE 'Users can now insert and view their own signatures';
    RAISE NOTICE 'Managers/Finance/Execs can view all signatures';
    RAISE NOTICE 'Signatures are immutable (cannot be updated or deleted)';
END $$;
