-- =====================================================
-- CREATE PAYROLL DEDUCTIONS TABLE
-- =====================================================
-- Stores extracted payroll data from paystubs including employee info and deductions

CREATE TABLE IF NOT EXISTS payroll_deductions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Page Information
    page_number INTEGER,

    -- Employee Information
    employee_name VARCHAR(255),
    ssn VARCHAR(50),
    employee_id VARCHAR(100),

    -- Pay Period Information
    pay_period_start DATE,
    pay_period_end DATE,
    pay_date DATE,
    check_number VARCHAR(50),

    -- Pay Amounts
    gross_pay DECIMAL(10, 2),
    net_pay DECIMAL(10, 2),
    hourly_rate DECIMAL(10, 2),

    -- Hours
    regular_hours DECIMAL(10, 2),
    overtime_hours DECIMAL(10, 2),
    doubletime_hours DECIMAL(10, 2),
    total_hours DECIMAL(10, 2),

    -- Earnings
    regular_earnings DECIMAL(10, 2),
    overtime_earnings DECIMAL(10, 2),
    doubletime_earnings DECIMAL(10, 2),

    -- Statutory Deductions (This Period)
    federal_income_this_period DECIMAL(10, 2),
    social_security_this_period DECIMAL(10, 2),
    medicare_this_period DECIMAL(10, 2),
    ca_state_income_this_period DECIMAL(10, 2),
    ca_state_di_this_period DECIMAL(10, 2),

    -- Statutory Deductions (Year to Date)
    federal_income_ytd DECIMAL(10, 2),
    social_security_ytd DECIMAL(10, 2),
    medicare_ytd DECIMAL(10, 2),
    ca_state_income_ytd DECIMAL(10, 2),
    ca_state_di_ytd DECIMAL(10, 2),

    -- Voluntary Deductions
    misc_non_taxable_this_period DECIMAL(10, 2),
    misc_non_taxable_ytd DECIMAL(10, 2),

    -- Net Pay Adjustments
    misc_reimbursement_this_period DECIMAL(10, 2),
    misc_reimbursement_ytd DECIMAL(10, 2),

    -- YTD Totals
    ytd_gross DECIMAL(10, 2),
    ytd_net DECIMAL(10, 2),

    -- Source Information
    pdf_filename VARCHAR(500),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_payroll_deductions_user_id ON payroll_deductions(user_id);
CREATE INDEX IF NOT EXISTS idx_payroll_deductions_employee_name ON payroll_deductions(employee_name);
CREATE INDEX IF NOT EXISTS idx_payroll_deductions_ssn ON payroll_deductions(ssn);
CREATE INDEX IF NOT EXISTS idx_payroll_deductions_pay_date ON payroll_deductions(pay_date);
CREATE INDEX IF NOT EXISTS idx_payroll_deductions_pay_period ON payroll_deductions(pay_period_start, pay_period_end);

-- Enable Row Level Security
ALTER TABLE payroll_deductions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only view and manage their own payroll deductions
DROP POLICY IF EXISTS "Users can manage their own payroll deductions" ON payroll_deductions;
CREATE POLICY "Users can manage their own payroll deductions"
    ON payroll_deductions
    FOR ALL
    USING (user_id = auth.uid());

-- Policy: HR, managers, and admins can view all payroll deductions
DROP POLICY IF EXISTS "Authorized staff can view all payroll deductions" ON payroll_deductions;
CREATE POLICY "Authorized staff can view all payroll deductions"
    ON payroll_deductions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('hr', 'exec', 'admin', 'manager', 'finance')
        )
    );

-- Trigger to automatically update the updated_at timestamp
DROP TRIGGER IF EXISTS update_payroll_deductions_updated_at ON payroll_deductions;
CREATE TRIGGER update_payroll_deductions_updated_at
    BEFORE UPDATE ON payroll_deductions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE payroll_deductions IS 'Stores extracted payroll data from paystub PDFs including employee information and tax deductions';
COMMENT ON COLUMN payroll_deductions.page_number IS 'Page number from the PDF where this paystub was found (for multi-page PDFs)';
COMMENT ON COLUMN payroll_deductions.employee_name IS 'Full name of the employee from the paystub';
COMMENT ON COLUMN payroll_deductions.ssn IS 'Social Security Number (may be partially masked)';
COMMENT ON COLUMN payroll_deductions.pdf_filename IS 'Original filename of the uploaded PDF';
