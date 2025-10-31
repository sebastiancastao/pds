# Apply Migration 024 - Background Check PDFs Table

## Overview

This migration creates a dedicated table `background_check_pdfs` to store completed background check waiver PDFs with signatures.

## What's Included

### 1. Database Table: `background_check_pdfs`
Stores:
- PDF data (base64 encoded)
- User signature (typed or drawn)
- Signature type (type/draw)
- Timestamps (created_at, updated_at)
- One PDF per user (enforced by UNIQUE constraint)

### 2. Security (RLS Policies)
- Users can view/insert/update their own PDF
- Admins can view all PDFs
- Automatic cascade deletion if user is deleted

### 3. API Endpoints

#### POST `/api/background-waiver/save`
Saves or updates the background check PDF for the current user
```json
{
  "pdfData": "base64_encoded_pdf_string",
  "signature": "John Doe" or "data:image/png;base64,...",
  "signatureType": "type" or "draw"
}
```

#### GET `/api/background-waiver/save`
Retrieves the user's background check PDF

---

## How to Apply

### Step 1: Run the Migration

Copy and paste the SQL from [024_create_background_check_pdfs_table.sql](migrations/024_create_background_check_pdfs_table.sql) into your Supabase SQL Editor:

```sql
-- Create the background_check_pdfs table
CREATE TABLE IF NOT EXISTS background_check_pdfs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    pdf_data TEXT NOT NULL,
    signature TEXT,
    signature_type VARCHAR(10) CHECK (signature_type IN ('type', 'draw')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_background_check_pdfs_user_id ON background_check_pdfs(user_id);
CREATE INDEX IF NOT EXISTS idx_background_check_pdfs_created_at ON background_check_pdfs(created_at);

-- Enable RLS
ALTER TABLE background_check_pdfs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own background check PDF"
    ON background_check_pdfs FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own background check PDF"
    ON background_check_pdfs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own background check PDF"
    ON background_check_pdfs FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all background check PDFs"
    ON background_check_pdfs FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('admin', 'exec', 'finance')
        )
    );

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_background_check_pdfs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_background_check_pdfs_updated_at
    BEFORE UPDATE ON background_check_pdfs
    FOR EACH ROW
    EXECUTE FUNCTION update_background_check_pdfs_updated_at();
```

---

### Step 2: Verify the Migration

Run this query to verify the table was created:

```sql
-- Check table structure
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'background_check_pdfs'
ORDER BY ordinal_position;
```

Expected columns:
- id (uuid)
- user_id (uuid)
- pdf_data (text)
- signature (text)
- signature_type (varchar)
- created_at (timestamp)
- updated_at (timestamp)

---

### Step 3: Test the Integration

1. Login with a user that has `background_check_completed = false`
2. You should be redirected to `/background-checks-form`
3. Fill out the PDF form
4. Add a signature (type or draw)
5. Click "Save" - watch console for:
   ```
   [SAVE] Saving to background_check_pdfs table
   [SAVE] ✅ Save successful
   ```
6. Click "Save & Continue"
7. Verify in Supabase:
   ```sql
   SELECT id, user_id, signature_type, created_at
   FROM background_check_pdfs;
   ```

---

## How It Works

### Data Flow

1. **User fills form** → PDF editor captures changes
2. **Auto-save triggers** (every 3 seconds after typing stops)
3. **PDF is converted** to base64
4. **Signature included** (if provided)
5. **Saved to database** via `/api/background-waiver/save`
6. **On completion** → `background_check_completed = true` in users table

### Storage

- **PDF Data**: Base64 encoded (stored as TEXT)
- **Signature**: Either plain text (typed) or data URL (drawn)
- **One PDF per user**: Enforced by UNIQUE constraint on user_id

---

## Admin Access

Admins can view all background check PDFs:

```sql
-- View all background check submissions
SELECT
    u.email,
    p.signature_type,
    p.created_at,
    LENGTH(p.pdf_data) as pdf_size_chars
FROM background_check_pdfs p
JOIN users u ON u.id = p.user_id
ORDER BY p.created_at DESC;
```

To retrieve a specific user's PDF (as admin):

```sql
SELECT pdf_data, signature, signature_type
FROM background_check_pdfs
WHERE user_id = 'user-uuid-here';
```

---

## Troubleshooting

### Error: "Table already exists"
The migration uses `IF NOT EXISTS`, so it's safe to run multiple times.

### Error: "Could not find column"
Make sure Migration 023 was applied first (background_check_completed column).

### PDFs not saving
1. Check browser console for `[SAVE]` logs
2. Verify RLS policies are enabled
3. Check user has valid session token
4. Verify API endpoint is accessible

---

## Next Steps

After applying this migration:
1. Test the complete user flow
2. Monitor the `background_check_pdfs` table for new submissions
3. Consider adding admin UI to view/download submitted PDFs
4. Set up backup strategy for PDF data
