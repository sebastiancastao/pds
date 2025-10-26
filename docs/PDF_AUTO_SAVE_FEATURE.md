# PDF Auto-Save Feature

This document explains the auto-save functionality for the California Payroll Packet PDF workflow.

## Overview

The auto-save feature allows users to:
- Fill out PDF forms in their browser
- Save their progress at any time
- Log out and return later to resume where they left off
- Navigate through all 16 forms in the CA payroll packet sequence

## Architecture

### Database Schema

A new table `pdf_form_progress` stores user progress:

```sql
- id: UUID (primary key)
- user_id: UUID (references auth.users)
- form_name: VARCHAR(255) (e.g., 'ca-de4', 'fw4', 'i9')
- form_data: BYTEA (the PDF file as binary data)
- updated_at: TIMESTAMP (last save time)
```

Row Level Security (RLS) policies ensure users can only access their own saved forms.

### API Endpoints

#### 1. Save Form Progress
**Endpoint:** `POST /api/pdf-form-progress/save`

**Request Body:**
```json
{
  "formName": "ca-de4",
  "formData": "base64-encoded-pdf-data"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Form progress saved"
}
```

#### 2. Retrieve Form Progress
**Endpoint:** `GET /api/pdf-form-progress/retrieve?formName=ca-de4`

**Response:**
```json
{
  "found": true,
  "formData": "base64-encoded-pdf-data",
  "updatedAt": "2025-10-20T12:00:00Z"
}
```

### Updated PDF Routes

The following editable PDF routes now check for saved progress:
1. `/api/payroll-packet-ca/fillable` (CA DE-4)
2. `/api/payroll-packet-ca/fw4` (Federal W-4)
3. `/api/payroll-packet-ca/i9` (I-9)
4. `/api/payroll-packet-ca/adp-deposit` (ADP Direct Deposit)

When a user requests a PDF:
1. The route checks if the user is authenticated
2. If authenticated, it queries the database for saved progress
3. If saved progress exists, it returns the saved PDF
4. If no saved progress, it returns a blank template with navigation buttons

### Form Viewer Page

**Route:** `/payroll-packet-ca/form-viewer?form=fillable`

This page provides a user-friendly interface for filling out and saving forms:

**Features:**
- Displays the PDF in an embedded iframe
- Instructions on how to save progress
- "View & Download Form" button to open PDF
- "Upload Completed Form" button to save progress
- "Skip This Form" button to move to the next form
- Automatic navigation to the next form after saving

**Workflow:**
1. User views the PDF in the iframe
2. User clicks "View & Download Form" to open PDF in new tab
3. User fills out the form in their PDF viewer
4. User saves the PDF to their computer
5. User clicks "Upload Completed Form" and selects the saved PDF
6. System saves the PDF to the database
7. System automatically navigates to the next form

## Form Sequence

The complete CA payroll packet workflow includes 16 forms:

1. **CA DE-4** - State Tax Form (`fillable`)
2. **FW4** - Federal W-4 (`fw4`)
3. **I-9** - Employment Verification (`i9`)
4. **ADP Direct Deposit** (`adp-deposit`)
5. **UI Guide** (`ui-guide`)
6. **Disability Insurance** (`disability-insurance`)
7. **Paid Family Leave** (`paid-family-leave`)
8. **Sexual Harassment** (`sexual-harassment`)
9. **Survivors Rights** (`survivors-rights`)
10. **Transgender Rights** (`transgender-rights`)
11. **Health Insurance** (`health-insurance`)
12. **Time of Hire** (`time-of-hire`)
13. **Discrimination Law** (`discrimination-law`)
14. **Immigration Rights** (`immigration-rights`)
15. **Military Rights** (`military-rights`)
16. **LGBTQ Rights** (`lgbtq-rights`) - Final form

## Setup Instructions

### 1. Run Database Migration

Open your Supabase SQL Editor and run the migration file:

[database/migrations/015_create_pdf_form_progress_table.sql](database/migrations/015_create_pdf_form_progress_table.sql)

This creates the `pdf_form_progress` table with proper RLS policies.

### 2. Verify Environment Variables

Ensure your [.env.local](.env.local) file has the required Supabase configuration:

```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Test the Feature

1. Start your development server: `npm run dev`
2. Navigate to: `http://localhost:3000/payroll-packet-ca/form-viewer?form=fillable`
3. Fill out the CA DE-4 form
4. Save the PDF to your computer
5. Upload the PDF using the "Upload Completed Form" button
6. Verify you're redirected to the next form
7. Go back to the fillable form and verify your saved progress loads

## Authentication Requirements

The auto-save feature requires user authentication. Users must:
- Be logged in with a valid session
- Have an `auth-token` cookie set
- Have a valid Supabase user account

Non-authenticated users will receive blank PDFs without auto-save functionality.

## Technical Details

### PDF Storage

PDFs are stored as binary data (BYTEA) in PostgreSQL. When saving:
1. Client converts PDF to base64
2. Server converts base64 to binary buffer
3. Binary data is stored in the database

When retrieving:
1. Server fetches binary data from database
2. Converts to base64 for transmission
3. Client converts back to PDF file

### Security

- **Row Level Security:** Users can only access their own saved forms
- **Authentication:** All endpoints require valid auth token
- **Data Validation:** Form names are validated against allowed values
- **Content Security:** PDFs are served with strict CSP headers

### Performance Considerations

- PDF files can be large (1-5MB each)
- Database storage grows with user count and form count
- Consider implementing cleanup for old/abandoned forms
- May want to add file size limits to prevent abuse

## Future Enhancements

Potential improvements:
1. **Auto-save while editing:** Use PDF.js to capture form changes in real-time
2. **Progress indicator:** Show which forms have been completed
3. **Bulk download:** Allow users to download all completed forms as a zip
4. **Admin review:** Allow admins to view submitted forms
5. **Email submission:** Email completed packet to HR automatically
6. **Form validation:** Check for missing required fields before continuing

## Troubleshooting

### Forms not saving
- Check browser console for errors
- Verify user is authenticated
- Check database connection
- Verify RLS policies are enabled

### Saved progress not loading
- Clear browser cache
- Check auth token is valid
- Verify form_name matches exactly
- Check database for saved record

### Upload button not working
- Ensure file is PDF format
- Check file size (should be reasonable)
- Verify network connection
- Check browser file upload permissions

## Support

For issues or questions about the auto-save feature, contact your system administrator or refer to the Supabase documentation for database troubleshooting.
