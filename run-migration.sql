-- =====================================================
-- CREATE ONBOARDING FORM TEMPLATES TABLE
-- =====================================================
-- This table stores PDF templates that HR/exec can upload
-- to be used in the state-specific onboarding workflow

CREATE TABLE IF NOT EXISTS onboarding_form_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    form_name VARCHAR(255) NOT NULL,
    form_display_name TEXT NOT NULL,
    form_description TEXT,
    state_code CHAR(2),
    form_category VARCHAR(50) NOT NULL CHECK (form_category IN ('background_check', 'tax', 'employment', 'benefits', 'compliance', 'other')),
    form_order INTEGER DEFAULT 0,
    pdf_data TEXT NOT NULL,
    file_size INTEGER,
    is_active BOOLEAN DEFAULT true,
    is_required BOOLEAN DEFAULT false,
    uploaded_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(form_name, state_code)
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_onboarding_form_templates_state ON onboarding_form_templates(state_code);
CREATE INDEX IF NOT EXISTS idx_onboarding_form_templates_category ON onboarding_form_templates(form_category);
CREATE INDEX IF NOT EXISTS idx_onboarding_form_templates_active ON onboarding_form_templates(is_active);

-- Enable RLS
ALTER TABLE onboarding_form_templates ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone authenticated can read active forms
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'onboarding_form_templates'
        AND policyname = 'Anyone can view active onboarding form templates'
    ) THEN
        CREATE POLICY "Anyone can view active onboarding form templates"
            ON onboarding_form_templates
            FOR SELECT
            USING (is_active = true);
    END IF;
END $$;

-- Policy: Only HR/exec can insert/update/delete
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'onboarding_form_templates'
        AND policyname = 'HR and exec can manage onboarding form templates'
    ) THEN
        CREATE POLICY "HR and exec can manage onboarding form templates"
            ON onboarding_form_templates
            FOR ALL
            USING (
                EXISTS (
                    SELECT 1 FROM users
                    WHERE users.id = auth.uid()
                    AND users.role IN ('hr', 'exec', 'admin')
                )
            );
    END IF;
END $$;

-- Trigger for updated_at
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'update_onboarding_form_templates_updated_at'
    ) THEN
        CREATE TRIGGER update_onboarding_form_templates_updated_at
            BEFORE UPDATE ON onboarding_form_templates
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- Comments
COMMENT ON TABLE onboarding_form_templates IS 'PDF templates for state-specific onboarding workflows uploaded by HR/exec';
COMMENT ON COLUMN onboarding_form_templates.form_name IS 'Unique identifier for the form (e.g., ca-de4, w4, i9)';
COMMENT ON COLUMN onboarding_form_templates.form_display_name IS 'Human-readable name displayed to users';
COMMENT ON COLUMN onboarding_form_templates.state_code IS 'State code (e.g., CA, NY, AZ) - NULL for federal/universal forms';
COMMENT ON COLUMN onboarding_form_templates.form_category IS 'Category: background_check, tax, employment, benefits, compliance, other';
COMMENT ON COLUMN onboarding_form_templates.form_order IS 'Display order in the workflow';
COMMENT ON COLUMN onboarding_form_templates.pdf_data IS 'Base64-encoded PDF file data';
COMMENT ON COLUMN onboarding_form_templates.is_required IS 'Whether this form must be completed';
