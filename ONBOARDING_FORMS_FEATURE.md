# Onboarding Forms Update Feature

## Overview
The HR Dashboard now includes an "Onboarding Forms Update" tab that allows HR and Executive users to upload and manage PDF forms for the state-specific onboarding workflow.

## Features

### 1. **Upload New Forms**
- Upload PDF files for onboarding workflows
- Specify form metadata:
  - **Form ID**: Unique identifier (e.g., `ca-de4`, `w4`, `i9`)
  - **Display Name**: User-friendly name shown to employees
  - **Description**: Optional brief description
  - **State Code**: CA, NY, AZ, WI, or Universal (for federal/all-state forms)
  - **Category**: background_check, tax, employment, benefits, compliance, other
  - **Form Order**: Display sequence in workflow
  - **Required**: Mark if form completion is mandatory

### 2. **Filter & View Forms**
- Filter by state (CA, NY, AZ, WI, or All)
- Filter by category
- View active and inactive forms
- See form metadata: size, upload date, state, category

### 3. **Manage Forms**
- Activate/Deactivate forms (soft delete)
- View form details
- Track who uploaded each form

## Database Schema

### Table: `onboarding_form_templates`
```sql
- id (UUID, Primary Key)
- form_name (VARCHAR, Unique per state)
- form_display_name (TEXT)
- form_description (TEXT, Optional)
- state_code (CHAR(2), NULL for universal)
- form_category (ENUM)
- form_order (INTEGER)
- pdf_data (TEXT, base64-encoded)
- file_size (INTEGER)
- is_active (BOOLEAN)
- is_required (BOOLEAN)
- uploaded_by (UUID, FK to users)
- created_at, updated_at (TIMESTAMPTZ)
```

## API Endpoints

### GET `/api/onboarding-forms`
Retrieve forms with optional filters:
- `?state=CA` - Filter by state
- `?category=tax` - Filter by category
- `?active_only=false` - Include inactive forms

**Response:**
```json
{
  "forms": [
    {
      "id": "uuid",
      "form_name": "ca-de4",
      "form_display_name": "California DE-4 Form",
      "state_code": "CA",
      "form_category": "tax",
      "is_active": true,
      "is_required": true,
      "file_size": 204800,
      "created_at": "2025-01-15T10:00:00Z"
    }
  ]
}
```

### POST `/api/onboarding-forms`
Upload a new form (HR/Exec only)

**Request Body:**
```json
{
  "form_name": "ca-de4",
  "form_display_name": "California DE-4 Form",
  "form_description": "State tax withholding form",
  "state_code": "CA",
  "form_category": "tax",
  "form_order": 1,
  "is_required": true,
  "pdf_data": "base64-encoded-pdf-data"
}
```

### PATCH `/api/onboarding-forms`
Update a form (HR/Exec only)

**Request Body:**
```json
{
  "id": "form-uuid",
  "is_active": false
}
```

### DELETE `/api/onboarding-forms?id={uuid}`
Deactivate a form (HR/Exec only)

## Access Control

### Row Level Security (RLS)
- **Read**: All authenticated users can view active forms
- **Write/Update/Delete**: Only HR, Exec, and Admin roles

### API Authorization
All write operations require:
- Valid JWT token in `Authorization: Bearer {token}` header
- User role must be `hr`, `exec`, or `admin`

## Usage Instructions

### Step 1: Run the Database Migration
```bash
# In Supabase SQL Editor, run:
c:\Users\sebas\OneDrive\Escritorio\PDS\database\migrations\028_create_onboarding_form_templates.sql
```

### Step 2: Access the HR Dashboard
1. Navigate to `/hr-dashboard`
2. Click on the **"Onboarding Forms Update"** tab

### Step 3: Upload a Form
1. Click "Upload New Form" to expand the form
2. Fill in required fields:
   - Form ID (unique identifier)
   - Display Name (what employees will see)
   - Category
   - PDF File
3. Optional fields:
   - State Code (leave blank for universal forms)
   - Description
   - Form Order (for workflow sequencing)
   - Mark as Required
4. Click "Upload Form"

### Step 4: Manage Forms
- Use filters to find specific forms
- Click "Deactivate" to remove forms from the workflow
- Click "Activate" to re-enable forms

## Integration with Onboarding Workflow

Forms uploaded via this feature will be available in state-specific onboarding workflows:
- **California**: `/app/payroll-packet-ca/`
- **New York**: `/app/payroll-packet-ny/`
- **Arizona**: `/app/payroll-packet-az/`
- **Wisconsin**: `/app/payroll-packet-wi/`

To integrate forms into the workflow, developers should:
1. Query `onboarding_form_templates` table
2. Filter by `state_code` and `is_active=true`
3. Order by `form_order`
4. Load PDF data from `pdf_data` field (base64)
5. Render using pdf-lib or similar library

## Security Considerations

### PDF Storage
- PDFs are stored as base64-encoded TEXT in the database
- Uses chunked conversion (32KB chunks) to prevent stack overflow
- Stored in Supabase with RLS enabled

### File Size Limits
- Recommended max: 10MB per PDF
- Consider implementing client-side validation if needed

### Audit Trail
- All uploads tracked via `uploaded_by` and `created_at`
- Soft delete (deactivate) preserves history
- Consider adding audit logging for form updates

## Form Categories

1. **background_check**: Background verification forms
2. **tax**: W-4, state tax withholding forms
3. **employment**: I-9, offer letters, employment agreements
4. **benefits**: Health insurance, 401k enrollment
5. **compliance**: Handbooks, policy acknowledgments
6. **other**: Miscellaneous forms

## Example Forms by State

### California (CA)
- CA DE-4 (State Tax)
- California Employment Agreement
- Meal Break Waiver
- Sexual Harassment Training Acknowledgment

### New York (NY)
- NY IT-2104 (State Tax)
- NY Paid Family Leave Form
- NY Notice of Pay Rate

### Federal/Universal
- Federal W-4
- I-9 Employment Eligibility
- Direct Deposit Authorization
- Emergency Contact Information

## Files Created

1. **Database Migration**: `database/migrations/028_create_onboarding_form_templates.sql`
2. **API Route**: `app/api/onboarding-forms/route.ts`
3. **UI Component**: Added to `app/hr-dashboard/page.tsx`
4. **Documentation**: This file

## Next Steps

To fully integrate this feature:
1. ✅ Run the database migration
2. ✅ Test uploading a form via HR Dashboard
3. Update payroll packet viewers to load forms from the database
4. Add form version control (optional)
5. Implement form preview functionality (optional)
6. Add bulk upload capability (optional)

## Support

For questions or issues:
- Check Supabase logs for API errors
- Verify RLS policies are enabled
- Ensure user has HR/Exec role
- Check browser console for client-side errors
